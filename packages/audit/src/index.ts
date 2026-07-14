import type { Database } from '@beaconhs/db'
import { auditLog } from '@beaconhs/db/schema'

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
  | 'send'
  | 'view_sensitive'
  | 'impersonate'
  | 'impersonate_stop'

export type AuditEvent = {
  tenantId: string
  actorUserId?: string | null
  actorIp?: string | null
  actorUserAgent?: string | null
  entityType: string
  entityId?: string
  action: AuditAction
  summary?: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export async function audit(db: Database, evt: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    tenantId: evt.tenantId,
    actorUserId: evt.actorUserId ?? null,
    actorIp: evt.actorIp ?? null,
    actorUserAgent: evt.actorUserAgent ?? null,
    entityType: evt.entityType,
    entityId: evt.entityId,
    action: evt.action,
    summary: evt.summary,
    before: evt.before ?? null,
    after: evt.after ?? null,
    metadata: evt.metadata ?? {},
  })
}

/**
 * Compute a shallow diff between two JSON-serialisable objects.
 * Returns { added, removed, changed } where `changed[k] = { before, after }`.
 */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { before: unknown; after: unknown }>
} {
  const b = before ?? ({} as T)
  const a = after ?? ({} as T)
  const added: Record<string, unknown> = {}
  const removed: Record<string, unknown> = {}
  const changed: Record<string, { before: unknown; after: unknown }> = {}
  const keys = new Set([...Object.keys(b), ...Object.keys(a)])
  for (const k of keys) {
    const bv = b[k]
    const av = a[k]
    if (!(k in b)) added[k] = av
    else if (!(k in a)) removed[k] = bv
    else if (JSON.stringify(bv) !== JSON.stringify(av)) changed[k] = { before: bv, after: av }
  }
  return { added, removed, changed }
}
