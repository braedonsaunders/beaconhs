// The canonical upsert engine — lands a CanonicalRecord into people /
// org_units / equipment_items, keyed through the crosswalk for idempotency.
//
// Resolution order per record: crosswalk (external_id → canonical row) → natural
// key (employee_no / org code / asset_tag) → insert new. Change detection via a
// row hash. Conservative: a sync never deletes; metadata is set on first insert
// and preserved on update (so app-side edits survive re-syncs).

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  departments,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  syncCrosswalk,
  trades,
  workActivityEntries,
} from '@beaconhs/db/schema'
import type {
  CanonicalEquipment,
  CanonicalOrgUnit,
  CanonicalPerson,
  CanonicalWorkActivity,
  CanonicalRecord,
  SyncEntityKey,
  SyncLogger,
} from './types'

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
}

export type UpsertAction = 'created' | 'updated' | 'unchanged' | 'skipped'
export interface UpsertResult {
  action: UpsertAction
  canonicalId?: string
}

export async function loadLookups(tx: Database, _tenantId: string): Promise<Lookups> {
  // RLS scopes all four reads to the current tenant.
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

async function touchCrosswalk(tx: Database, id: string, rowHash?: string) {
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
    case 'work_activity':
      return upsertWorkActivity(tx, ctx, rec.externalId, rec.data)
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

function rememberPersonLookup(ctx: UpsertCtx, id: string, fields: PersonFields) {
  if (fields.employeeNo) {
    ctx.lookups.personIdByEmployeeNo.set(fields.employeeNo.toLowerCase(), id)
  }
  if (fields.externalEmployeeId) {
    ctx.lookups.personIdByExternalEmployeeId.set(fields.externalEmployeeId.toLowerCase(), id)
  }
}

async function upsertPerson(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalPerson,
): Promise<UpsertResult> {
  if (!data.firstName || !data.lastName) {
    ctx.log('warn', `person "${externalId}" is missing a first/last name — skipped`)
    return { action: 'skipped' }
  }
  const rowHash = hashData(data)
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
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, link.id)
      rememberPersonLookup(ctx, link.canonicalId, fields)
      return { action: 'unchanged', canonicalId: link.canonicalId }
    }
    const updated = await tx
      .update(people)
      .set(fields)
      .where(eq(people.id, link.canonicalId))
      .returning({ id: people.id })
    if (updated.length === 0) {
      const id = firstId(
        await tx
          .insert(people)
          .values({ tenantId: ctx.tenantId, ...fields, metadata: data.metadata ?? {} })
          .returning({ id: people.id }),
      )
      await linkCrosswalk(tx, ctx, 'people', externalId, id, rowHash)
      rememberPersonLookup(ctx, id, fields)
      return { action: 'created', canonicalId: id }
    }
    await touchCrosswalk(tx, link.id, rowHash)
    rememberPersonLookup(ctx, link.canonicalId, fields)
    return { action: 'updated', canonicalId: link.canonicalId }
  }

  if (fields.employeeNo) {
    const [match] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, ctx.tenantId),
          eq(people.employeeNo, fields.employeeNo),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
    if (match) {
      await tx.update(people).set(fields).where(eq(people.id, match.id))
      await linkCrosswalk(tx, ctx, 'people', externalId, match.id, rowHash)
      rememberPersonLookup(ctx, match.id, fields)
      return { action: 'updated', canonicalId: match.id }
    }
  }

  if (fields.externalEmployeeId) {
    const [match] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, ctx.tenantId),
          eq(people.externalEmployeeId, fields.externalEmployeeId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
    if (match) {
      await tx.update(people).set(fields).where(eq(people.id, match.id))
      await linkCrosswalk(tx, ctx, 'people', externalId, match.id, rowHash)
      rememberPersonLookup(ctx, match.id, fields)
      return { action: 'updated', canonicalId: match.id }
    }
  }

  const id = firstId(
    await tx
      .insert(people)
      .values({ tenantId: ctx.tenantId, ...fields, metadata: data.metadata ?? {} })
      .returning({ id: people.id }),
  )
  await linkCrosswalk(tx, ctx, 'people', externalId, id, rowHash)
  rememberPersonLookup(ctx, id, fields)
  return { action: 'created', canonicalId: id }
}

// --- org_unit (locations + projects) --------------------------------------

interface OrgUnitFields {
  level: 'customer' | 'project' | 'site' | 'area'
  name: string
  code: string | null
  parentId: string | null
  address: CanonicalOrgUnit['address']
}

async function upsertOrgUnit(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalOrgUnit,
): Promise<UpsertResult> {
  if (!data.name) {
    ctx.log('warn', `location "${externalId}" is missing a name — skipped`)
    return { action: 'skipped' }
  }
  const rowHash = hashData(data)
  const code = data.code ?? null
  const fields: OrgUnitFields = {
    level: data.level ?? 'site',
    name: data.name,
    code,
    parentId: data.parentCode
      ? (ctx.lookups.orgUnitIdByCode.get(data.parentCode.toLowerCase()) ?? null)
      : null,
    address: data.address ?? null,
  }

  const link = await findCrosswalk(tx, ctx, 'org_unit', externalId)
  if (link) {
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, link.id)
      return { action: 'unchanged', canonicalId: link.canonicalId }
    }
    const updated = await tx
      .update(orgUnits)
      .set(fields)
      .where(eq(orgUnits.id, link.canonicalId))
      .returning({ id: orgUnits.id })
    if (updated.length > 0) {
      await touchCrosswalk(tx, link.id, rowHash)
      if (code) ctx.lookups.orgUnitIdByCode.set(code.toLowerCase(), link.canonicalId)
      return { action: 'updated', canonicalId: link.canonicalId }
    }
  }

  if (code) {
    const [match] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.tenantId, ctx.tenantId),
          eq(orgUnits.code, code),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1)
    if (match) {
      await tx.update(orgUnits).set(fields).where(eq(orgUnits.id, match.id))
      await linkCrosswalk(tx, ctx, 'org_unit', externalId, match.id, rowHash)
      ctx.lookups.orgUnitIdByCode.set(code.toLowerCase(), match.id)
      return { action: 'updated', canonicalId: match.id }
    }
  }

  const id = firstId(
    await tx
      .insert(orgUnits)
      .values({ tenantId: ctx.tenantId, ...fields, metadata: data.metadata ?? {} })
      .returning({ id: orgUnits.id }),
  )
  await linkCrosswalk(tx, ctx, 'org_unit', externalId, id, rowHash)
  if (code) ctx.lookups.orgUnitIdByCode.set(code.toLowerCase(), id)
  return { action: 'created', canonicalId: id }
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

async function upsertEquipment(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalEquipment,
): Promise<UpsertResult> {
  if (!data.assetTag) {
    ctx.log('warn', `equipment "${externalId}" is missing an asset tag — skipped`)
    return { action: 'skipped' }
  }
  const rowHash = hashData(data)
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
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, link.id)
      return { action: 'unchanged', canonicalId: link.canonicalId }
    }
    const updated = await tx
      .update(equipmentItems)
      .set(fields)
      .where(eq(equipmentItems.id, link.canonicalId))
      .returning({ id: equipmentItems.id })
    if (updated.length > 0) {
      await touchCrosswalk(tx, link.id, rowHash)
      return { action: 'updated', canonicalId: link.canonicalId }
    }
  }

  const [match] = await tx
    .select({ id: equipmentItems.id })
    .from(equipmentItems)
    .where(
      and(
        eq(equipmentItems.tenantId, ctx.tenantId),
        eq(equipmentItems.assetTag, fields.assetTag),
        isNull(equipmentItems.deletedAt),
      ),
    )
    .limit(1)
  if (match) {
    await tx.update(equipmentItems).set(fields).where(eq(equipmentItems.id, match.id))
    await linkCrosswalk(tx, ctx, 'equipment', externalId, match.id, rowHash)
    return { action: 'updated', canonicalId: match.id }
  }

  const id = firstId(
    await tx
      .insert(equipmentItems)
      .values({
        tenantId: ctx.tenantId,
        ...fields,
        qrToken: randomBytes(12).toString('base64url'),
        metadata: data.metadata ?? {},
      })
      .returning({ id: equipmentItems.id }),
  )
  await linkCrosswalk(tx, ctx, 'equipment', externalId, id, rowHash)
  return { action: 'created', canonicalId: id }
}

// --- work activity --------------------------------------------------------

function intOrNull(value: number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}

function decimalOrNull(value: number | null | undefined): string | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : null
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const s = String(value).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1] ?? null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

function resolvePersonId(ctx: UpsertCtx, data: CanonicalWorkActivity): string | null {
  if (data.personId) return data.personId
  if (data.externalEmployeeId) {
    const id = ctx.lookups.personIdByExternalEmployeeId.get(data.externalEmployeeId.toLowerCase())
    if (id) return id
  }
  if (data.employeeNo) {
    const id = ctx.lookups.personIdByEmployeeNo.get(data.employeeNo.toLowerCase())
    if (id) return id
  }
  return null
}

async function upsertWorkActivity(
  tx: Database,
  ctx: UpsertCtx,
  externalId: string,
  data: CanonicalWorkActivity,
): Promise<UpsertResult> {
  const activityDate = dateOnly(data.activityDate)
  if (!activityDate) {
    ctx.log('warn', `work activity "${externalId}" is missing a valid activity date — skipped`)
    return { action: 'skipped' }
  }

  const rowHash = hashData(data)
  const personId = resolvePersonId(ctx, data)
  const siteCode = data.siteCode ?? null
  const siteOrgUnitId = siteCode
    ? (ctx.lookups.orgUnitIdByCode.get(siteCode.toLowerCase()) ?? null)
    : null
  const fields = {
    sourceSystem: ctx.sourceSystem,
    activityDate,
    personId,
    externalEmployeeId: data.externalEmployeeId ?? null,
    employeeNo: data.employeeNo ?? null,
    siteOrgUnitId,
    siteCode,
    siteName: data.siteName ?? null,
    sourceCode: data.sourceCode ?? null,
    sourceLabel: data.sourceLabel ?? null,
    hours: decimalOrNull(data.hours),
    businessKm: intOrNull(data.businessKm),
    personalKm: intOrNull(data.personalKm),
    description: data.description ?? null,
    status: data.status ?? 'ready',
    raw: data.raw ?? {},
    importedAt: new Date(),
  }

  const link = await findCrosswalk(tx, ctx, 'work_activity', externalId)
  if (link) {
    if (link.rowHash === rowHash) {
      await touchCrosswalk(tx, link.id)
      return { action: 'unchanged', canonicalId: link.canonicalId }
    }
    const updated = await tx
      .update(workActivityEntries)
      .set(fields)
      .where(eq(workActivityEntries.id, link.canonicalId))
      .returning({ id: workActivityEntries.id })
    if (updated.length > 0) {
      await touchCrosswalk(tx, link.id, rowHash)
      return { action: 'updated', canonicalId: link.canonicalId }
    }
  }

  const id = firstId(
    await tx
      .insert(workActivityEntries)
      .values({
        tenantId: ctx.tenantId,
        sourceConnectionId: ctx.connectionId,
        sourceExternalId: externalId,
        ...fields,
      })
      .onConflictDoUpdate({
        target: [
          workActivityEntries.tenantId,
          workActivityEntries.sourceConnectionId,
          workActivityEntries.sourceExternalId,
        ],
        set: fields,
      })
      .returning({ id: workActivityEntries.id }),
  )
  await linkCrosswalk(tx, ctx, 'work_activity', externalId, id, rowHash)
  return { action: link ? 'updated' : 'created', canonicalId: id }
}
