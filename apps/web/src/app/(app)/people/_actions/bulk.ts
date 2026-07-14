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
import { materializeIdentityAudienceObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { csvRow } from '@/lib/csv'
import type { Database } from '@beaconhs/db'
import { isBulkActionId, newBulkActionBatchId, parseBulkActionIds } from '@/lib/bulk-actions'
import {
  lockPersonGroupMembershipGraph,
  refreshPersonGroupCache,
} from '@/lib/person-group-memberships'

type BulkActionResult =
  { ok: true; updated: number; skipped: number } | { ok: false; error: string }

type BulkCsvResult = { ok: true; filename: string; content: string } | { ok: false; error: string }

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
  const parsedIds = parseBulkActionIds(args?.personIds, {
    singular: 'person',
    plural: 'people',
  })
  if (!parsedIds.ok) return parsedIds
  if (!isBulkActionId(args?.groupId)) return { ok: false, error: 'Pick a group.' }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    await lockPersonGroupMembershipGraph(tx, ctx.tenantId)
    const [group] = await tx
      .select({ id: personGroups.id })
      .from(personGroups)
      .where(
        and(
          eq(personGroups.tenantId, ctx.tenantId),
          eq(personGroups.id, args.groupId),
          isNull(personGroups.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!group) return { state: 'missing' as const }

    // Filter out deleted people up-front so we don't audit dead rows.
    const validRows = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, ctx.tenantId),
          inArray(people.id, ids),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )
      .orderBy(asc(people.id))
      .for('update')
    const validIds = validRows.map((row) => row.id)

    if (validIds.length === 0) {
      return { state: 'ok' as const, updated: 0, skipped: ids.length }
    }

    const existing = await tx
      .select({ personId: personGroupMemberships.personId })
      .from(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.tenantId, ctx.tenantId),
          eq(personGroupMemberships.groupId, args.groupId),
          inArray(personGroupMemberships.personId, validIds),
        ),
      )
      .orderBy(asc(personGroupMemberships.personId))
      .for('update')
    const existingIds = new Set(existing.map((row) => row.personId))
    const toAdd = validIds.filter((id) => !existingIds.has(id))

    if (toAdd.length > 0) {
      await tx.insert(personGroupMemberships).values(
        toAdd.map((personId) => ({
          tenantId: ctx.tenantId,
          groupId: args.groupId,
          personId,
        })),
      )
    }

    await refreshPersonGroupCache(tx, ctx.tenantId, validIds)
    for (const id of toAdd) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: id,
        action: 'update',
        summary: 'Bulk action: assigned to group',
        metadata: { batchId, groupId: args.groupId },
      })
    }
    if (toAdd.length > 0) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        action: 'update',
        summary: `Bulk assigned ${toAdd.length} person${toAdd.length === 1 ? '' : 's'} to a group`,
        metadata: {
          batchId,
          groupId: args.groupId,
          personIds: toAdd,
          skipped: ids.length - toAdd.length,
        },
      })
    }

    return {
      state: 'ok' as const,
      updated: toAdd.length,
      skipped: ids.length - toAdd.length,
    }
  })

  if (result.state === 'missing') return { ok: false, error: 'Group not found.' }

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
  const parsedIds = parseBulkActionIds(args?.personIds, {
    singular: 'person',
    plural: 'people',
  })
  if (!parsedIds.ok) return parsedIds
  if (!isBulkActionId(args?.departmentId)) return { ok: false, error: 'Pick a department.' }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, args.departmentId)))
      .limit(1)
      .for('key share')
    if (!department) return { error: 'Department not found.' } as const

    const validRows = await tx
      .select({ id: people.id, departmentId: people.departmentId })
      .from(people)
      .where(
        and(eq(people.tenantId, ctx.tenantId), inArray(people.id, ids), isNull(people.deletedAt)),
      )
      .orderBy(people.id)
      .for('update')
    // Department is sync-owned: skip actively-synced people (the source system
    // would clobber the change back on its next run) and report them as skipped.
    const synced = await activelySyncedPersonIds(
      tx,
      validRows.map((r) => r.id),
    )
    const eligibleRows = validRows.filter((row) => !synced.has(row.id))
    const changedIds = eligibleRows
      .filter((row) => row.departmentId !== args.departmentId)
      .map((row) => row.id)
    const skipped = ids.length - eligibleRows.length

    if (changedIds.length === 0) return { updated: 0, skipped }

    // One department per person — a plain update (idempotent).
    await tx
      .update(people)
      .set({ departmentId: args.departmentId })
      .where(and(eq(people.tenantId, ctx.tenantId), inArray(people.id, changedIds)))
    await materializeIdentityAudienceObligations(tx, ctx.tenantId, changedIds)
    for (const id of changedIds) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: id,
        action: 'update',
        summary: 'Bulk action: assigned to department',
        metadata: { batchId, departmentId: args.departmentId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      action: 'update',
      summary: `Bulk assigned ${changedIds.length} person${changedIds.length === 1 ? '' : 's'} to a department`,
      metadata: {
        batchId,
        departmentId: args.departmentId,
        personIds: changedIds,
        skipped,
      },
    })
    return { updated: changedIds.length, skipped }
  })

  if ('error' in result && result.error) return { ok: false, error: result.error }

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
  const parsedIds = parseBulkActionIds(args?.personIds, {
    singular: 'person',
    plural: 'people',
  })
  if (!parsedIds.ok) return parsedIds
  const status = args?.status
  if (!status || !['active', 'inactive', 'terminated'].includes(status)) {
    return { ok: false, error: 'Invalid status.' }
  }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: people.id, status: people.status, deletedAt: people.deletedAt })
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), inArray(people.id, ids)))
      .orderBy(people.id)
      .for('update')
    const notDeleted = rows.filter((row) => row.deletedAt === null)
    // Status is sync-owned: skip actively-synced people so the bulk change
    // doesn't silently fight the source system.
    const synced = await activelySyncedPersonIds(
      tx,
      notDeleted.map((row) => row.id),
    )
    const eligibleRows = notDeleted.filter((row) => !synced.has(row.id))
    const changedIds = eligibleRows.filter((row) => row.status !== status).map((row) => row.id)
    const skipped = ids.length - eligibleRows.length
    if (changedIds.length === 0) return { updated: 0, skipped }
    await tx
      .update(people)
      .set({ status })
      .where(and(eq(people.tenantId, ctx.tenantId), inArray(people.id, changedIds)))
    await materializeIdentityAudienceObligations(tx, ctx.tenantId, changedIds)
    for (const id of changedIds) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: id,
        action: 'update',
        summary: `Bulk action: set status ${status}`,
        after: { status },
        metadata: { batchId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      action: 'update',
      summary: `Bulk set status to ${status} on ${changedIds.length} person${changedIds.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        status,
        personIds: changedIds,
        skipped,
      },
    })
    return { updated: changedIds.length, skipped }
  })

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
  const parsedIds = parseBulkActionIds(args?.personIds, {
    singular: 'person',
    plural: 'people',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

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
