'use server'

// Bulk-action server actions for /people.
//
// Four actions surface in the floating bulk-action bar:
//   - bulkAssignPeopleToGroup       insert person_group_memberships (idempotent via onConflictDoNothing)
//   - bulkAssignPeopleToDepartment  set people.department_id on N rows
//   - bulkSetPeopleStatus           change people.status enum on N rows
//   - bulkExportPeopleCsv           download just the checked rows
//
// Group membership inserts also refresh the denormalised `people.groupIds`
// cache so list-page filters stay accurate.

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  departments,
  people,
  personGroupMemberships,
  personGroups,
  syncConnections,
  syncCrosswalk,
  trades,
} from '@beaconhs/db/schema'
import { assertCan, assertNotImpersonating } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { csvRow } from '@/lib/csv'
import type { Database } from '@beaconhs/db'

export type BulkActionResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string }

export type BulkCsvResult =
  | { ok: true; filename: string; content: string }
  | { ok: false; error: string }

const MAX_BULK = 500

function makeBatchId(): string {
  return `bat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Ids of the given people that are actively synced from an external system.
 * Sync-owned fields (department, status, …) on those people must not be
 * bulk-written here — the source system owns them and the next run would
 * silently clobber the change back. Batched twin of getPersonSyncOrigin.
 */
async function activelySyncedPersonIds(tx: Database, personIds: string[]): Promise<Set<string>> {
  if (personIds.length === 0) return new Set()
  const rows = await tx
    .select({ personId: syncCrosswalk.canonicalId })
    .from(syncCrosswalk)
    .innerJoin(syncConnections, eq(syncConnections.id, syncCrosswalk.connectionId))
    .where(
      and(
        eq(syncCrosswalk.entity, 'people'),
        inArray(syncCrosswalk.canonicalId, personIds),
        eq(syncConnections.enabled, true),
        isNull(syncConnections.deletedAt),
      ),
    )
  return new Set(rows.map((r) => r.personId))
}

/**
 * Add N people to a single person_group. Idempotent — re-running with the
 * same set is a no-op (uniqueMembership index + onConflictDoNothing).
 */
export async function bulkAssignPeopleToGroup(args: {
  personIds: string[]
  groupId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  if (args.personIds.length === 0) return { ok: false, error: 'No people selected.' }
  if (!args.groupId) return { ok: false, error: 'Pick a group.' }
  const ids = args.personIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const groupExists = await ctx.db(async (tx) => {
    const [g] = await tx
      .select({ id: personGroups.id })
      .from(personGroups)
      .where(and(eq(personGroups.id, args.groupId), isNull(personGroups.deletedAt)))
      .limit(1)
    return Boolean(g)
  })
  if (!groupExists) return { ok: false, error: 'Group not found.' }

  const result = await ctx.db(async (tx) => {
    // Filter out deleted people up-front so we don't audit dead rows.
    const validRows = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(inArray(people.id, ids), isNull(people.deletedAt)))
    const validIds = validRows.map((r) => r.id)
    const skipped = ids.length - validIds.length

    if (validIds.length === 0) return { updated: 0, skipped }

    await tx
      .insert(personGroupMemberships)
      .values(
        validIds.map((personId) => ({
          tenantId: ctx.tenantId,
          groupId: args.groupId,
          personId,
        })),
      )
      .onConflictDoNothing()

    // Refresh the denormalised cache on people for filtering.
    await tx.execute(sql`
      UPDATE people
      SET group_ids = COALESCE((
        SELECT jsonb_agg(group_id ORDER BY group_id)
        FROM person_group_memberships
        WHERE person_id = people.id AND tenant_id = ${ctx.tenantId}
      ), '[]'::jsonb)
      WHERE id IN (${sql.join(
        validIds.map((v) => sql`${v}::uuid`),
        sql`, `,
      )})
        AND tenant_id = ${ctx.tenantId}
    `)

    return { updated: validIds.length, skipped, validIds }
  })

  if ('validIds' in result && result.validIds) {
    for (const id of result.validIds) {
      await recordAudit(ctx, {
        entityType: 'person',
        entityId: id,
        action: 'update',
        summary: 'Bulk action: assigned to group',
        metadata: { batchId, groupId: args.groupId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'person',
      action: 'update',
      summary: `Bulk assigned ${result.validIds.length} person${result.validIds.length === 1 ? '' : 's'} to a group`,
      metadata: {
        batchId,
        groupId: args.groupId,
        personIds: result.validIds,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/people')
  revalidatePath(`/people/groups/${args.groupId}`)
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkAssignPeopleToDepartment(args: {
  personIds: string[]
  departmentId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  if (args.personIds.length === 0) return { ok: false, error: 'No people selected.' }
  if (!args.departmentId) return { ok: false, error: 'Pick a department.' }
  const ids = args.personIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const deptExists = await ctx.db(async (tx) => {
    const [d] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, args.departmentId))
      .limit(1)
    return Boolean(d)
  })
  if (!deptExists) return { ok: false, error: 'Department not found.' }

  const result = await ctx.db(async (tx) => {
    const validRows = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(inArray(people.id, ids), isNull(people.deletedAt)))
    // Department is sync-owned: skip actively-synced people (the source system
    // would clobber the change back on its next run) and report them as skipped.
    const synced = await activelySyncedPersonIds(
      tx,
      validRows.map((r) => r.id),
    )
    const validIds = validRows.map((r) => r.id).filter((id) => !synced.has(id))
    const skipped = ids.length - validIds.length

    if (validIds.length === 0) return { updated: 0, skipped }

    // One department per person — a plain update (idempotent).
    await tx
      .update(people)
      .set({ departmentId: args.departmentId })
      .where(inArray(people.id, validIds))

    return { updated: validIds.length, skipped, validIds }
  })

  if ('validIds' in result && result.validIds) {
    for (const id of result.validIds) {
      await recordAudit(ctx, {
        entityType: 'person',
        entityId: id,
        action: 'update',
        summary: 'Bulk action: assigned to department',
        metadata: { batchId, departmentId: args.departmentId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'person',
      action: 'update',
      summary: `Bulk assigned ${result.validIds.length} person${result.validIds.length === 1 ? '' : 's'} to a department`,
      metadata: {
        batchId,
        departmentId: args.departmentId,
        personIds: result.validIds,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/people')
  revalidatePath('/people/departments')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export type PeopleStatus = 'active' | 'inactive' | 'terminated'

export async function bulkSetPeopleStatus(args: {
  personIds: string[]
  status: PeopleStatus
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  if (args.personIds.length === 0) return { ok: false, error: 'No people selected.' }
  if (!['active', 'inactive', 'terminated'].includes(args.status)) {
    return { ok: false, error: 'Invalid status.' }
  }
  const ids = args.personIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: people.id, status: people.status, deletedAt: people.deletedAt })
      .from(people)
      .where(inArray(people.id, ids))
    const notDeleted = rows.filter((r) => r.deletedAt === null).map((r) => r.id)
    // Status is sync-owned: skip actively-synced people so the bulk change
    // doesn't silently fight the source system.
    const synced = await activelySyncedPersonIds(tx, notDeleted)
    const editable = notDeleted.filter((id) => !synced.has(id))
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx.update(people).set({ status: args.status }).where(inArray(people.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'person',
        entityId: id,
        action: 'update',
        summary: `Bulk action: set status ${args.status}`,
        after: { status: args.status },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'person',
      action: 'update',
      summary: `Bulk set status to ${args.status} on ${result.editable.length} person${result.editable.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        status: args.status,
        personIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/people')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkExportPeopleCsv(args: { personIds: string[] }): Promise<BulkCsvResult> {
  const ctx = await requireRequestContext()
  // Same gate as /people/export.csv (requireExportContext + admin.users.manage):
  // this returns the identical PII, so it must never be a weaker path.
  assertCan(ctx, 'admin.data.export')
  assertCan(ctx, 'admin.users.manage')
  assertNotImpersonating(ctx, 'export')
  if (args.personIds.length === 0) return { ok: false, error: 'No people selected.' }
  const ids = args.personIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const rows = await ctx.db((tx) =>
    tx
      .select({ person: people, department: departments, trade: trades })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(trades, eq(trades.id, people.tradeId))
      .where(and(inArray(people.id, ids), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName)),
  )

  const headers = [
    'Last name',
    'First name',
    'Employee #',
    'Department',
    'Trade',
    'Hire date',
    'Email',
    'Phone',
    'Status',
  ]
  const csvLines = [csvRow(headers)]
  for (const { person, department, trade } of rows) {
    csvLines.push(
      csvRow([
        person.lastName,
        person.firstName,
        person.employeeNo ?? '',
        department?.name ?? '',
        trade?.name ?? '',
        person.hireDate ?? '',
        person.email ?? '',
        person.phone ?? '',
        person.status,
      ]),
    )
  }
  const content = csvLines.join('\r\n') + '\r\n'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `people-selected-${stamp}.csv`

  for (const { person } of rows) {
    await recordAudit(ctx, {
      entityType: 'person',
      entityId: person.id,
      action: 'export',
      summary: 'Bulk action: exported to CSV',
      metadata: { batchId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'person',
    action: 'export',
    summary: `Bulk exported ${rows.length} person${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: { batchId, personIds: rows.map((r) => r.person.id), format: 'csv' },
  })

  return { ok: true, filename, content }
}

// ---------- Lookups (used by bulk-bar dropdowns) ----------------------------

export async function listPersonGroupsForBulk(): Promise<{ id: string; name: string }[]> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) =>
    tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name)),
  )
}

export async function listPersonDepartmentsForBulk(): Promise<{ id: string; name: string }[]> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) =>
    tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name)),
  )
}
