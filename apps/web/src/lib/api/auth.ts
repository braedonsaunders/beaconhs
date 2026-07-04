// API-key authentication for the public REST API.
//
// A request authenticates with `Authorization: Bearer bhs_live_…`. We hash the
// presented secret and look it up across tenants (RLS-bypassed — we don't know
// the tenant yet), reject revoked/expired keys, stamp last_used_at, then build a
// tenant-scoped RequestContext so every downstream query is RLS-bound to the
// key's tenant exactly like a UI session.

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { apiKeys } from '@beaconhs/db/schema'
import { makeTenantContext, type RequestContext } from '@beaconhs/tenant'
import { ApiError } from './errors'
import { sanitizeApiPermissions } from './permissions'

export type ApiKeyInfo = {
  id: string
  name: string
  tenantId: string
  permissions: string[]
}

export type ApiAuth = {
  ctx: RequestContext
  key: ApiKeyInfo
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

/**
 * Resolve the API key on a request into an auth context, or throw an
 * ApiError the caller renders. Stamps last_used_at on success.
 */
export async function authenticateApiKey(req: Request): Promise<ApiAuth> {
  const token = bearerToken(req)
  if (!token) throw ApiError.unauthorized()

  const keyHash = createHash('sha256').update(token).digest('hex')

  const row = await withSuperAdmin(db, async (tx) => {
    const [k] = await tx.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1)
    if (!k) return null
    // Stamp usage opportunistically inside the same bypass transaction.
    await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id))
    return k
  })

  if (!row) throw ApiError.unauthorized()
  if (row.revokedAt) throw ApiError.unauthorized('API key has been revoked')
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('API key has expired')
  }

  const permissions = sanitizeApiPermissions(row.permissions ?? [])
  const ctx = makeTenantContext(db, {
    userId: row.createdBy ?? `api_key:${row.id}`,
    tenantId: row.tenantId,
    isSuperAdmin: false,
    // No human user behind an API key — default to the platform timezone. It only
    // affects server-rendered local-time display, which JSON API responses don't use.
    timezone: 'America/Toronto',
    membership: null,
    // No human employee behind an API key — record visibility is full-tenant.
    personId: null,
    apiKey: { id: row.id, name: row.name },
    // API keys use the same permission vocabulary as tenant roles. They are
    // tenant-level credentials, so record visibility is full-tenant.
    permissions: new Set(permissions),
    scopes: [{ type: 'tenant' }],
  })

  return { ctx, key: { id: row.id, name: row.name, tenantId: row.tenantId, permissions } }
}
