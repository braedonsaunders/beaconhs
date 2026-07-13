// API-key authentication for the public REST API.
//
// A request authenticates with `Authorization: Bearer bhs_live_…`. We hash the
// presented secret and look it up across tenants (RLS-bypassed — we don't know
// the tenant yet), reject revoked/expired keys, stamp last_used_at, then build a
// tenant-scoped RequestContext so every downstream query is RLS-bound to the
// key's tenant exactly like a UI session.

import { createHash } from 'node:crypto'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { apiKeys, tenants } from '@beaconhs/db/schema'
import { consumeRateLimit } from '@beaconhs/jobs/rate-limit'
import { makeTenantContext, type RequestContext } from '@beaconhs/tenant'
import { ApiError } from './errors'
import { sanitizeApiPermissions } from './permissions'
import { isActiveTenantStatus } from '../active-tenant'
import { parseApiBearerToken } from './token'

type ApiKeyInfo = {
  id: string
  name: string
  tenantId: string
  permissions: string[]
  builderTemplateIds: string[]
  rateLimitHeaders: Record<string, string>
}

export type ApiAuth = {
  ctx: RequestContext
  key: ApiKeyInfo
}

/**
 * Resolve the API key on a request into an auth context, or throw an
 * ApiError the caller renders. Stamps last_used_at on success.
 */
export async function authenticateApiKey(req: Request): Promise<ApiAuth> {
  const token = parseApiBearerToken(req)
  if (!token) throw ApiError.unauthorized()

  const keyHash = createHash('sha256').update(token).digest('hex')

  const result = await withSuperAdmin(db, async (tx) => {
    const [match] = await tx
      .select({ key: apiKeys, tenantStatus: tenants.status })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1)
    if (!match) return { error: 'missing' } as const
    if (match.key.revokedAt) return { error: 'revoked' } as const
    if (match.key.expiresAt && match.key.expiresAt.getTime() <= Date.now()) {
      return { error: 'expired' } as const
    }
    if (!isActiveTenantStatus(match.tenantStatus)) {
      return { error: 'tenant_unavailable' } as const
    }

    return { key: match.key } as const
  })

  if ('error' in result) {
    if (result.error === 'revoked') throw ApiError.unauthorized('API key has been revoked')
    if (result.error === 'expired') throw ApiError.unauthorized('API key has expired')
    if (result.error === 'tenant_unavailable') {
      throw ApiError.unauthorized('API key tenant is not active')
    }
    throw ApiError.unauthorized()
  }
  const row = result.key

  let rate
  try {
    rate = await consumeRateLimit({
      key: `public-api:key:${row.id}`,
      limit: 600,
      windowSeconds: 60,
    })
  } catch (error) {
    console.error('[api/v1] rate limiter unavailable', error)
    throw ApiError.unavailable('API rate limiter is unavailable')
  }
  const retryAfter = Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1_000))
  const rateLimitHeaders = {
    'RateLimit-Limit': '600',
    'RateLimit-Remaining': String(rate.remaining),
    'RateLimit-Reset': String(Math.ceil(rate.resetAt.getTime() / 1_000)),
  }
  if (!rate.allowed) throw ApiError.rateLimited(retryAfter, rateLimitHeaders)

  // Avoid a write lock on every request. This telemetry timestamp is updated at
  // most once every five minutes and is not part of the authorization decision.
  const lastUsedCutoff = new Date(Date.now() - 5 * 60_000)
  await withSuperAdmin(db, (tx) =>
    tx
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, row.id),
          or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, lastUsedCutoff)),
        ),
      ),
  ).catch((error) => console.error('[api/v1] last-used telemetry update failed', error))

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

  return {
    ctx,
    key: {
      id: row.id,
      name: row.name,
      tenantId: row.tenantId,
      permissions,
      builderTemplateIds: row.builderTemplateIds ?? [],
      rateLimitHeaders,
    },
  }
}
