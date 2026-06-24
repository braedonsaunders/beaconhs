// The dispatcher. Fires a generic domain event at every enabled tenant
// integration that subscribes to it.
//
// Best-effort by contract: a failing integration is recorded on its row
// (status='error', last_error) but never throws, so an outbound push can never
// break the action that emitted the event (mirrors the Flows "must never break
// a module save" rule). External I/O happens inside the integration, off the
// originating DB transaction.

import { and, eq, isNull } from 'drizzle-orm'
import { tenantIntegrations } from '@beaconhs/db/schema'
import { unsealSecret } from '@beaconhs/sync'
import type { RequestContext } from '@beaconhs/tenant'
import { getOutboundIntegration } from './registry'
import type { IntegrationEvent, IntegrationResult } from './types'

type Sealed = Record<string, { ciphertext: string; nonce: string }>

function unsealAll(secrets: Sealed | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets ?? {})) {
    const plain = unsealSecret(v)
    if (plain != null) out[k] = plain
  }
  return out
}

export async function runIntegrations(ctx: RequestContext, event: IntegrationEvent): Promise<void> {
  let rows: (typeof tenantIntegrations.$inferSelect)[]
  try {
    rows = await ctx.db((tx) =>
      tx
        .select()
        .from(tenantIntegrations)
        .where(and(eq(tenantIntegrations.enabled, true), isNull(tenantIntegrations.deletedAt))),
    )
  } catch {
    // Table may not exist yet (schema not pushed) — never break the caller.
    return
  }

  for (const row of rows) {
    const def = getOutboundIntegration(row.integrationKey)
    if (!def || !def.events.includes(event.type)) continue

    const log = (level: 'info' | 'warn' | 'error', msg: string) => {
      const line = `[integration:${row.integrationKey}] ${msg}`
      if (level === 'error') console.error(line)
      else if (level === 'warn') console.warn(line)
      else console.log(line)
    }

    let result: IntegrationResult
    try {
      result = await def.handle(
        {
          tenantId: ctx.tenantId,
          db: ctx.db,
          config: (row.config as Record<string, unknown>) ?? {},
          secrets: unsealAll(row.secrets as Sealed),
          log,
        },
        event,
      )
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    try {
      await ctx.db((tx) =>
        tx
          .update(tenantIntegrations)
          .set({
            lastRunAt: new Date(),
            status: result.ok ? 'ready' : 'error',
            lastError: result.ok ? null : (result.error ?? 'Unknown error'),
          })
          .where(eq(tenantIntegrations.id, row.id)),
      )
    } catch {
      // Status bookkeeping is best-effort.
    }
  }
}
