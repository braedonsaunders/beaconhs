import { createHash } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { apiIdempotencyKeys } from '@beaconhs/db/schema'
import type { ApiAuth } from './auth'
import { ApiError } from './errors'

const KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/
const RETENTION_MS = 24 * 60 * 60 * 1_000

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)]),
    )
  }
  return value
}

export function apiIdempotencyRequestDigest(request: Request, body: unknown): string {
  const url = new URL(request.url)
  return createHash('sha256')
    .update(`${request.method.toUpperCase()}\n${url.pathname}\n${JSON.stringify(canonical(body))}`)
    .digest('hex')
}

type IdempotentResult = {
  body: Record<string, unknown>
  status: number
  replayed: boolean
}

export async function runIdempotentMutation(
  auth: ApiAuth,
  request: Request,
  body: unknown,
  execute: () => Promise<{ body: Record<string, unknown>; status: number }>,
): Promise<IdempotentResult> {
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!KEY_RE.test(idempotencyKey)) {
    throw ApiError.invalid(
      'Idempotency-Key is required for writes and must be 1-128 URL-safe characters',
    )
  }
  const requestHash = apiIdempotencyRequestDigest(request, body)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + RETENTION_MS)

  const reservation = await auth.ctx.db(async (tx) => {
    await tx
      .delete(apiIdempotencyKeys)
      .where(
        and(
          eq(apiIdempotencyKeys.apiKeyId, auth.key.id),
          eq(apiIdempotencyKeys.idempotencyKey, idempotencyKey),
          eq(apiIdempotencyKeys.status, 'completed'),
          lt(apiIdempotencyKeys.expiresAt, now),
        ),
      )
    const [inserted] = await tx
      .insert(apiIdempotencyKeys)
      .values({
        tenantId: auth.key.tenantId,
        apiKeyId: auth.key.id,
        idempotencyKey,
        requestHash,
        method: request.method.toUpperCase(),
        path: new URL(request.url).pathname,
        status: 'processing',
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: apiIdempotencyKeys.id })
    if (inserted) return { id: inserted.id, owner: true as const }
    const [existing] = await tx
      .select()
      .from(apiIdempotencyKeys)
      .where(
        and(
          eq(apiIdempotencyKeys.apiKeyId, auth.key.id),
          eq(apiIdempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1)
    if (!existing) throw ApiError.conflict('Idempotency reservation could not be resolved')
    if (existing.requestHash !== requestHash) {
      throw ApiError.conflict('Idempotency-Key was already used for a different request')
    }
    if (existing.status !== 'completed' || !existing.responseBody || !existing.responseStatus) {
      throw ApiError.conflict('A request with this Idempotency-Key is still processing')
    }
    return {
      owner: false as const,
      body: existing.responseBody,
      status: existing.responseStatus,
    }
  })

  if (!reservation.owner) {
    return { body: reservation.body, status: reservation.status, replayed: true }
  }

  try {
    const result = await execute()
    await auth.ctx.db((tx) =>
      tx
        .update(apiIdempotencyKeys)
        .set({ status: 'completed', responseStatus: result.status, responseBody: result.body })
        .where(eq(apiIdempotencyKeys.id, reservation.id)),
    )
    return { ...result, replayed: false }
  } catch (error) {
    // Validation/authorization failures are known to precede mutation and may
    // be retried with the same key. Unknown failures deliberately keep the
    // reservation in processing state: the mutation or its side effects may
    // already have committed, so releasing the key could duplicate a write.
    if (error instanceof ApiError && error.status < 500) {
      await auth.ctx
        .db((tx) => tx.delete(apiIdempotencyKeys).where(eq(apiIdempotencyKeys.id, reservation.id)))
        .catch((cleanupError) =>
          console.error('[api/v1] idempotency reservation cleanup failed', cleanupError),
        )
    }
    throw error
  }
}
