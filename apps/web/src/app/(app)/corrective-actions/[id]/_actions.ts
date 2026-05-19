// Standalone helpers for the corrective-action detail page's server actions.
//
// The detail `page.tsx` is being edited concurrently and is off-limits for
// this change. The human should wire the inline `updateStatus` action to also
// emit an event (assignment changes → emitCorrectiveActionAssigned, close →
// emitCorrectiveActionCompleted).
//
// This file is intentionally a no-op import target — nothing references it yet.

'use server'

import { eq } from 'drizzle-orm'
import { correctiveActions } from '@beaconhs/db/schema'
import {
  emitCorrectiveActionAssigned,
  emitCorrectiveActionCompleted,
} from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const STATUSES = [
  'open',
  'in_progress',
  'pending_verification',
  'closed',
  'cancelled',
] as const

/**
 * Replacement for the inline `updateStatus` in `page.tsx`.
 * Emits `ca.completed` whenever the CA moves to closed or pending_verification,
 * and `ca.assigned` whenever the owner changes (covered in updateOwner below).
 */
export async function updateCaStatusWithEvent(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as (typeof STATUSES)[number]
  if (!STATUSES.includes(status)) return
  const closing = status === 'closed' || status === 'cancelled'

  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ status, closedAt: closing ? new Date() : null, locked: status === 'closed' })
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: `Status moved to "${status.replace(/_/g, ' ')}"`,
    after: { status },
  })

  // Notify on completion-ish statuses.
  if (status === 'closed' || status === 'pending_verification' || status === 'cancelled') {
    await emitCorrectiveActionCompleted(ctx, {
      caId: id,
      completerUserId: ctx.userId,
    })
  }
}

/** Optional helper for when CA ownership changes via the detail page. */
export async function updateCaOwnerWithEvent(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const ownerTenantUserId = String(formData.get('ownerTenantUserId') ?? '') || null

  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ ownerTenantUserId })
      .where(eq(correctiveActions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'update',
    summary: 'Owner updated',
    after: { ownerTenantUserId },
  })
  await emitCorrectiveActionAssigned(ctx, {
    caId: id,
    assigneeUserId: null,
    assignerUserId: ctx.userId,
  })
}
