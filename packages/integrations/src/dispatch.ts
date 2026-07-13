// Per-automation delivery — the unit of work the worker runs. Loads ONE
// automation, resolves its destination, hands it the
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

interface PriorDelivery {
  refs: string[]
  retryRefs: string[]
  complete: boolean
}

export function summarizePriorDelivery(
  rows: readonly { externalRef: string | null; status: string }[],
): PriorDelivery {
  const refs = rows.map((row) => row.externalRef).filter((ref): ref is string => !!ref)
  return {
    refs,
    retryRefs: rows
      .filter((row) => row.status !== 'pushed')
      .map((row) => row.externalRef)
      .filter((ref): ref is string => !!ref),
    complete: rows.length > 0 && rows.every((row) => row.status === 'pushed'),
  }
}

async function loadPriorDelivery(
  ctx: DispatchCtx,
  automationId: string,
  triggerKey: string,
  subjectId: string,
): Promise<PriorDelivery> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        externalRef: integrationExportLog.externalRef,
        status: integrationExportLog.status,
      })
      .from(integrationExportLog)
      .where(
        and(
          eq(integrationExportLog.tenantId, ctx.tenantId),
          eq(integrationExportLog.automationId, automationId),
          eq(integrationExportLog.subjectType, triggerKey),
          eq(integrationExportLog.subjectId, subjectId),
        ),
      ),
  )
  return summarizePriorDelivery(rows)
}

async function replaceRefs(
  ctx: DispatchCtx,
  automationId: string,
  destinationKey: string,
  triggerKey: string,
  subjectId: string,
  refs: DeliverRef[],
  status: 'pushed' | 'failed',
): Promise<void> {
  await ctx.db(async (tx) => {
    await tx
      .delete(integrationExportLog)
      .where(
        and(
          eq(integrationExportLog.tenantId, ctx.tenantId),
          eq(integrationExportLog.automationId, automationId),
          eq(integrationExportLog.subjectType, triggerKey),
          eq(integrationExportLog.subjectId, subjectId),
        ),
      )
    if (refs.length > 0) {
      await tx.insert(integrationExportLog).values(
        refs.map((r) => ({
          tenantId: ctx.tenantId,
          automationId,
          subjectType: triggerKey,
          subjectId,
          externalSystem: destinationKey,
          externalRef: r.externalRef,
          status,
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

  let prior: PriorDelivery = { refs: [], retryRefs: [], complete: false }
  try {
    prior = await loadPriorDelivery(ctx, automationId, event.type, event.subjectId)
  } catch (error) {
    return {
      ok: false,
      error: `Cannot verify the outbound delivery ledger: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (oncePerRecord && prior.complete) return { ok: true } // already delivered for this record

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
      priorRefs: prior.refs,
      retryRefs: prior.retryRefs,
      oncePerRecord,
      log,
    })
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  // Persist an explicitly returned ref set, including an empty one that clears
  // stale refs. Partial results are marked failed: a retry receives those refs
  // as retryRefs, while oncePerRecord only suppresses a fully pushed delivery.
  if (result.refs !== undefined) {
    try {
      await replaceRefs(
        ctx,
        automationId,
        dest.key,
        event.type,
        event.subjectId,
        result.refs,
        result.ok ? 'pushed' : 'failed',
      )
    } catch (error) {
      result = {
        ...result,
        ok: false,
        error: `Outbound delivery could not be recorded safely: ${error instanceof Error ? error.message : String(error)}`,
      }
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
