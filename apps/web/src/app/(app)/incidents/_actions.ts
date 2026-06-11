'use server'

// Bulk-action server actions for /incidents.
//
// Three actions surface in the floating bulk-action bar:
//   - bulkArchiveIncidents       soft-delete N rows (sets deletedAt=now)
//   - bulkSetClassification      attach a classificationId to N rows
//   - bulkExportIncidentsCsv     emit CSV for just the checked rows
//
// All three open one ctx.db() transaction (RLS auto-applies), then write a
// per-row audit-log entry stamped with a shared batchId so the activity
// timeline tells a coherent story.

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { incidentClassifications, incidents, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvRow } from '@/lib/csv'

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
 * Soft-delete a batch of incidents. Already-locked rows are skipped so the
 * caller can show "N archived, M skipped".
 */
export async function bulkArchiveIncidents(args: {
  incidentIds: string[]
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  if (args.incidentIds.length === 0) return { ok: false, error: 'No incidents selected.' }
  const ids = args.incidentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: incidents.id,
        locked: incidents.locked,
        deletedAt: incidents.deletedAt,
      })
      .from(incidents)
      .where(inArray(incidents.id, ids))

    const editable = rows.filter((r) => !r.locked && r.deletedAt === null).map((r) => r.id)
    const skipped = rows.length - editable.length

    if (editable.length === 0) return { updated: 0, skipped }

    await tx.update(incidents).set({ deletedAt: new Date() }).where(inArray(incidents.id, editable))

    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'incident',
        entityId: id,
        action: 'delete',
        summary: 'Bulk action: archived',
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'incident',
      action: 'delete',
      summary: `Bulk archived ${result.editable.length} incident${result.editable.length === 1 ? '' : 's'}`,
      metadata: { batchId, incidentIds: result.editable, skipped: result.skipped },
    })
  }

  revalidatePath('/incidents')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

/**
 * Apply a single classification to a batch of incidents. Skips locked or
 * deleted rows.
 */
export async function bulkSetIncidentClassification(args: {
  incidentIds: string[]
  classificationId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  if (args.incidentIds.length === 0) return { ok: false, error: 'No incidents selected.' }
  if (!args.classificationId) return { ok: false, error: 'Pick a classification.' }
  const ids = args.incidentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  // Confirm classification belongs to this tenant.
  const classificationExists = await ctx.db(async (tx) => {
    const [c] = await tx
      .select({ id: incidentClassifications.id })
      .from(incidentClassifications)
      .where(eq(incidentClassifications.id, args.classificationId))
      .limit(1)
    return Boolean(c)
  })
  if (!classificationExists) {
    return { ok: false, error: 'Classification not found.' }
  }

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: incidents.id,
        locked: incidents.locked,
        deletedAt: incidents.deletedAt,
      })
      .from(incidents)
      .where(inArray(incidents.id, ids))
    const editable = rows.filter((r) => !r.locked && r.deletedAt === null).map((r) => r.id)
    const skipped = rows.length - editable.length

    if (editable.length === 0) return { updated: 0, skipped }

    await tx
      .update(incidents)
      .set({ classificationId: args.classificationId })
      .where(inArray(incidents.id, editable))

    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'incident',
        entityId: id,
        action: 'update',
        summary: 'Bulk action: set classification',
        after: { classificationId: args.classificationId },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'incident',
      action: 'update',
      summary: `Bulk set classification on ${result.editable.length} incident${result.editable.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        incidentIds: result.editable,
        skipped: result.skipped,
        classificationId: args.classificationId,
      },
    })
  }

  revalidatePath('/incidents')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

/**
 * Emit a CSV of just the checked incident rows. Returns the body + filename so
 * the client can trigger a download via a Blob URL (server actions can't
 * stream attachments directly).
 */
export async function bulkExportIncidentsCsv(args: {
  incidentIds: string[]
}): Promise<BulkCsvResult> {
  const ctx = await requireRequestContext()
  if (args.incidentIds.length === 0) return { ok: false, error: 'No incidents selected.' }
  const ids = args.incidentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const rows = await ctx.db((tx) =>
    tx
      .select({ incident: incidents, site: orgUnits })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(inArray(incidents.id, ids))
      .orderBy(asc(incidents.reference)),
  )

  const headers = [
    'Reference',
    'Occurred',
    'Type',
    'Severity',
    'Status',
    'Title',
    'Site',
    'Description',
    'Location',
  ]
  const csvLines = [csvRow(headers)]
  for (const { incident, site } of rows) {
    csvLines.push(
      csvRow([
        incident.reference,
        new Date(incident.occurredAt).toISOString(),
        incident.type,
        incident.severity,
        incident.status,
        incident.title,
        site?.name ?? '',
        incident.description ?? '',
        incident.location ?? '',
      ]),
    )
  }
  const content = csvLines.join('\r\n') + '\r\n'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `incidents-selected-${stamp}.csv`

  for (const { incident } of rows) {
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: incident.id,
      action: 'export',
      summary: 'Bulk action: exported to CSV',
      metadata: { batchId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'incident',
    action: 'export',
    summary: `Bulk exported ${rows.length} incident${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: {
      batchId,
      incidentIds: rows.map((r) => r.incident.id),
      format: 'csv',
    },
  })

  return { ok: true, filename, content }
}

// ---------- Lookups (used by bulk-bar dropdowns) ----------------------------

export async function listIncidentClassifications(): Promise<
  { id: string; name: string; code: string | null }[]
> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) =>
    tx
      .select({
        id: incidentClassifications.id,
        name: incidentClassifications.name,
        code: incidentClassifications.code,
      })
      .from(incidentClassifications)
      .where(
        and(isNull(incidentClassifications.deletedAt), eq(incidentClassifications.isActive, 1)),
      )
      .orderBy(asc(incidentClassifications.name)),
  )
}
