// The dispatcher entrypoint core modules call. Finds every enabled automation
// whose trigger matches and hands each to the durable worker queue
// (`outbound` / outbound_dispatch, retried), so a slow/failing external service
// never blocks the originating save. If the queue is unavailable (e.g. Redis
// down) it falls back to in-request delivery. Best-effort: never throws.

import { and, eq, isNull } from 'drizzle-orm'
import { tenantIntegrations } from '@beaconhs/db/schema'
import { dispatchOne, type DispatchCtx } from './dispatch'
import type { IntegrationEvent } from './types'

export async function runIntegrations(ctx: DispatchCtx, event: IntegrationEvent): Promise<void> {
  let ids: { id: string }[]
  try {
    ids = await ctx.db((tx) =>
      tx
        .select({ id: tenantIntegrations.id })
        .from(tenantIntegrations)
        .where(
          and(
            eq(tenantIntegrations.enabled, true),
            eq(tenantIntegrations.triggerKey, event.type),
            isNull(tenantIntegrations.deletedAt),
          ),
        ),
    )
  } catch {
    // Table/columns may not exist yet — never break the caller.
    return
  }
  if (ids.length === 0) return

  // Prefer the durable queue; fall back to in-request delivery if it's down.
  try {
    const { enqueueOutboundDispatch } = await import('@beaconhs/jobs')
    await Promise.all(
      ids.map((r) =>
        enqueueOutboundDispatch({ tenantId: ctx.tenantId, automationId: r.id, event }),
      ),
    )
  } catch {
    for (const r of ids) {
      try {
        await dispatchOne(ctx, r.id, event)
      } catch {
        /* never break the caller */
      }
    }
  }
}
