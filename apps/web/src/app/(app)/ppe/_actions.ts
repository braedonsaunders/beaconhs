'use server'

// Bulk-action server actions for /ppe.
//
// Three actions surface in the floating bulk-action bar:
//   - bulkIssuePpeToPerson   pick a person, for each row insert a ppe_issues
//                            row + update currentHolderPersonId + status='issued'
//   - bulkDiscardPpe         status='discarded' + ppe_issues action='discard'
//   - bulkExportPpeCsv       download just the checked rows
//
// All mutations happen inside one ctx.db transaction per item so the ledger
// row + item state stay in lock-step. Audit log gets a row per item plus a
// summary entry, sharing a batchId.

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { people, ppeIssues, ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { materializePpeTypeEvidence } from '@/lib/compliance-type-evidence'
import { csvRow } from '@/lib/csv'
import { isBulkActionId, newBulkActionBatchId, parseBulkActionIds } from '@/lib/bulk-actions'

type BulkActionResult =
  { ok: true; updated: number; skipped: number } | { ok: false; error: string }

type BulkCsvResult = { ok: true; filename: string; content: string } | { ok: false; error: string }

function safeTenantUserId(ctx: Awaited<ReturnType<typeof requireRequestContext>>): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
}

/**
 * Issue every selected PPE item to a single person. Skips items already
 * discarded or expired so the resulting ledger reflects only legal
 * transitions.
 */
export async function bulkIssuePpeToPerson(args: {
  ppeItemIds: string[]
  personId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.issue')
  const parsedIds = parseBulkActionIds(args?.ppeItemIds, {
    singular: 'PPE item',
    plural: 'PPE items',
  })
  if (!parsedIds.ok) return parsedIds
  if (!isBulkActionId(args?.personId)) return { ok: false, error: 'Pick a holder.' }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const person = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({ id: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(and(eq(people.id, args.personId), isNull(people.deletedAt)))
      .limit(1)
    return p ?? null
  })
  if (!person) return { ok: false, error: 'Holder not found.' }

  const issuedByTenantUserId = safeTenantUserId(ctx)
  if (!issuedByTenantUserId) {
    // ppeIssues.issuedByTenantUserId is NOT NULL. Super-admin viewing a tenant
    // doesn't have a tenant_users row to attribute the issuance to.
    return {
      ok: false,
      error: 'Super-admin cannot issue PPE — switch to a tenant user.',
    }
  }

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: ppeItems.id,
        typeId: ppeItems.typeId,
        status: ppeItems.status,
        deletedAt: ppeItems.deletedAt,
      })
      .from(ppeItems)
      .where(inArray(ppeItems.id, ids))
      .orderBy(asc(ppeItems.id))
      .for('update')
    const editable = rows
      .filter((r) => r.deletedAt === null && r.status !== 'discarded' && r.status !== 'expired')
      .map((r) => r.id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    const editableRows = rows.filter((row) => editable.includes(row.id))

    // 1) Insert one ledger row per item.
    await tx.insert(ppeIssues).values(
      editable.map((itemId) => ({
        tenantId: ctx.tenantId,
        itemId,
        personId: args.personId,
        action: 'issue' as const,
        quantity: 1,
        issuedByTenantUserId,
        note: 'Bulk issuance',
      })),
    )

    // 2) Flip every item to "issued + held by this person".
    await tx
      .update(ppeItems)
      .set({ status: 'issued', currentHolderPersonId: args.personId })
      .where(inArray(ppeItems.id, editable))

    await materializePpeTypeEvidence(
      tx,
      ctx.tenantId,
      editableRows.map((row) => row.typeId),
    )

    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'ppe_item',
        entityId: id,
        action: 'update',
        summary: `Bulk action: issued to ${person.firstName} ${person.lastName}`,
        after: { status: 'issued', currentHolderPersonId: args.personId },
        metadata: { batchId, action: 'issue' },
      })
    }
    await recordAudit(ctx, {
      entityType: 'ppe_item',
      action: 'update',
      summary: `Bulk issued ${result.editable.length} PPE item${result.editable.length === 1 ? '' : 's'} to ${person.firstName} ${person.lastName}`,
      metadata: {
        batchId,
        personId: args.personId,
        ppeItemIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/ppe')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkDiscardPpe(args: {
  ppeItemIds: string[]
  reason?: string | null
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.manage')
  const parsedIds = parseBulkActionIds(args?.ppeItemIds, {
    singular: 'PPE item',
    plural: 'PPE items',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const issuedByTenantUserId = safeTenantUserId(ctx)
  if (!issuedByTenantUserId) {
    return {
      ok: false,
      error: 'Super-admin cannot discard PPE — switch to a tenant user.',
    }
  }

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: ppeItems.id,
        typeId: ppeItems.typeId,
        status: ppeItems.status,
        currentHolderPersonId: ppeItems.currentHolderPersonId,
        deletedAt: ppeItems.deletedAt,
      })
      .from(ppeItems)
      .where(inArray(ppeItems.id, ids))
      .orderBy(asc(ppeItems.id))
      .for('update')
    const editable = rows
      .filter((r) => r.deletedAt === null && r.status !== 'discarded')
      .map((r) => r.id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }

    const editableRows = rows.filter((r) => editable.includes(r.id))

    await tx.insert(ppeIssues).values(
      editableRows.map((r) => ({
        tenantId: ctx.tenantId,
        itemId: r.id,
        personId: r.currentHolderPersonId,
        action: 'discard' as const,
        quantity: 1,
        issuedByTenantUserId,
        note: args.reason?.trim() || 'Bulk discard',
      })),
    )

    await tx
      .update(ppeItems)
      .set({ status: 'discarded', currentHolderPersonId: null })
      .where(inArray(ppeItems.id, editable))

    await materializePpeTypeEvidence(
      tx,
      ctx.tenantId,
      editableRows.map((row) => row.typeId),
    )

    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'ppe_item',
        entityId: id,
        action: 'update',
        summary: 'Bulk action: discarded',
        after: { status: 'discarded' },
        metadata: { batchId, action: 'discard', reason: args.reason ?? null },
      })
    }
    await recordAudit(ctx, {
      entityType: 'ppe_item',
      action: 'update',
      summary: `Bulk discarded ${result.editable.length} PPE item${result.editable.length === 1 ? '' : 's'}`,
      metadata: { batchId, ppeItemIds: result.editable, skipped: result.skipped },
    })
  }

  revalidatePath('/ppe')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkExportPpeCsv(args: { ppeItemIds: string[] }): Promise<BulkCsvResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.read.all')
  const parsedIds = parseBulkActionIds(args?.ppeItemIds, {
    singular: 'PPE item',
    plural: 'PPE items',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const rows = await ctx.db((tx) =>
    tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(inArray(ppeItems.id, ids))
      .orderBy(asc(ppeTypes.name), asc(ppeItems.serialNumber)),
  )

  const headers = [
    'Type',
    'Serial #',
    'Size',
    'Status',
    'Holder',
    'Purchase date',
    'Expires',
    'Last inspection',
    'Next inspection',
  ]
  const csvLines = [csvRow(headers)]
  for (const { item, type, holder } of rows) {
    csvLines.push(
      csvRow([
        type.name,
        item.serialNumber ?? '',
        item.size ?? '',
        item.status,
        holder ? `${holder.firstName} ${holder.lastName}` : '',
        item.purchaseDate ?? '',
        item.expiresOn ?? '',
        item.lastInspectionOn ?? '',
        item.nextInspectionDue ?? '',
      ]),
    )
  }
  const content = csvLines.join('\r\n') + '\r\n'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `ppe-selected-${stamp}.csv`

  for (const { item } of rows) {
    await recordAudit(ctx, {
      entityType: 'ppe_item',
      entityId: item.id,
      action: 'export',
      summary: 'Bulk action: exported to CSV',
      metadata: { batchId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'ppe_item',
    action: 'export',
    summary: `Bulk exported ${rows.length} PPE item${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: { batchId, ppeItemIds: rows.map((r) => r.item.id), format: 'csv' },
  })

  return { ok: true, filename, content }
}

// ---------- Register + (optionally) issue, from the list flyout -------------

/**
 * Register a new PPE item and, if a holder is chosen, issue it to them in the
 * same step. Person blank ⇒ the item simply lands in stock. Replaces the old
 * full-page /ppe/new + /ppe/issue flows with a single drawer action.
 */
export async function createAndIssuePpe(input: {
  typeId: string
  serialNumber?: string | null
  size?: string | null
  purchaseDate?: string | null
  expiresOn?: string | null
  notes?: string | null
  personId?: string | null
  note?: string | null
}): Promise<{ ok: true; id: string; issued: boolean } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  // Registration needs manage; issuing-in-the-same-step additionally needs issue.
  assertCan(ctx, 'ppe.manage')
  if (input.personId) assertCan(ctx, 'ppe.issue')
  if (!input.typeId) return { ok: false, error: 'Pick a PPE type.' }
  // Issuing writes a ledger row attributed to a tenant user — super-admin can't.
  if (input.personId && !safeTenantUserId(ctx)) {
    return { ok: false, error: 'Super-admin cannot issue PPE — switch to a tenant user.' }
  }

  const issuedByTenantUserId = input.personId ? safeTenantUserId(ctx) : null
  let itemId: string | null
  try {
    itemId = await ctx.db(async (tx) => {
      if (input.personId) {
        const [person] = await tx
          .select({ id: people.id })
          .from(people)
          .where(
            and(
              eq(people.id, input.personId),
              eq(people.status, 'active'),
              isNull(people.deletedAt),
            ),
          )
          .limit(1)
        if (!person) throw new Error('Active holder not found.')
      }
      const [row] = await tx
        .insert(ppeItems)
        .values({
          tenantId: ctx.tenantId,
          typeId: input.typeId,
          serialNumber: input.serialNumber?.trim() || null,
          size: input.size?.trim() || null,
          purchaseDate: input.purchaseDate?.trim() || null,
          expiresOn: input.expiresOn?.trim() || null,
          notes: input.notes?.trim() || null,
          status: input.personId ? 'issued' : 'in_stock',
          currentHolderPersonId: input.personId ?? null,
        })
        .returning({ id: ppeItems.id })
      if (!row) return null
      if (input.personId) {
        await tx.insert(ppeIssues).values({
          tenantId: ctx.tenantId,
          itemId: row.id,
          personId: input.personId,
          action: 'issue',
          quantity: 1,
          issuedByTenantUserId: issuedByTenantUserId!,
          note: input.note?.trim() || null,
        })
      }
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'ppe_item',
        entityId: row.id,
        action: 'create',
        summary: `Added PPE item${input.serialNumber ? ` ${input.serialNumber}` : ''}`,
        after: {
          typeId: input.typeId,
          serialNumber: input.serialNumber ?? null,
          size: input.size ?? null,
          status: input.personId ? 'issued' : 'in_stock',
          currentHolderPersonId: input.personId ?? null,
        },
      })
      await materializePpeTypeEvidence(tx, ctx.tenantId, [input.typeId])
      return row.id
    })
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') {
      return { ok: false, error: 'That serial number is already in use for this tenant.' }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to create PPE item.' }
  }
  if (!itemId) return { ok: false, error: 'Failed to create PPE item.' }

  revalidatePath('/ppe')
  return { ok: true, id: itemId, issued: Boolean(input.personId) }
}
