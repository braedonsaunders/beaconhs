import { auditLog, user } from '@beaconhs/db/schema'
import { desc, eq } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'sign'
  | 'publish'
  | 'archive'
  | 'invite'
  | 'login'
  | 'logout'
  | 'export'
  | 'copy'
  | 'view_sensitive'
  | 'impersonate'
  | 'impersonate_stop'

export async function recordAudit(
  ctx: RequestContext,
  evt: {
    entityType: string
    entityId?: string
    action: AuditAction
    summary?: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  // Dual-attribution: while an admin is impersonating, every write is performed
  // "as" the target (actorUserId stays the target so it reads as their own
  // activity), but we stamp the real actor into metadata + flag the summary so
  // the trail stays honest. Start/stop entries themselves are recorded by the
  // admin's own (non-impersonated) context, so this branch is skipped for them.
  const imp = ctx.impersonation
  const metadata = imp
    ? {
        ...(evt.metadata ?? {}),
        impersonatorUserId: imp.actor.userId,
        impersonatorName: imp.actor.name,
      }
    : (evt.metadata ?? {})
  const summary = imp && evt.summary ? `[impersonated] ${evt.summary}` : evt.summary

  await ctx.db((tx) =>
    tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      entityType: evt.entityType,
      entityId: evt.entityId,
      action: evt.action,
      summary,
      before: evt.before ?? null,
      after: evt.after ?? null,
      metadata,
    }),
  )
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
      .where(eq(auditLog.entityId, entityId))
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
