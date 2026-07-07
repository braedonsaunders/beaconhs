// Canonical upsert engine — lands a CanonicalRecord into people / org_units /
// equipment_items, keyed through the crosswalk for idempotency.
//
// Resolution order per record: crosswalk (external_id → canonical row) →
// natural key (external employee id / employee no / org code / asset tag) →
// insert new. The same planner is used for previews and real syncs so dry-runs
// show the decision the write path would make.

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  customerContacts,
  departments,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  syncCrosswalk,
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

type JsonRecord = Record<string, unknown>

export interface Lookups {
  deptByName: Map<string, string>
  tradeByName: Map<string, string>
  equipTypeByName: Map<string, string>
  orgUnitIdByCode: Map<string, string>
  personIdByEmployeeNo: Map<string, string>
  personIdByExternalEmployeeId: Map<string, string>
}

export type SyncOwnershipMode = 'source_wins' | 'manual_wins'

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

export interface ArchiveMissingResult {
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
  const lower = (m: { id: string; name: string }[]) =>
    new Map(m.map((r) => [r.name.toLowerCase(), r.id] as const))
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

function isManualConflict(
  ctx: UpsertCtx,
  row: { updatedAt?: Date | string | null } | null,
  link: { lastSyncedAt: Date | string },
): boolean {
  if (ctx.ownershipMode !== 'manual_wins' || !row?.updatedAt) return false
  const updatedAt = new Date(row.updatedAt).getTime()
  const syncedAt = new Date(link.lastSyncedAt).getTime()
  return Number.isFinite(updatedAt) && Number.isFinite(syncedAt) && updatedAt > syncedAt + 1000
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

function withPeopleMetadata(fields: PersonFields, metadata?: JsonRecord) {
  if (!metadata || Object.keys(metadata).length === 0) return fields
  return {
    ...fields,
    metadata: sql`${people.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  }
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
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      employeeNo: people.employeeNo,
      externalEmployeeId: people.externalEmployeeId,
      email: people.email,
      phone: people.phone,
      jobTitle: people.jobTitle,
      hireDate: people.hireDate,
      status: people.status,
      departmentId: people.departmentId,
      tradeId: people.tradeId,
      metadata: people.metadata,
      updatedAt: people.updatedAt,
      deletedAt: people.deletedAt,
    })
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .limit(1)
  return row ?? null
}

// Same as selectPerson but does NOT filter soft-deleted rows — used to detect a
// crosswalk-linked row that was locally archived, so we restore/conflict it
// instead of inserting a shadow duplicate.
async function selectPersonAnyState(tx: Database, id: string) {
  const [row] = await tx
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      employeeNo: people.employeeNo,
      externalEmployeeId: people.externalEmployeeId,
      email: people.email,
      phone: people.phone,
      jobTitle: people.jobTitle,
      hireDate: people.hireDate,
      status: people.status,
      departmentId: people.departmentId,
      tradeId: people.tradeId,
      metadata: people.metadata,
      updatedAt: people.updatedAt,
      deletedAt: people.deletedAt,
    })
    .from(people)
    .where(eq(people.id, id))
    .limit(1)
  return row ?? null
}

async function findPersonByExternalEmployeeId(
  tx: Database,
  ctx: UpsertCtx,
  externalEmployeeId: string,
) {
  const [row] = await tx
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      employeeNo: people.employeeNo,
      externalEmployeeId: people.externalEmployeeId,
      email: people.email,
      phone: people.phone,
      jobTitle: people.jobTitle,
      hireDate: people.hireDate,
      status: people.status,
      departmentId: people.departmentId,
      tradeId: people.tradeId,
      metadata: people.metadata,
      updatedAt: people.updatedAt,
      deletedAt: people.deletedAt,
    })
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
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      employeeNo: people.employeeNo,
      externalEmployeeId: people.externalEmployeeId,
      email: people.email,
      phone: people.phone,
      jobTitle: people.jobTitle,
      hireDate: people.hireDate,
      status: people.status,
      departmentId: people.departmentId,
      tradeId: people.tradeId,
      metadata: people.metadata,
      updatedAt: people.updatedAt,
      deletedAt: people.deletedAt,
    })
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

async function createPerson(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  fields: PersonFields,
  rowHash: string,
  metadata?: JsonRecord,
): Promise<UpsertResult> {
  const after = { ...fields, metadata: metadata ?? {} }
  if (ctx.dryRun)
    return { action: 'created', rowHash, before: null, after, diff: diff(null, after) }
  const id = firstId(
    await tx
      .insert(people)
      .values({ tenantId: ctx.tenantId, ...fields, metadata: metadata ?? {} })
      .returning({ id: people.id }),
  )
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
  const after = personAfter(fields, before, metadata)
  if (!ctx.dryRun) {
    await tx
      .update(people)
      .set(withPeopleMetadata(fields, metadata))
      .where(eq(people.id, beforeRow.id))
    await linkCrosswalk(tx, ctx, 'people', externalId, beforeRow.id, rowHash)
    rememberPersonLookup(ctx, beforeRow.id, fields)
  }
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
  const after = personAfter(fields, before, metadata)
  if (isManualConflict(ctx, archived, link)) {
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
  const rowHash = hashData(data)
  const metadata = data.metadata as JsonRecord | undefined
  const fields: PersonFields = {
    firstName: data.firstName,
    lastName: data.lastName,
    employeeNo: data.employeeNo ?? null,
    externalEmployeeId: data.externalEmployeeId ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    jobTitle: data.jobTitle ?? null,
    hireDate: data.hireDate ?? null,
    status: data.status ?? 'active',
    departmentId: data.departmentName
      ? (ctx.lookups.deptByName.get(data.departmentName.toLowerCase()) ?? null)
      : null,
    tradeId: data.tradeName
      ? (ctx.lookups.tradeByName.get(data.tradeName.toLowerCase()) ?? null)
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
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, ctx, link.id)
      rememberPersonLookup(ctx, link.canonicalId, fields)
      return { action: 'unchanged', canonicalId: link.canonicalId, rowHash }
    }
    if (isManualConflict(ctx, beforeRow, link)) {
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
    if (match) return updatePerson(tx, ctx, externalId, match, fields, rowHash, metadata)
  }

  if (fields.employeeNo) {
    const match = await findPersonByEmployeeNo(tx, ctx, fields.employeeNo)
    if (match) return updatePerson(tx, ctx, externalId, match, fields, rowHash, metadata)
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

function withOrgUnitMetadata(fields: OrgUnitFields, metadata?: JsonRecord) {
  if (!metadata || Object.keys(metadata).length === 0) return fields
  return {
    ...fields,
    metadata: sql`${orgUnits.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  }
}

async function selectOrgUnit(tx: Database, id: string) {
  const [row] = await tx
    .select({
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
    })
    .from(orgUnits)
    .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
    .limit(1)
  return row ?? null
}

async function selectOrgUnitAnyState(tx: Database, id: string) {
  const [row] = await tx
    .select({
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
    })
    .from(orgUnits)
    .where(eq(orgUnits.id, id))
    .limit(1)
  return row ?? null
}

async function findOrgUnitByCode(tx: Database, ctx: UpsertCtx, code: string) {
  const [row] = await tx
    .select({
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
    })
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

function withEquipmentMetadata(fields: EquipFields, metadata?: JsonRecord) {
  if (!metadata || Object.keys(metadata).length === 0) return fields
  return {
    ...fields,
    metadata: sql`${equipmentItems.metadata} || ${JSON.stringify(metadata)}::jsonb`,
  }
}

async function selectEquipment(tx: Database, id: string) {
  const [row] = await tx
    .select({
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
    })
    .from(equipmentItems)
    .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
    .limit(1)
  return row ?? null
}

async function selectEquipmentAnyState(tx: Database, id: string) {
  const [row] = await tx
    .select({
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
    })
    .from(equipmentItems)
    .where(eq(equipmentItems.id, id))
    .limit(1)
  return row ?? null
}

async function findEquipmentByAssetTag(tx: Database, ctx: UpsertCtx, assetTag: string) {
  const [row] = await tx
    .select({
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
    })
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
