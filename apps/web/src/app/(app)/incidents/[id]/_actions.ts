// Standalone helpers for the incident detail page's server actions.
//
// The detail `page.tsx` is being edited concurrently and is off-limits for this
// change. Once that work lands, the human should swap the inline `updateStatus`
// server action in `page.tsx` to call `updateIncidentStatusWithEvent` (or just
// add `await emitIncidentStatusChanged(ctx, { … })` after `recordAudit`).
//
// This file is intentionally a no-op import target — nothing references it yet.

'use server'

import { eq } from 'drizzle-orm'
import { incidents } from '@beaconhs/db/schema'
import { emitIncidentStatusChanged } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const STATUSES = [
  'reported',
  'under_investigation',
  'pending_review',
  'closed',
  'reopened',
] as const

/**
 * Replacement for the inline `updateStatus` in `page.tsx`.
 * Emits an `incident.statusChanged` event after the audit log.
 */
export async function updateIncidentStatusWithEvent(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return

  const before = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(incidents).where(eq(incidents.id, id)).limit(1)
    return row ?? null
  })
  if (!before) return
  const fromStatus = before.status
  const closing = status === 'closed'

  await ctx.db((tx) =>
    tx
      .update(incidents)
      .set({
        status: status as (typeof STATUSES)[number],
        closedAt: closing ? new Date() : null,
        inProgress: !closing,
        locked: closing,
      })
      .where(eq(incidents.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'update',
    summary: `Status changed to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })

  await emitIncidentStatusChanged(ctx, {
    incidentId: id,
    fromStatus,
    toStatus: status,
  })
}
