// Shared request handling for the two local-first sync routes
// (/api/apps/draft-save and /api/records/sync): same-origin only, signed-in
// only, a bounded JSON body, and one status code per failure reason so the
// client queue (transport.ts) can classify the answer.

import { NextResponse } from 'next/server'
import type { RequestContext } from '@beaconhs/tenant'
import { getRequestContext } from '@/lib/auth'
import { draftScopeKey } from './model'
import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'
import { SYNC_MAX_BODY_BYTES, type DraftSaveFailureReason, type SyncFailure } from './protocol'

const MAX_READ_MS = 15_000

const STATUS_BY_REASON: Record<DraftSaveFailureReason, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  closed: 409,
  locked: 423,
  too_large: 413,
  unavailable: 503,
}

function failure(reason: DraftSaveFailureReason, error: string): NextResponse {
  return NextResponse.json({ ok: false, error, reason } satisfies SyncFailure, {
    status: STATUS_BY_REASON[reason],
  })
}

export async function handleSyncRequest(
  req: Request,
  run: (ctx: RequestContext, body: unknown) => Promise<{ ok: true } | SyncFailure>,
): Promise<NextResponse> {
  // Only this app's own pages sync. Browsers label cross-site requests
  // (including beacons), so refuse them outright.
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') {
    return failure('forbidden', 'You do not have access to this record.')
  }

  const ctx = await getRequestContext()
  if (!ctx) return failure('unauthorized', 'Sign in again to sync your changes.')

  let body: unknown
  try {
    body = await readBoundedJsonBody(req, { maxBytes: SYNC_MAX_BODY_BYTES, timeoutMs: MAX_READ_MS })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return failure('too_large', 'These changes are too large to save.')
    }
    if (error instanceof RequestBodyTimeoutError) {
      return failure('unavailable', 'Unable to save right now.')
    }
    if (!(error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError)) {
      console.error('[sync] failed to read request body', error)
    }
    return failure('invalid', 'Invalid sync payload.')
  }

  // Work queued under another tenant, account, or impersonation session waits
  // until that session is active again; it is never applied to this one.
  const scope =
    typeof body === 'object' && body !== null ? (body as { scope?: unknown }).scope : null
  const expected = draftScopeKey({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    actorUserId: ctx.impersonation?.actor.userId ?? null,
  })
  if (scope !== expected) {
    return failure(
      typeof scope === 'string' ? 'unavailable' : 'invalid',
      typeof scope === 'string'
        ? 'These changes were saved under another workspace or sign-in. They will sync when you switch back.'
        : 'Invalid sync payload.',
    )
  }

  const result = await run(ctx, body)
  if (!result.ok) return failure(result.reason, result.error)
  return NextResponse.json(result)
}
