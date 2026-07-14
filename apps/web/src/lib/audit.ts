import { auditLog, users as user } from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import type { AuditAction } from '@beaconhs/audit'

type RecordAuditEvent = {
  entityType: string
  entityId?: string
  action: AuditAction
  summary?: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  dedupKey?: string
}

/**
 * Write an audit row using an existing tenant transaction. Safety-critical
 * mutations use this path so the business write and its audit evidence either
 * both commit or both roll back. Attribution intentionally matches
 * `recordAudit`, including API-key actors and impersonated sessions.
 */
export async function recordAuditInTransaction(
  tx: Database,
  ctx: RequestContext,
  evt: RecordAuditEvent,
): Promise<void> {
  // Dual-attribution: while an admin is impersonating, every write is performed
  // "as" the target (actorUserId stays the target so it reads as their own
  // activity), but we stamp the real actor into metadata + flag the summary so
  // the trail stays honest. Start/stop entries themselves are recorded by the
  // admin's own (non-impersonated) context, so this branch is skipped for them.
  const imp = ctx.impersonation
  const isSyntheticApiActor = Boolean(ctx.apiKey && ctx.userId === `api_key:${ctx.apiKey.id}`)
  const metadata = imp
    ? {
        ...(evt.metadata ?? {}),
        ...(ctx.apiKey
          ? { actorKind: 'api_key', apiKeyId: ctx.apiKey.id, apiKeyName: ctx.apiKey.name }
          : {}),
        impersonatorUserId: imp.actor.userId,
        impersonatorName: imp.actor.name,
      }
    : {
        ...(evt.metadata ?? {}),
        ...(ctx.apiKey
          ? { actorKind: 'api_key', apiKeyId: ctx.apiKey.id, apiKeyName: ctx.apiKey.name }
          : {}),
      }
  const summary = imp && evt.summary ? `[impersonated] ${evt.summary}` : evt.summary
  const actorUserId = isSyntheticApiActor ? null : ctx.userId

  const insert = tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    actorUserId,
    entityType: evt.entityType,
    entityId: evt.entityId,
    action: evt.action,
    dedupKey: evt.dedupKey,
    summary,
    before: evt.before ?? null,
    after: evt.after ?? null,
    metadata,
  })
  await (evt.dedupKey
    ? insert.onConflictDoNothing({ target: [auditLog.tenantId, auditLog.dedupKey] })
    : insert)
}

export async function recordAudit(ctx: RequestContext, evt: RecordAuditEvent): Promise<void> {
  await ctx.db((tx) => recordAuditInTransaction(tx, ctx, evt))
}

export async function recentActivityForEntity(
  ctx: RequestContext,
  entityType: string,
  entityId: string,
  limit = 25,
): Promise<
  {
    id: string
    action: string
    summary: string | null
    actor: string | null
    occurredAt: Date
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
  }[]
> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ log: auditLog, actor: user })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.occurredAt))
      .limit(limit)
    return rows.map((r) => ({
      id: r.log.id,
      action: r.log.action,
      summary: r.log.summary,
      actor: r.actor?.name ?? null,
      occurredAt: r.log.occurredAt,
      before: r.log.before,
      after: r.log.after,
    }))
  })
}

/**
 * URL-driven detail-page activity feed. Unlike `recentActivityForEntity`, this
 * never silently truncates a record's history: it returns an exact filtered
 * total and one bounded page, plus the actions available to the filter UI.
 */
export async function activityPageForEntity(
  ctx: RequestContext,
  entityType: string,
  entityId: string,
  options: {
    q?: string
    action?: string
    page: number
    perPage: number
    dir?: 'asc' | 'desc'
  },
): Promise<{
  rows: Awaited<ReturnType<typeof recentActivityForEntity>>
  total: number
  filteredTotal: number
  actions: { action: string; count: number }[]
}> {
  return ctx.db(async (tx) => {
    const baseWhere = and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId))
    const searchWhere = options.q
      ? or(
          ilike(auditLog.summary, `%${options.q}%`),
          ilike(auditLog.action, `%${options.q}%`),
          ilike(user.name, `%${options.q}%`),
        )
      : undefined
    const filteredWhere = and(
      baseWhere,
      searchWhere,
      options.action ? eq(auditLog.action, options.action) : undefined,
    )

    const [totalRows, filteredRows, actionRows, rows] = await Promise.all([
      tx.select({ count: count() }).from(auditLog).where(baseWhere),
      tx
        .select({ count: count() })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.actorUserId))
        .where(filteredWhere),
      tx
        .select({ action: auditLog.action, count: count() })
        .from(auditLog)
        .where(baseWhere)
        .groupBy(auditLog.action)
        .orderBy(asc(auditLog.action)),
      tx
        .select({ log: auditLog, actor: user })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.actorUserId))
        .where(filteredWhere)
        .orderBy(
          options.dir === 'asc' ? asc(auditLog.occurredAt) : desc(auditLog.occurredAt),
          options.dir === 'asc' ? asc(auditLog.id) : desc(auditLog.id),
        )
        .limit(options.perPage)
        .offset((options.page - 1) * options.perPage),
    ])

    return {
      rows: rows.map((row) => ({
        id: row.log.id,
        action: row.log.action,
        summary: row.log.summary,
        actor: row.actor?.name ?? null,
        occurredAt: row.log.occurredAt,
        before: row.log.before,
        after: row.log.after,
      })),
      total: Number(totalRows[0]?.count ?? 0),
      filteredTotal: Number(filteredRows[0]?.count ?? 0),
      actions: actionRows.map((row) => ({
        action: row.action,
        count: Number(row.count),
      })),
    }
  })
}
