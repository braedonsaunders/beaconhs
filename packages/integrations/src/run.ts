// The dispatcher entrypoint core modules call. Finds every enabled automation
// whose trigger matches and hands each to the durable worker queue
// (`outbound` / outbound_dispatch, retried). Request mutations first persist
// the event in domain_event_outbox; only the worker calls this publisher.

import { and, eq, isNull } from 'drizzle-orm'
import { tenantIntegrations } from '@beaconhs/db/schema'
import type { DispatchCtx } from './dispatch'
import type { IntegrationEvent } from './types'

export async function publishIntegrationEvent(
  ctx: DispatchCtx,
  event: IntegrationEvent,
  sourceEventId: string,
): Promise<void> {
  const ids = await ctx.db((tx) =>
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
  if (ids.length === 0) return

  const { enqueueOutboundDispatch } = await import('@beaconhs/jobs')
  await Promise.all(
    ids.map((row) =>
      enqueueOutboundDispatch(
        { tenantId: ctx.tenantId, automationId: row.id, event },
        `domain-outbound|${sourceEventId}|${row.id}`,
      ),
    ),
  )
}
