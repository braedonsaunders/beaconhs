// Per-automation delivery — the unit of work the worker (and the in-request
// fallback) runs. Loads ONE automation, resolves its destination, hands it the
// event's items + prior external refs, delivers, reconciles the ledger and the
// row's status. Returns {ok,error} so the worker can throw → retry. Never throws
// itself for a delivery failure (only a thrown infra error would propagate).

import { and, eq, isNull } from 'drizzle-orm'
import { integrationExportLog, tenantIntegrations } from '@beaconhs/db/schema'
import { unsealSecret } from '@beaconhs/sync'
import type { Database } from '@beaconhs/db'
import { getDestination } from './destinations/registry'
import type { DeliverRef, DeliverResult, IntegrationEvent } from './types'

// The minimal context dispatch needs — a tenant id + the RLS-scoped executor.
// Satisfied by both the web RequestContext and a worker-built ctx.
export interface DispatchCtx {
  tenantId: string
  db: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>
}

type Sealed = Record<string, { ciphertext: string; nonce: string }>

function unsealAll(secrets: Sealed | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets ?? {})) {
    const plain = unsealSecret(v)
    if (plain != null) out[k] = plain
  }
  return out
}

export async function loadPriorRefs(
  ctx: DispatchCtx,
  automationId: string,
  triggerKey: string,
  subjectId: string,
): Promise<string[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({ externalRef: integrationExportLog.externalRef })
      .from(integrationExportLog)
      .where(
        and(
          eq(integrationExportLog.tenantId, ctx.tenantId),
          eq(integrationExportLog.integrationKey, automationId),
          eq(integrationExportLog.subjectType, triggerKey),
          eq(integrationExportLog.subjectId, subjectId),
        ),
      ),
  )
  return rows.map((r) => r.externalRef).filter((r): r is string => !!r)
}

async function replaceRefs(
  ctx: DispatchCtx,
  automationId: string,
  destinationKey: string,
  triggerKey: string,
  subjectId: string,
  refs: DeliverRef[],
): Promise<void> {
  await ctx.db(async (tx) => {
    await tx
      .delete(integrationExportLog)
      .where(
        and(
          eq(integrationExportLog.tenantId, ctx.tenantId),
          eq(integrationExportLog.integrationKey, automationId),
          eq(integrationExportLog.subjectType, triggerKey),
          eq(integrationExportLog.subjectId, subjectId),
        ),
      )
    if (refs.length > 0) {
      await tx.insert(integrationExportLog).values(
        refs.map((r) => ({
          tenantId: ctx.tenantId,
          integrationKey: automationId,
          subjectType: triggerKey,
          subjectId,
          externalSystem: destinationKey,
          externalRef: r.externalRef,
          status: 'pushed' as const,
          detail: r.detail,
        })),
      )
    }
  })
}

export async function dispatchOne(
  ctx: DispatchCtx,
  automationId: string,
  event: IntegrationEvent,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.id, automationId), isNull(tenantIntegrations.deletedAt)))
      .limit(1)
    return r ?? null
  })
  if (!row || !row.enabled) return { ok: true } // disabled/removed since enqueue — no-op
  const dest = getDestination(row.destinationKey)
  if (!dest) return { ok: true }

  const config = (row.config as Record<string, unknown>) ?? {}
  const mapping = (config.mapping as Record<string, unknown>) ?? {}
  const oncePerRecord = config.oncePerRecord === true

  let priorRefs: string[] = []
  try {
    priorRefs = await loadPriorRefs(ctx, automationId, event.type, event.subjectId)
  } catch {
    /* ledger optional */
  }
  if (oncePerRecord && priorRefs.length > 0) return { ok: true } // already delivered for this record

  const log = (level: 'info' | 'warn' | 'error', msg: string) => {
    const line = `[integration:${row.name ?? row.id}] ${msg}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }

  let result: DeliverResult
  try {
    result = await dest.deliver({
      tenantId: ctx.tenantId,
      db: ctx.db,
      config,
      secrets: unsealAll(row.secrets as Sealed),
      mapping,
      items: event.items,
      subjectId: event.subjectId,
      triggerKey: event.type,
      priorRefs,
      log,
    })
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (result.ok && result.refs) {
    try {
      await replaceRefs(ctx, automationId, dest.key, event.type, event.subjectId, result.refs)
    } catch {
      /* ledger bookkeeping is best-effort */
    }
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
        .where(eq(tenantIntegrations.id, automationId)),
    )
  } catch {
    /* status bookkeeping is best-effort */
  }

  return { ok: result.ok, error: result.error, summary: result.summary }
}
