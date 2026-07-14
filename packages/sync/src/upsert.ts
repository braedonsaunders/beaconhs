// Canonical upsert engine — lands a CanonicalRecord into people / org_units /
// equipment_items, keyed through the crosswalk for idempotency.
//
// Resolution order per record: crosswalk (external_id → canonical row) →
// natural key (external employee id / employee no / org code / asset tag) →
// insert new. The same planner is used for previews and real syncs so dry-runs
// show the decision the write path would make.

import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import {
  normalizeCatalogDisplayName,
  normalizedCatalogNameSql,
  primaryPersonTitleName,
  type Database,
} from '@beaconhs/db'
import {
  customerContacts,
  departments,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  personTitleAssignments,
  personTitles,
  syncCrosswalk,
  syncRecordChanges,
  trades,
  type SyncRecordAction,
  type SyncRecordDiff,
} from '@beaconhs/db/schema'
import type {
  CanonicalContact,
  CanonicalEquipment,
  CanonicalOrgUnit,
  CanonicalPerson,
  CanonicalRecord,
  SyncEntityKey,
  SyncLogger,
} from './types'
import {
  decideNaturalPersonAdoption,
  decidePersonSync,
  type SyncOwnershipMode,
} from './person-sync-policy'

export type { SyncOwnershipMode } from './person-sync-policy'

type JsonRecord = Record<string, unknown>

export interface Lookups {
  deptByName: Map<string, string>
  tradeByName: Map<string, string>
  equipTypeByName: Map<string, string>
  orgUnitIdByCode: Map<string, string>
  personIdByEmployeeNo: Map<string, string>
  personIdByExternalEmployeeId: Map<string, string>
}

export interface UpsertCtx {
  tenantId: string
  connectionId: string
  sourceSystem: string
  lookups: Lookups
  log: SyncLogger
  dryRun?: boolean
  ownershipMode?: SyncOwnershipMode
}

export type UpsertAction = Exclude<SyncRecordAction, 'failed' | 'archived'>
export interface UpsertResult {
  action: UpsertAction
  canonicalId?: string
  rowHash?: string
  before?: JsonRecord | null
  after?: JsonRecord | null
  diff?: SyncRecordDiff | null
  message?: string
}

interface ArchiveMissingResult {
  entity: SyncEntityKey
  externalId: string
  canonicalId: string
  action: 'archived'
  rowHash?: string
  before: JsonRecord
  after: JsonRecord
  diff: SyncRecordDiff
  message: string
}

export async function loadLookups(tx: Database): Promise<Lookups> {
  // RLS scopes all tenant reads to the current tenant.
  const [depts, trds, etypes, ous, ppl] = await Promise.all([
    tx.select({ id: departments.id, name: departments.name }).from(departments),
    tx.select({ id: trades.id, name: trades.name }).from(trades),
    tx.select({ id: equipmentTypes.id, name: equipmentTypes.name }).from(equipmentTypes),
    tx
      .select({ id: orgUnits.id, code: orgUnits.code })
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt)),
    tx
      .select({
        id: people.id,
        employeeNo: people.employeeNo,
        externalEmployeeId: people.externalEmployeeId,
      })
      .from(people)
      .where(isNull(people.deletedAt)),
  ])
  const catalogKey = (value: string) => normalizeCatalogDisplayName(value)?.toLowerCase() ?? ''
  const lower = (m: { id: string; name: string }[]) =>
    new Map(m.map((r) => [catalogKey(r.name), r.id] as const))
  const orgUnitIdByCode = new Map<string, string>()
  for (const o of ous) if (o.code) orgUnitIdByCode.set(o.code.toLowerCase(), o.id)
  const personIdByEmployeeNo = new Map<string, string>()
  const personIdByExternalEmployeeId = new Map<string, string>()
  for (const p of ppl) {
    if (p.employeeNo) personIdByEmployeeNo.set(p.employeeNo.toLowerCase(), p.id)
    if (p.externalEmployeeId) {
      personIdByExternalEmployeeId.set(p.externalEmployeeId.toLowerCase(), p.id)
    }
  }
  return {
    deptByName: lower(depts),
    tradeByName: lower(trds),
    equipTypeByName: lower(etypes),
    orgUnitIdByCode,
    personIdByEmployeeNo,
    personIdByExternalEmployeeId,
  }
}

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 32)
}

function firstId(rows: { id: string }[]): string {
  const r = rows[0]
  if (!r) throw new Error('insert/returning produced no row')
  return r.id
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]))
  }
  return value
}

function snap(row: Record<string, unknown> | null | undefined): JsonRecord | null {
  return row ? (jsonSafe(row) as JsonRecord) : null
}

function diff(
  before: JsonRecord | null | undefined,
  after: JsonRecord | null | undefined,
): SyncRecordDiff | null {
  const b = before ?? {}
  const a = after ?? {}
  const out: SyncRecordDiff = {}
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const bv = b[key]
    const av = a[key]
    if (JSON.stringify(bv) !== JSON.stringify(av)) out[key] = { before: bv, after: av }
  }
  return Object.keys(out).length ? out : null
}

function metadataMerge(before: JsonRecord | null, incoming?: JsonRecord): JsonRecord {
  const current =
    before?.metadata && typeof before.metadata === 'object' && !Array.isArray(before.metadata)
      ? (before.metadata as JsonRecord)
      : {}
  return { ...current, ...(incoming ?? {}) }
}

function conflictMessage(): string {
  return 'Local row changed after the last sync; ownership policy requires review.'
}

function wasTargetUpdatedAfterSync(
  row: { updatedAt?: Date | string | null } | null,
  link: { lastSyncedAt: Date | string },
  relatedUpdatedAt: Array<Date | string | null | undefined> = [],
): boolean {
  const syncedAt = new Date(link.lastSyncedAt).getTime()
  if (!Number.isFinite(syncedAt)) return false
  return [row?.updatedAt, ...relatedUpdatedAt].some((value) => {
    if (!value) return false
    const updatedAt = new Date(value).getTime()
    return Number.isFinite(updatedAt) && updatedAt > syncedAt
  })
}

function isManualConflict(
  ctx: UpsertCtx,
  row: { updatedAt?: Date | string | null } | null,
  link: { lastSyncedAt: Date | string },
  relatedUpdatedAt: Array<Date | string | null | undefined> = [],
): boolean {
  return (
    ctx.ownershipMode === 'manual_wins' && wasTargetUpdatedAfterSync(row, link, relatedUpdatedAt)
  )
}

async function findCrosswalk(
  tx: Database,
  ctx: UpsertCtx,
  entity: SyncEntityKey,
  externalId: string,
) {
  const [r] = await tx
    .select()
    .from(syncCrosswalk)
    .where(
      and(
        eq(syncCrosswalk.tenantId, ctx.tenantId),
        eq(syncCrosswalk.connectionId, ctx.connectionId),
        eq(syncCrosswalk.entity, entity),
        eq(syncCrosswalk.externalId, externalId),
      ),
    )
    .limit(1)
  return r ?? null
}

async function findCanonicalOwner(
  tx: Database,
  ctx: UpsertCtx,
  entity: SyncEntityKey,
  canonicalId: string,
) {
  const [row] = await tx
    .select({
      connectionId: syncCrosswalk.connectionId,
      externalId: syncCrosswalk.externalId,
      sourceSystem: syncCrosswalk.sourceSystem,
    })
    .from(syncCrosswalk)
    .where(
      and(
        eq(syncCrosswalk.tenantId, ctx.tenantId),
        eq(syncCrosswalk.entity, entity),
        eq(syncCrosswalk.canonicalId, canonicalId),
      ),
    )
    .limit(1)
  return row ?? null
}

async function linkCrosswalk(
  tx: Database,
  ctx: UpsertCtx,
  entity: SyncEntityKey,
  externalId: string,
  canonicalId: string,
  rowHash: string,
) {
  if (ctx.dryRun) return
  await tx
    .insert(syncCrosswalk)
    .values({
      tenantId: ctx.tenantId,
      connectionId: ctx.connectionId,
      entity,
      sourceSystem: ctx.sourceSystem,
      externalId,
      canonicalId,
      rowHash,
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        syncCrosswalk.tenantId,
        syncCrosswalk.connectionId,
        syncCrosswalk.entity,
        syncCrosswalk.externalId,
      ],
      set: { canonicalId, rowHash, lastSyncedAt: new Date() },
    })
}

async function touchCrosswalk(tx: Database, ctx: UpsertCtx, id: string, rowHash?: string) {
  if (ctx.dryRun) return
  await tx
    .update(syncCrosswalk)
    .set(rowHash ? { rowHash, lastSyncedAt: new Date() } : { lastSyncedAt: new Date() })
    .where(eq(syncCrosswalk.id, id))
}

export async function upsertRecord(
  tx: Database,
  ctx: UpsertCtx,
  rec: CanonicalRecord,
): Promise<UpsertResult> {
  switch (rec.entity) {
    case 'people':
      return upsertPerson(tx, ctx, rec.externalId, rec.data)
    case 'org_unit':
      return upsertOrgUnit(tx, ctx, rec.externalId, rec.data)
    case 'equipment':
      return upsertEquipment(tx, ctx, rec.externalId, rec.data)
    case 'contact':
      return upsertContact(tx, ctx, rec.externalId, rec.data)
  }
}

// --- people ---------------------------------------------------------------

interface PersonFields {
  firstName: string
  lastName: string
  employeeNo: string | null
  email: string | null
  externalEmployeeId: string | null
  phone: string | null
  jobTitle: string | null
  hireDate: string | null
  status: 'active' | 'inactive' | 'terminated'
  departmentId: string | null
  tradeId: string | null
}

const PERSON_ROW_SELECTION = {
  id: people.id,
  firstName: people.firstName,
  lastName: people.lastName,
  employeeNo: people.employeeNo,
  externalEmployeeId: people.externalEmployeeId,
  email: people.email,
  phone: people.phone,
  jobTitle: primaryPersonTitleName(people.id, people.tenantId),
  hireDate: people.hireDate,
  status: people.status,
  departmentId: people.departmentId,
  tradeId: people.tradeId,
  metadata: people.metadata,
  updatedAt: people.updatedAt,
  deletedAt: people.deletedAt,
}

const PERSON_SYNC_SCALAR_KEYS = [
  'firstName',
  'lastName',
  'employeeNo',
  'externalEmployeeId',
  'email',
  'phone',
  'hireDate',
  'status',
  'departmentId',
  'tradeId',
] as const satisfies ReadonlyArray<Exclude<keyof PersonFields, 'jobTitle'>>

type PersonTitleRelationshipState = {
  id: string
  titleId: string
  titleName: string
  isPrimary: boolean
  isManuallyMaintained: boolean
  sourceConnectionId: string | null
  assignmentUpdatedAt: Date
  titleUpdatedAt: Date
  titleDeletedAt: Date | null
}

async function selectPersonTitleRelationshipState(
  tx: Database,
  ctx: UpsertCtx,
  personId: string,
): Promise<{
  primary: PersonTitleRelationshipState | null
  sourceOwned: PersonTitleRelationshipState | null
}> {
  const selection = {
    id: personTitleAssignments.id,
    titleId: personTitleAssignments.titleId,
    titleName: personTitles.name,
    isPrimary: personTitleAssignments.isPrimary,
    isManuallyMaintained: personTitleAssignments.isManuallyMaintained,
    sourceConnectionId: personTitleAssignments.sourceConnectionId,
    assignmentUpdatedAt: personTitleAssignments.updatedAt,
    titleUpdatedAt: personTitles.updatedAt,
    titleDeletedAt: personTitles.deletedAt,
  }
  const [primaryRows, sourceRows] = await Promise.all([
    tx
      .select(selection)
      .from(personTitleAssignments)
      .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
      .where(
        and(
          eq(personTitleAssignments.tenantId, ctx.tenantId),
          eq(personTitleAssignments.personId, personId),
          eq(personTitleAssignments.isPrimary, true),
        ),
      )
      .limit(1),
    tx
      .select(selection)
      .from(personTitleAssignments)
      .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
      .where(
        and(
          eq(personTitleAssignments.tenantId, ctx.tenantId),
          eq(personTitleAssignments.personId, personId),
          eq(personTitleAssignments.sourceConnectionId, ctx.connectionId),
        ),
      )
      .limit(1),
  ])
  return { primary: primaryRows[0] ?? null, sourceOwned: sourceRows[0] ?? null }
}

async function selectPreviousPersonSnapshot(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
): Promise<JsonRecord | null> {
  const [row] = await tx
    .select({ after: syncRecordChanges.after })
    .from(syncRecordChanges)
    .where(
      and(
        eq(syncRecordChanges.tenantId, ctx.tenantId),
        eq(syncRecordChanges.connectionId, ctx.connectionId),
        eq(syncRecordChanges.entity, 'people'),
        eq(syncRecordChanges.externalId, externalId),
        eq(syncRecordChanges.dryRun, false),
        inArray(syncRecordChanges.action, ['created', 'updated']),
        isNotNull(syncRecordChanges.after),
      ),
    )
    .orderBy(desc(syncRecordChanges.createdAt), desc(syncRecordChanges.id))
    .limit(1)
  return row?.after ?? null
}

function personScalarValuesMatch(
  row: Awaited<ReturnType<typeof selectPerson>>,
  fields: PersonFields,
  metadata?: JsonRecord,
): boolean {
  if (!row) return false
  for (const key of PERSON_SYNC_SCALAR_KEYS) {
    if (JSON.stringify(row[key]) !== JSON.stringify(fields[key])) return false
  }
  const currentMetadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as JsonRecord)
      : {}
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (JSON.stringify(currentMetadata[key]) !== JSON.stringify(value)) return false
  }
  return true
}

function personTitleValuesMatch(
  fields: PersonFields,
  titleState: Awaited<ReturnType<typeof selectPersonTitleRelationshipState>>,
): boolean {
  const desired = normalizeCatalogDisplayName(fields.jobTitle)
  // Blank means the source owns no title. A manual primary is valid and must
  // not be interpreted as source drift.
  if (!desired) return true
  const current = titleState.primary
  return (
    Boolean(current) &&
    current!.titleDeletedAt === null &&
    normalizeCatalogDisplayName(current!.titleName)?.toLocaleLowerCase() ===
      desired.toLocaleLowerCase()
  )
}

function personTitleOwnershipMatches(
  fields: PersonFields,
  titleState: Awaited<ReturnType<typeof selectPersonTitleRelationshipState>>,
): boolean {
  const desired = normalizeCatalogDisplayName(fields.jobTitle)
  const owned = titleState.sourceOwned
  if (!desired) return owned === null
  return (
    Boolean(owned) &&
    owned!.isPrimary &&
    owned!.titleDeletedAt === null &&
    normalizeCatalogDisplayName(owned!.titleName)?.toLocaleLowerCase() ===
      desired.toLocaleLowerCase()
  )
}

function personMatchesPreviousSnapshot(
  row: Awaited<ReturnType<typeof selectPerson>>,
  titleState: Awaited<ReturnType<typeof selectPersonTitleRelationshipState>>,
  previous: JsonRecord,
): boolean {
  if (!row) return false
  for (const key of PERSON_SYNC_SCALAR_KEYS) {
    if (JSON.stringify(row[key]) !== JSON.stringify(previous[key] ?? null)) return false
  }
  const previousTitle = normalizeCatalogDisplayName(previous.jobTitle)
  if (!previousTitle) return true
  const currentTitle = titleState.primary
  return (
    Boolean(currentTitle) &&
    currentTitle!.titleDeletedAt === null &&
    normalizeCatalogDisplayName(currentTitle!.titleName)?.toLowerCase() ===
      previousTitle.toLowerCase()
  )
}

function personTitleUpdatedAt(
  titleState: Awaited<ReturnType<typeof selectPersonTitleRelationshipState>>,
): Array<Date | null> {
  const relationships = [titleState.primary, titleState.sourceOwned].filter(
    (value, index, all): value is PersonTitleRelationshipState =>
      Boolean(value) && all.findIndex((candidate) => candidate?.id === value?.id) === index,
  )
  return relationships.flatMap((relationship) => [
    relationship.assignmentUpdatedAt,
    relationship.titleUpdatedAt,
  ])
}

function withPeopleMetadata(fields: PersonFields, metadata?: JsonRecord) {
  const { jobTitle: _jobTitle, ...personFields } = fields
  if (!metadata || Object.keys(metadata).length === 0) return personFields
  return {
    ...personFields,
    metadata: sql`${people.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  }
}

async function syncPrimaryPersonTitle(
  tx: Database,
  ctx: UpsertCtx,
  personId: string,
  jobTitle: string | null,
): Promise<string | null> {
  // Every title writer locks the parent person first. This gives the source
  // sync and the manual title actions one ordering point before either reads
  // or changes primary/source ownership.
  const [personOwner] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.tenantId, ctx.tenantId), eq(people.id, personId)))
    .limit(1)
    .for('update')
  if (!personOwner) throw new Error('Could not lock the person for title synchronization')

  const name = normalizeCatalogDisplayName(jobTitle)
  let titleId: string | null = null
  if (name) {
    // Title names arrive as source-system labels. Reuse the tenant catalogue
    // by the same normalized key as the database index so casing/spacing drift
    // cannot create duplicate titles. Stable ordering prefers an active row if
    // historical duplicates exist.
    const findTitle = async () => {
      const [row] = await tx
        .select({ id: personTitles.id, name: personTitles.name, deletedAt: personTitles.deletedAt })
        .from(personTitles)
        .where(
          and(
            eq(personTitles.tenantId, ctx.tenantId),
            eq(normalizedCatalogNameSql(personTitles.name), normalizedCatalogNameSql(sql`${name}`)),
          ),
        )
        .orderBy(
          sql`${personTitles.deletedAt} is null desc`,
          personTitles.createdAt,
          personTitles.id,
        )
        .limit(1)
        .for('key share')
      return row
    }
    let title = await findTitle()
    if (title?.deletedAt) {
      ;[title] = await tx
        .update(personTitles)
        .set({ deletedAt: null })
        .where(eq(personTitles.id, title.id))
        .returning({
          id: personTitles.id,
          name: personTitles.name,
          deletedAt: personTitles.deletedAt,
        })
    } else if (!title) {
      ;[title] = await tx
        .insert(personTitles)
        .values({ tenantId: ctx.tenantId, name })
        .onConflictDoNothing()
        .returning({
          id: personTitles.id,
          name: personTitles.name,
          deletedAt: personTitles.deletedAt,
        })
      // Another sync can create the same normalized catalogue row between our
      // lookup and insert. The unique index arbitrates; resolve the winner.
      title ??= await findTitle()
    }
    if (!title) throw new Error('Could not resolve the synced job title')
    titleId = title.id
  }

  const [owned] = await tx
    .select({
      id: personTitleAssignments.id,
      titleId: personTitleAssignments.titleId,
      isPrimary: personTitleAssignments.isPrimary,
      isManuallyMaintained: personTitleAssignments.isManuallyMaintained,
    })
    .from(personTitleAssignments)
    .where(
      and(
        eq(personTitleAssignments.tenantId, ctx.tenantId),
        eq(personTitleAssignments.personId, personId),
        eq(personTitleAssignments.sourceConnectionId, ctx.connectionId),
      ),
    )
    .limit(1)
    .for('update')

  // Release the previous source relationship first. A row that was also
  // selected manually remains a manual assignment; a source-only row can be
  // removed. This distinction prevents a matching manual secondary from being
  // silently adopted and later deleted by sync replay.
  if (owned && owned.titleId !== titleId) {
    if (owned.isManuallyMaintained) {
      await tx
        .update(personTitleAssignments)
        .set({ sourceConnectionId: null })
        .where(eq(personTitleAssignments.id, owned.id))
    } else {
      await tx.delete(personTitleAssignments).where(eq(personTitleAssignments.id, owned.id))
    }
  }

  if (titleId) {
    const [existing] = await tx
      .select({
        id: personTitleAssignments.id,
        sourceConnectionId: personTitleAssignments.sourceConnectionId,
      })
      .from(personTitleAssignments)
      .where(
        and(
          eq(personTitleAssignments.tenantId, ctx.tenantId),
          eq(personTitleAssignments.personId, personId),
          eq(personTitleAssignments.titleId, titleId),
        ),
      )
      .limit(1)
      .for('update')
    if (existing?.sourceConnectionId && existing.sourceConnectionId !== ctx.connectionId) {
      throw new Error('The target title assignment is owned by another sync connection')
    }
    if (existing) {
      await tx
        .update(personTitleAssignments)
        .set({ isPrimary: false })
        .where(
          and(
            eq(personTitleAssignments.tenantId, ctx.tenantId),
            eq(personTitleAssignments.personId, personId),
            ne(personTitleAssignments.id, existing.id),
          ),
        )
      await tx
        .update(personTitleAssignments)
        .set({ isPrimary: true, sourceConnectionId: ctx.connectionId })
        .where(eq(personTitleAssignments.id, existing.id))
    } else {
      await tx
        .update(personTitleAssignments)
        .set({ isPrimary: false })
        .where(
          and(
            eq(personTitleAssignments.tenantId, ctx.tenantId),
            eq(personTitleAssignments.personId, personId),
          ),
        )
      await tx.insert(personTitleAssignments).values({
        tenantId: ctx.tenantId,
        personId,
        titleId,
        isPrimary: true,
        sourceConnectionId: ctx.connectionId,
        isManuallyMaintained: false,
      })
    }
  } else if (owned?.isPrimary && !owned.isManuallyMaintained) {
    // A blank source value removed its source-only primary. Promote one of the
    // remaining manual titles deterministically; blank never deletes or
    // demotes a co-owned manual primary.
    const [nextPrimary] = await tx
      .select({ id: personTitleAssignments.id })
      .from(personTitleAssignments)
      .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
      .where(
        and(
          eq(personTitleAssignments.tenantId, ctx.tenantId),
          eq(personTitleAssignments.personId, personId),
          isNull(personTitles.deletedAt),
        ),
      )
      .orderBy(personTitles.name, personTitleAssignments.titleId)
      .limit(1)
    if (nextPrimary) {
      await tx
        .update(personTitleAssignments)
        .set({ isPrimary: true })
        .where(eq(personTitleAssignments.id, nextPrimary.id))
    }
  }

  const assignments = await tx
    .select({ titleId: personTitleAssignments.titleId })
    .from(personTitleAssignments)
    .where(
      and(
        eq(personTitleAssignments.tenantId, ctx.tenantId),
        eq(personTitleAssignments.personId, personId),
      ),
    )
    .orderBy(personTitleAssignments.titleId)
  await tx
    .update(people)
    .set({ titleIds: assignments.map((assignment) => assignment.titleId) })
    .where(eq(people.id, personId))

  const [primary] = await tx
    .select({ name: personTitles.name })
    .from(personTitleAssignments)
    .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
    .where(
      and(
        eq(personTitleAssignments.tenantId, ctx.tenantId),
        eq(personTitleAssignments.personId, personId),
        eq(personTitleAssignments.isPrimary, true),
        isNull(personTitles.deletedAt),
      ),
    )
    .limit(1)
  return primary?.name ?? null
}

function rememberPersonLookup(ctx: UpsertCtx, id: string, fields: PersonFields) {
  if (fields.employeeNo) {
    ctx.lookups.personIdByEmployeeNo.set(fields.employeeNo.toLowerCase(), id)
  }
  if (fields.externalEmployeeId) {
    ctx.lookups.personIdByExternalEmployeeId.set(fields.externalEmployeeId.toLowerCase(), id)
  }
}

async function selectPerson(tx: Database, id: string) {
  const [row] = await tx
    .select(PERSON_ROW_SELECTION)
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .limit(1)
  return row ?? null
}

async function selectPersonForUpdate(tx: Database, id: string) {
  const [row] = await tx
    .select(PERSON_ROW_SELECTION)
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .limit(1)
    .for('update')
  return row ?? null
}

// Same as selectPerson but does NOT filter soft-deleted rows — used to detect a
// crosswalk-linked row that was locally archived, so we restore/conflict it
// instead of inserting a shadow duplicate.
async function selectPersonAnyState(tx: Database, id: string) {
  const [row] = await tx.select(PERSON_ROW_SELECTION).from(people).where(eq(people.id, id)).limit(1)
  return row ?? null
}

async function findPersonByExternalEmployeeId(
  tx: Database,
  ctx: UpsertCtx,
  externalEmployeeId: string,
) {
  const [row] = await tx
    .select(PERSON_ROW_SELECTION)
    .from(people)
    .where(
      and(
        eq(people.tenantId, ctx.tenantId),
        eq(people.externalEmployeeId, externalEmployeeId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

async function findPersonByEmployeeNo(tx: Database, ctx: UpsertCtx, employeeNo: string) {
  const [row] = await tx
    .select(PERSON_ROW_SELECTION)
    .from(people)
    .where(
      and(
        eq(people.tenantId, ctx.tenantId),
        eq(people.employeeNo, employeeNo),
        isNull(people.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

function personAfter(
  fields: PersonFields,
  before: JsonRecord | null,
  metadata?: JsonRecord,
): JsonRecord {
  return {
    id: before?.id,
    ...fields,
    metadata: metadataMerge(before, metadata),
  }
}

function personOwnershipConflict(
  match: NonNullable<Awaited<ReturnType<typeof selectPerson>>>,
  fields: PersonFields,
  rowHash: string,
  metadata: JsonRecord | undefined,
  owner: { sourceSystem: string; externalId: string },
): UpsertResult {
  const before = snap(match)
  const after = personAfter(fields, before, metadata)
  return {
    action: 'conflict',
    canonicalId: match.id,
    rowHash,
    before,
    after,
    diff: diff(before, after),
    message: `Natural-key match is already owned by ${owner.sourceSystem} record "${owner.externalId}".`,
  }
}

async function adoptNaturalPersonMatch(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  match: NonNullable<Awaited<ReturnType<typeof selectPerson>>>,
  fields: PersonFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  // The initial natural-key lookup is intentionally only a candidate search.
  // Lock and re-read before any ownership/manual-wins decision so two sources
  // cannot both observe an unowned person and claim it concurrently.
  const lockedMatch = await selectPersonForUpdate(tx, match.id)
  if (!lockedMatch) return createPerson(tx, ctx, externalId, fields, rowHash, metadata)

  const owner = await findCanonicalOwner(tx, ctx, 'people', lockedMatch.id)
  if (owner) return personOwnershipConflict(lockedMatch, fields, rowHash, metadata, owner)

  const titleState = await selectPersonTitleRelationshipState(tx, ctx, lockedMatch.id)
  if (
    decideNaturalPersonAdoption({
      ownershipMode: ctx.ownershipMode ?? 'source_wins',
      scalarValuesMatch: personScalarValuesMatch(lockedMatch, fields, metadata),
      titleValuesMatch: personTitleValuesMatch(fields, titleState),
    }) === 'conflict'
  ) {
    const before = snap(lockedMatch)
    const after = personAfter(fields, before, metadata)
    return {
      action: 'conflict',
      canonicalId: lockedMatch.id,
      rowHash,
      before,
      after,
      diff: diff(before, after),
      message: 'Natural-key match contains manually maintained values that differ from the source.',
    }
  }

  return updatePerson(tx, ctx, externalId, lockedMatch, fields, rowHash, metadata)
}

async function createPerson(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  fields: PersonFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  if (ctx.dryRun) {
    const after = { ...fields, metadata: metadata ?? {} }
    return { action: 'created', rowHash, before: null, after, diff: diff(null, after) }
  }
  const id = firstId(
    await tx
      .insert(people)
      .values({ tenantId: ctx.tenantId, ...withPeopleMetadata(fields), metadata: metadata ?? {} })
      .returning({ id: people.id }),
  )
  const jobTitle = await syncPrimaryPersonTitle(tx, ctx, id, fields.jobTitle)
  const after = { ...fields, jobTitle, metadata: metadata ?? {} }
  await linkCrosswalk(tx, ctx, 'people', externalId, id, rowHash)
  rememberPersonLookup(ctx, id, fields)
  return {
    action: 'created',
    canonicalId: id,
    rowHash,
    before: null,
    after: { id, ...after },
    diff: diff(null, { id, ...after }),
  }
}

async function updatePerson(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  beforeRow: Awaited<ReturnType<typeof selectPerson>>,
  fields: PersonFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  if (!beforeRow) return createPerson(tx, ctx, externalId, fields, rowHash, metadata)
  const before = snap(beforeRow)
  let persistedFields = fields
  if (!ctx.dryRun) {
    await tx
      .update(people)
      .set(withPeopleMetadata(fields, metadata))
      .where(eq(people.id, beforeRow.id))
    const jobTitle = await syncPrimaryPersonTitle(tx, ctx, beforeRow.id, fields.jobTitle)
    persistedFields = { ...fields, jobTitle }
    await linkCrosswalk(tx, ctx, 'people', externalId, beforeRow.id, rowHash)
    rememberPersonLookup(ctx, beforeRow.id, fields)
  }
  const after = personAfter(persistedFields, before, metadata)
  return {
    action: 'updated',
    canonicalId: beforeRow.id,
    rowHash,
    before,
    after: { ...after, id: beforeRow.id },
    diff: diff(before, { ...after, id: beforeRow.id }),
  }
}

// A crosswalk link resolved to a row that no longer counts as active. Either it
// was locally archived (soft-deleted) — restore or conflict per ownership — or
// it was hard-deleted / lost, in which case a fresh insert is correct.
async function restorePersonOrConflict(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  link: { canonicalId: string; lastSyncedAt: Date | string },
  fields: PersonFields,
  rowHash: string,
  metadata: JsonRecord | undefined,
): Promise<UpsertResult | null> {
  const archived = await selectPersonAnyState(tx, link.canonicalId)
  if (!archived || !archived.deletedAt) return null // gone entirely — caller inserts
  const before = snap(archived)
  let persistedFields = fields
  let after = personAfter(persistedFields, before, metadata)
  const titleState = await selectPersonTitleRelationshipState(tx, ctx, archived.id)
  if (isManualConflict(ctx, archived, link, personTitleUpdatedAt(titleState))) {
    return {
      action: 'conflict',
      canonicalId: archived.id,
      rowHash,
      before,
      after: { ...after, id: archived.id },
      diff: diff(before, { ...after, id: archived.id }),
      message: 'Record was archived locally after the last sync; ownership policy requires review.',
    }
  }
  // source_wins — un-archive and update in place rather than shadow a duplicate.
  if (!ctx.dryRun) {
    await tx
      .update(people)
      .set({ ...withPeopleMetadata(fields, metadata), deletedAt: null })
      .where(eq(people.id, archived.id))
    const jobTitle = await syncPrimaryPersonTitle(tx, ctx, archived.id, fields.jobTitle)
    persistedFields = { ...fields, jobTitle }
    after = personAfter(persistedFields, before, metadata)
    await linkCrosswalk(tx, ctx, 'people', externalId, archived.id, rowHash)
    rememberPersonLookup(ctx, archived.id, fields)
  }
  return {
    action: 'updated',
    canonicalId: archived.id,
    rowHash,
    before,
    after: { ...after, id: archived.id },
    diff: diff(before, { ...after, id: archived.id }),
    message: 'Restored a locally archived record from the source.',
  }
}

async function upsertPerson(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalPerson,
): Promise<UpsertResult> {
  if (!data.firstName || !data.lastName) {
    const message = `person "${externalId}" is missing a first/last name`
    ctx.log('warn', `${message} — skipped`)
    return { action: 'skipped', message }
  }
  const normalizedJobTitle = normalizeCatalogDisplayName(data.jobTitle)
  const rowHash = hashData({ ...data, jobTitle: normalizedJobTitle })
  const metadata = data.metadata as JsonRecord | undefined
  const fields: PersonFields = {
    firstName: data.firstName,
    lastName: data.lastName,
    employeeNo: data.employeeNo ?? null,
    externalEmployeeId: data.externalEmployeeId ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    jobTitle: normalizedJobTitle,
    hireDate: data.hireDate ?? null,
    status: data.status ?? 'active',
    departmentId: data.departmentName
      ? (ctx.lookups.deptByName.get(
          normalizeCatalogDisplayName(data.departmentName)?.toLowerCase() ?? '',
        ) ?? null)
      : null,
    tradeId: data.tradeName
      ? (ctx.lookups.tradeByName.get(
          normalizeCatalogDisplayName(data.tradeName)?.toLowerCase() ?? '',
        ) ?? null)
      : null,
  }

  const link = await findCrosswalk(tx, ctx, 'people', externalId)
  if (link) {
    const beforeRow = await selectPerson(tx, link.canonicalId)
    if (!beforeRow) {
      const restored = await restorePersonOrConflict(
        tx,
        ctx,
        externalId,
        link,
        fields,
        rowHash,
        metadata,
      )
      if (restored) {
        if (!ctx.dryRun && restored.action !== 'conflict') {
          await touchCrosswalk(tx, ctx, link.id, rowHash)
        }
        return restored
      }
      return createPerson(tx, ctx, externalId, fields, rowHash, metadata)
    }
    const titleState = await selectPersonTitleRelationshipState(tx, ctx, link.canonicalId)
    const scalarValuesMatch = personScalarValuesMatch(beforeRow, fields, metadata)
    const titleValuesMatch = personTitleValuesMatch(fields, titleState)
    const titleOwnershipMatches = personTitleOwnershipMatches(fields, titleState)
    const sourceChanged = link.rowHash !== rowHash
    const previousSnapshot =
      sourceChanged && ctx.ownershipMode === 'manual_wins'
        ? await selectPreviousPersonSnapshot(tx, ctx, externalId)
        : null
    const decision = decidePersonSync({
      ownershipMode: ctx.ownershipMode ?? 'source_wins',
      sourceChanged,
      scalarValuesMatch,
      titleValuesMatch,
      titleOwnershipMatches,
      targetChangedAfterLastSync: previousSnapshot
        ? !personMatchesPreviousSnapshot(beforeRow, titleState, previousSnapshot)
        : wasTargetUpdatedAfterSync(beforeRow, link, personTitleUpdatedAt(titleState)),
    })
    if (decision === 'unchanged') {
      await touchCrosswalk(tx, ctx, link.id)
      rememberPersonLookup(ctx, link.canonicalId, fields)
      return { action: 'unchanged', canonicalId: link.canonicalId, rowHash }
    }
    // With an unchanged source hash, any visible value mismatch is necessarily
    // target drift. source_wins repairs it; manual_wins records a conflict.
    // Missing provenance alone is safe to claim when the visible title already
    // matches, because the assignment remains marked as manually maintained.
    if (decision === 'conflict') {
      return {
        action: 'conflict',
        canonicalId: link.canonicalId,
        rowHash,
        before: snap(beforeRow),
        after: personAfter(fields, snap(beforeRow), metadata),
        diff: diff(snap(beforeRow), personAfter(fields, snap(beforeRow), metadata)),
        message: conflictMessage(),
      }
    }
    const res = await updatePerson(tx, ctx, externalId, beforeRow, fields, rowHash, metadata)
    if (!ctx.dryRun) await touchCrosswalk(tx, ctx, link.id, rowHash)
    return res
  }

  if (fields.externalEmployeeId) {
    const match = await findPersonByExternalEmployeeId(tx, ctx, fields.externalEmployeeId)
    if (match) return adoptNaturalPersonMatch(tx, ctx, externalId, match, fields, rowHash, metadata)
  }

  if (fields.employeeNo) {
    const match = await findPersonByEmployeeNo(tx, ctx, fields.employeeNo)
    if (match) return adoptNaturalPersonMatch(tx, ctx, externalId, match, fields, rowHash, metadata)
  }

  return createPerson(tx, ctx, externalId, fields, rowHash, metadata)
}

// --- org_unit (locations + projects) --------------------------------------

interface OrgUnitFields {
  level: 'customer' | 'project' | 'site' | 'area'
  name: string
  code: string | null
  parentId: string | null
  lat: number | null
  lng: number | null
  geofenceMeters: number | null
  address: CanonicalOrgUnit['address']
}

const ORG_UNIT_ROW_SELECTION = {
  id: orgUnits.id,
  level: orgUnits.level,
  name: orgUnits.name,
  code: orgUnits.code,
  parentId: orgUnits.parentId,
  lat: orgUnits.lat,
  lng: orgUnits.lng,
  geofenceMeters: orgUnits.geofenceMeters,
  address: orgUnits.address,
  metadata: orgUnits.metadata,
  updatedAt: orgUnits.updatedAt,
  deletedAt: orgUnits.deletedAt,
}

function withOrgUnitMetadata(fields: OrgUnitFields, metadata?: JsonRecord) {
  if (!metadata || Object.keys(metadata).length === 0) return fields
  return {
    ...fields,
    metadata: sql`${orgUnits.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  }
}

async function selectOrgUnit(tx: Database, id: string) {
  const [row] = await tx
    .select(ORG_UNIT_ROW_SELECTION)
    .from(orgUnits)
    .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
    .limit(1)
  return row ?? null
}

async function selectOrgUnitAnyState(tx: Database, id: string) {
  const [row] = await tx
    .select(ORG_UNIT_ROW_SELECTION)
    .from(orgUnits)
    .where(eq(orgUnits.id, id))
    .limit(1)
  return row ?? null
}

async function findOrgUnitByCode(tx: Database, ctx: UpsertCtx, code: string) {
  const [row] = await tx
    .select(ORG_UNIT_ROW_SELECTION)
    .from(orgUnits)
    .where(
      and(eq(orgUnits.tenantId, ctx.tenantId), eq(orgUnits.code, code), isNull(orgUnits.deletedAt)),
    )
    .limit(1)
  return row ?? null
}

function orgUnitAfter(
  fields: OrgUnitFields,
  before: JsonRecord | null,
  metadata?: JsonRecord,
): JsonRecord {
  return {
    id: before?.id,
    ...fields,
    metadata: metadataMerge(before, metadata),
  }
}

async function createOrgUnit(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  fields: OrgUnitFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  const after = { ...fields, metadata: metadata ?? {} }
  if (ctx.dryRun)
    return { action: 'created', rowHash, before: null, after, diff: diff(null, after) }
  const id = firstId(
    await tx
      .insert(orgUnits)
      .values({ tenantId: ctx.tenantId, ...fields, metadata: metadata ?? {} })
      .returning({ id: orgUnits.id }),
  )
  await linkCrosswalk(tx, ctx, 'org_unit', externalId, id, rowHash)
  if (fields.code) ctx.lookups.orgUnitIdByCode.set(fields.code.toLowerCase(), id)
  return {
    action: 'created',
    canonicalId: id,
    rowHash,
    before: null,
    after: { id, ...after },
    diff: diff(null, { id, ...after }),
  }
}

async function updateOrgUnit(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  beforeRow: Awaited<ReturnType<typeof selectOrgUnit>>,
  fields: OrgUnitFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  if (!beforeRow) return createOrgUnit(tx, ctx, externalId, fields, rowHash, metadata)
  const before = snap(beforeRow)
  const after = { ...orgUnitAfter(fields, before, metadata), id: beforeRow.id }
  if (!ctx.dryRun) {
    await tx
      .update(orgUnits)
      .set(withOrgUnitMetadata(fields, metadata))
      .where(eq(orgUnits.id, beforeRow.id))
    await linkCrosswalk(tx, ctx, 'org_unit', externalId, beforeRow.id, rowHash)
    if (fields.code) ctx.lookups.orgUnitIdByCode.set(fields.code.toLowerCase(), beforeRow.id)
  }
  return {
    action: 'updated',
    canonicalId: beforeRow.id,
    rowHash,
    before,
    after,
    diff: diff(before, after),
  }
}

async function restoreOrgUnitOrConflict(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  link: { canonicalId: string; lastSyncedAt: Date | string },
  fields: OrgUnitFields,
  rowHash: string,
  metadata: JsonRecord | undefined,
): Promise<UpsertResult | null> {
  const archived = await selectOrgUnitAnyState(tx, link.canonicalId)
  if (!archived || !archived.deletedAt) return null
  const before = snap(archived)
  const after = { ...orgUnitAfter(fields, before, metadata), id: archived.id }
  if (isManualConflict(ctx, archived, link)) {
    return {
      action: 'conflict',
      canonicalId: archived.id,
      rowHash,
      before,
      after,
      diff: diff(before, after),
      message: 'Record was archived locally after the last sync; ownership policy requires review.',
    }
  }
  if (!ctx.dryRun) {
    await tx
      .update(orgUnits)
      .set({ ...withOrgUnitMetadata(fields, metadata), deletedAt: null })
      .where(eq(orgUnits.id, archived.id))
    await linkCrosswalk(tx, ctx, 'org_unit', externalId, archived.id, rowHash)
    if (fields.code) ctx.lookups.orgUnitIdByCode.set(fields.code.toLowerCase(), archived.id)
  }
  return {
    action: 'updated',
    canonicalId: archived.id,
    rowHash,
    before,
    after,
    diff: diff(before, after),
    message: 'Restored a locally archived record from the source.',
  }
}

async function upsertOrgUnit(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalOrgUnit,
): Promise<UpsertResult> {
  if (!data.name) {
    const message = `location "${externalId}" is missing a name`
    ctx.log('warn', `${message} — skipped`)
    return { action: 'skipped', message }
  }
  const rowHash = hashData(data)
  const metadata = data.metadata as JsonRecord | undefined
  const code = data.code ?? null
  const fields: OrgUnitFields = {
    level: data.level ?? 'site',
    name: data.name,
    code,
    parentId: data.parentCode
      ? (ctx.lookups.orgUnitIdByCode.get(data.parentCode.toLowerCase()) ?? null)
      : null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    geofenceMeters: data.geofenceMeters ?? null,
    address: data.address ?? null,
  }

  const link = await findCrosswalk(tx, ctx, 'org_unit', externalId)
  if (link) {
    const beforeRow = await selectOrgUnit(tx, link.canonicalId)
    if (!beforeRow) {
      const restored = await restoreOrgUnitOrConflict(
        tx,
        ctx,
        externalId,
        link,
        fields,
        rowHash,
        metadata,
      )
      if (restored) {
        if (!ctx.dryRun && restored.action !== 'conflict') {
          await touchCrosswalk(tx, ctx, link.id, rowHash)
        }
        return restored
      }
      return createOrgUnit(tx, ctx, externalId, fields, rowHash, metadata)
    }
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, ctx, link.id)
      if (code) ctx.lookups.orgUnitIdByCode.set(code.toLowerCase(), link.canonicalId)
      return { action: 'unchanged', canonicalId: link.canonicalId, rowHash }
    }
    if (isManualConflict(ctx, beforeRow, link)) {
      const before = snap(beforeRow)
      const after = { ...orgUnitAfter(fields, before, metadata), id: link.canonicalId }
      return {
        action: 'conflict',
        canonicalId: link.canonicalId,
        rowHash,
        before,
        after,
        diff: diff(before, after),
        message: conflictMessage(),
      }
    }
    const res = await updateOrgUnit(tx, ctx, externalId, beforeRow, fields, rowHash, metadata)
    if (!ctx.dryRun) await touchCrosswalk(tx, ctx, link.id, rowHash)
    return res
  }

  if (code) {
    const match = await findOrgUnitByCode(tx, ctx, code)
    if (match) return updateOrgUnit(tx, ctx, externalId, match, fields, rowHash, metadata)
  }

  return createOrgUnit(tx, ctx, externalId, fields, rowHash, metadata)
}

// --- equipment ------------------------------------------------------------

interface EquipFields {
  assetTag: string
  name: string
  serialNumber: string | null
  description: string | null
  status: 'in_service' | 'out_of_service' | 'in_repair' | 'lost' | 'retired'
  typeId: string | null
}

const EQUIPMENT_ROW_SELECTION = {
  id: equipmentItems.id,
  assetTag: equipmentItems.assetTag,
  name: equipmentItems.name,
  serialNumber: equipmentItems.serialNumber,
  description: equipmentItems.description,
  status: equipmentItems.status,
  typeId: equipmentItems.typeId,
  metadata: equipmentItems.metadata,
  updatedAt: equipmentItems.updatedAt,
  deletedAt: equipmentItems.deletedAt,
}

function withEquipmentMetadata(fields: EquipFields, metadata?: JsonRecord) {
  if (!metadata || Object.keys(metadata).length === 0) return fields
  return {
    ...fields,
    metadata: sql`${equipmentItems.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  }
}

async function selectEquipment(tx: Database, id: string) {
  const [row] = await tx
    .select(EQUIPMENT_ROW_SELECTION)
    .from(equipmentItems)
    .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
    .limit(1)
  return row ?? null
}

async function selectEquipmentAnyState(tx: Database, id: string) {
  const [row] = await tx
    .select(EQUIPMENT_ROW_SELECTION)
    .from(equipmentItems)
    .where(eq(equipmentItems.id, id))
    .limit(1)
  return row ?? null
}

async function findEquipmentByAssetTag(tx: Database, ctx: UpsertCtx, assetTag: string) {
  const [row] = await tx
    .select(EQUIPMENT_ROW_SELECTION)
    .from(equipmentItems)
    .where(
      and(
        eq(equipmentItems.tenantId, ctx.tenantId),
        eq(equipmentItems.assetTag, assetTag),
        isNull(equipmentItems.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

function equipmentAfter(
  fields: EquipFields,
  before: JsonRecord | null,
  metadata?: JsonRecord,
): JsonRecord {
  return {
    id: before?.id,
    ...fields,
    metadata: metadataMerge(before, metadata),
  }
}

async function createEquipment(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  fields: EquipFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  const after = { ...fields, metadata: metadata ?? {} }
  if (ctx.dryRun)
    return { action: 'created', rowHash, before: null, after, diff: diff(null, after) }
  const id = firstId(
    await tx
      .insert(equipmentItems)
      .values({
        tenantId: ctx.tenantId,
        ...fields,
        qrToken: randomBytes(12).toString('base64url'),
        metadata: metadata ?? {},
      })
      .returning({ id: equipmentItems.id }),
  )
  await linkCrosswalk(tx, ctx, 'equipment', externalId, id, rowHash)
  return {
    action: 'created',
    canonicalId: id,
    rowHash,
    before: null,
    after: { id, ...after },
    diff: diff(null, { id, ...after }),
  }
}

async function updateEquipment(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  beforeRow: Awaited<ReturnType<typeof selectEquipment>>,
  fields: EquipFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  if (!beforeRow) return createEquipment(tx, ctx, externalId, fields, rowHash, metadata)
  const before = snap(beforeRow)
  const after = { ...equipmentAfter(fields, before, metadata), id: beforeRow.id }
  if (!ctx.dryRun) {
    await tx
      .update(equipmentItems)
      .set(withEquipmentMetadata(fields, metadata))
      .where(eq(equipmentItems.id, beforeRow.id))
    await linkCrosswalk(tx, ctx, 'equipment', externalId, beforeRow.id, rowHash)
  }
  return {
    action: 'updated',
    canonicalId: beforeRow.id,
    rowHash,
    before,
    after,
    diff: diff(before, after),
  }
}

async function restoreEquipmentOrConflict(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  link: { canonicalId: string; lastSyncedAt: Date | string },
  fields: EquipFields,
  rowHash: string,
  metadata: JsonRecord | undefined,
): Promise<UpsertResult | null> {
  const archived = await selectEquipmentAnyState(tx, link.canonicalId)
  if (!archived || !archived.deletedAt) return null
  const before = snap(archived)
  const after = { ...equipmentAfter(fields, before, metadata), id: archived.id }
  if (isManualConflict(ctx, archived, link)) {
    return {
      action: 'conflict',
      canonicalId: archived.id,
      rowHash,
      before,
      after,
      diff: diff(before, after),
      message: 'Record was archived locally after the last sync; ownership policy requires review.',
    }
  }
  if (!ctx.dryRun) {
    await tx
      .update(equipmentItems)
      .set({ ...withEquipmentMetadata(fields, metadata), deletedAt: null })
      .where(eq(equipmentItems.id, archived.id))
    await linkCrosswalk(tx, ctx, 'equipment', externalId, archived.id, rowHash)
  }
  return {
    action: 'updated',
    canonicalId: archived.id,
    rowHash,
    before,
    after,
    diff: diff(before, after),
    message: 'Restored a locally archived record from the source.',
  }
}

async function upsertEquipment(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalEquipment,
): Promise<UpsertResult> {
  if (!data.assetTag) {
    const message = `equipment "${externalId}" is missing an asset tag`
    ctx.log('warn', `${message} — skipped`)
    return { action: 'skipped', message }
  }
  const rowHash = hashData(data)
  const metadata = data.metadata as JsonRecord | undefined
  const fields: EquipFields = {
    assetTag: data.assetTag,
    name: data.name || data.assetTag,
    serialNumber: data.serialNumber ?? null,
    description: data.description ?? null,
    status: data.status ?? 'in_service',
    typeId: data.typeName
      ? (ctx.lookups.equipTypeByName.get(data.typeName.toLowerCase()) ?? null)
      : null,
  }

  const link = await findCrosswalk(tx, ctx, 'equipment', externalId)
  if (link) {
    const beforeRow = await selectEquipment(tx, link.canonicalId)
    if (!beforeRow) {
      const restored = await restoreEquipmentOrConflict(
        tx,
        ctx,
        externalId,
        link,
        fields,
        rowHash,
        metadata,
      )
      if (restored) {
        if (!ctx.dryRun && restored.action !== 'conflict') {
          await touchCrosswalk(tx, ctx, link.id, rowHash)
        }
        return restored
      }
      return createEquipment(tx, ctx, externalId, fields, rowHash, metadata)
    }
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, ctx, link.id)
      return { action: 'unchanged', canonicalId: link.canonicalId, rowHash }
    }
    if (isManualConflict(ctx, beforeRow, link)) {
      const before = snap(beforeRow)
      const after = { ...equipmentAfter(fields, before, metadata), id: link.canonicalId }
      return {
        action: 'conflict',
        canonicalId: link.canonicalId,
        rowHash,
        before,
        after,
        diff: diff(before, after),
        message: conflictMessage(),
      }
    }
    const res = await updateEquipment(tx, ctx, externalId, beforeRow, fields, rowHash, metadata)
    if (!ctx.dryRun) await touchCrosswalk(tx, ctx, link.id, rowHash)
    return res
  }

  const match = await findEquipmentByAssetTag(tx, ctx, fields.assetTag)
  if (match) return updateEquipment(tx, ctx, externalId, match, fields, rowHash, metadata)

  return createEquipment(tx, ctx, externalId, fields, rowHash, metadata)
}

// --- contact (customer / location contacts) -------------------------------
// Links to its parent location via the org_unit crosswalk (the customer must be
// synced first — it is, since the connector emits org_units before contacts).
// customer_contacts has no soft-delete, so a crosswalk-linked contact missing
// from a full sync is hard-deleted (never touches user-created contacts, which
// have no crosswalk row).

interface ContactFields {
  orgUnitId: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
}

async function selectContact(tx: Database, id: string) {
  const [row] = await tx
    .select({
      id: customerContacts.id,
      orgUnitId: customerContacts.orgUnitId,
      name: customerContacts.name,
      role: customerContacts.role,
      email: customerContacts.email,
      phone: customerContacts.phone,
      notes: customerContacts.notes,
      isPrimary: customerContacts.isPrimary,
      updatedAt: customerContacts.updatedAt,
    })
    .from(customerContacts)
    .where(eq(customerContacts.id, id))
    .limit(1)
  return row ?? null
}

async function createContact(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  fields: ContactFields,
  rowHash: string,
): Promise<UpsertResult> {
  const after = { ...fields }
  if (ctx.dryRun)
    return { action: 'created', rowHash, before: null, after, diff: diff(null, after) }
  const id = firstId(
    await tx
      .insert(customerContacts)
      .values({ tenantId: ctx.tenantId, ...fields })
      .returning({ id: customerContacts.id }),
  )
  await linkCrosswalk(tx, ctx, 'contact', externalId, id, rowHash)
  return {
    action: 'created',
    canonicalId: id,
    rowHash,
    before: null,
    after: { id, ...after },
    diff: diff(null, { id, ...after }),
  }
}

async function upsertContact(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalContact,
): Promise<UpsertResult> {
  if (!data.name) {
    const message = `contact "${externalId}" is missing a name`
    ctx.log('warn', `${message} — skipped`)
    return { action: 'skipped', message }
  }
  // Resolve the parent location through the org_unit crosswalk.
  const orgLink = await findCrosswalk(tx, ctx, 'org_unit', data.customerExternalId)
  if (!orgLink) {
    const message = `contact "${externalId}" → customer "${data.customerExternalId}" is not synced`
    ctx.log('warn', `${message} — skipped`)
    return { action: 'skipped', message }
  }
  // Only attach contacts to a LIVE customer. A soft-deleted parent (e.g. a
  // customer that reverted from closed-won to a prospect) shouldn't accrue
  // contacts — skip and leave any existing contact untouched. selectOrgUnit
  // filters soft-deleted rows, so a null here means the parent is archived/gone.
  const parent = await selectOrgUnit(tx, orgLink.canonicalId)
  if (!parent) {
    const message = `contact "${externalId}" → customer "${data.customerExternalId}" is archived`
    ctx.log('warn', `${message} — skipped`)
    return { action: 'skipped', message }
  }
  const rowHash = hashData(data)
  const fields: ContactFields = {
    orgUnitId: orgLink.canonicalId,
    name: data.name,
    role: data.role ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    notes: data.notes ?? null,
    isPrimary: data.isPrimary ?? false,
  }

  const link = await findCrosswalk(tx, ctx, 'contact', externalId)
  if (link) {
    const beforeRow = await selectContact(tx, link.canonicalId)
    if (!beforeRow) return createContact(tx, ctx, externalId, fields, rowHash) // gone → recreate
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, ctx, link.id)
      return { action: 'unchanged', canonicalId: link.canonicalId, rowHash }
    }
    const before = snap(beforeRow)
    const after = { id: beforeRow.id, ...fields }
    if (!ctx.dryRun) {
      await tx.update(customerContacts).set(fields).where(eq(customerContacts.id, beforeRow.id))
      await touchCrosswalk(tx, ctx, link.id, rowHash)
    }
    return {
      action: 'updated',
      canonicalId: beforeRow.id,
      rowHash,
      before,
      after,
      diff: diff(before, after),
    }
  }

  return createContact(tx, ctx, externalId, fields, rowHash)
}

// --- missing-source policy ------------------------------------------------

async function activeSnapshot(
  tx: Database,
  entity: SyncEntityKey,
  id: string,
): Promise<JsonRecord | null> {
  switch (entity) {
    case 'people':
      return snap(await selectPerson(tx, id))
    case 'org_unit':
      return snap(await selectOrgUnit(tx, id))
    case 'equipment':
      return snap(await selectEquipment(tx, id))
    case 'contact':
      return snap(await selectContact(tx, id))
  }
}

async function archiveCanonical(tx: Database, entity: SyncEntityKey, id: string, at: Date) {
  switch (entity) {
    case 'people':
      await tx.update(people).set({ deletedAt: at }).where(eq(people.id, id))
      return
    case 'org_unit':
      await tx.update(orgUnits).set({ deletedAt: at }).where(eq(orgUnits.id, id))
      return
    case 'equipment':
      await tx.update(equipmentItems).set({ deletedAt: at }).where(eq(equipmentItems.id, id))
      return
    case 'contact':
      // Contacts are add/update-only — never auto-removed (no soft-delete column,
      // and the engine's missing-record policy is conservative). Unreachable:
      // archiveMissingRecords short-circuits 'contact' before this is called.
      return
  }
}

export async function archiveMissingRecords(
  tx: Database,
  ctx: UpsertCtx,
  entity: SyncEntityKey,
  seenExternalIds: Set<string>,
): Promise<ArchiveMissingResult[]> {
  // Contacts have no soft-delete and are source-managed add/update-only — never
  // archive them on a full sync (a removed source contact just stops updating).
  if (entity === 'contact') return []
  const links = await tx
    .select({
      externalId: syncCrosswalk.externalId,
      canonicalId: syncCrosswalk.canonicalId,
      rowHash: syncCrosswalk.rowHash,
    })
    .from(syncCrosswalk)
    .where(
      and(
        eq(syncCrosswalk.tenantId, ctx.tenantId),
        eq(syncCrosswalk.connectionId, ctx.connectionId),
        eq(syncCrosswalk.entity, entity),
      ),
    )

  const out: ArchiveMissingResult[] = []
  const archivedAt = new Date()
  for (const link of links) {
    if (seenExternalIds.has(link.externalId)) continue
    const before = await activeSnapshot(tx, entity, link.canonicalId)
    if (!before) continue
    const after = { ...before, deletedAt: archivedAt.toISOString() }
    const d = diff(before, after)
    if (!d) continue
    if (!ctx.dryRun) await archiveCanonical(tx, entity, link.canonicalId, archivedAt)
    out.push({
      entity,
      externalId: link.externalId,
      canonicalId: link.canonicalId,
      action: 'archived',
      rowHash: link.rowHash,
      before,
      after,
      diff: d,
      message: 'Source record was missing from a full sync and missing-record policy is archive.',
    })
  }
  return out
}
