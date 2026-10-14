// Draft sync endpoint for the Builder form filler.
//
// The filler's local-first draft queue (apps/web/src/lib/offline-drafts) posts
// every queued draft save here with fetch, and sends the same body with
// `navigator.sendBeacon` when the page is hidden or unloaded. A route handler
// (not a Server Action) is used because a beacon outlives the React tree and a
// fetch can be timed out and retried from any page.
//
// The body is either a whole-draft snapshot from the guided fill page (with
// the server ordering cursor and, for an entry whose id was minted on the
// device, an idempotent `create` block) or a batch of record-page field
// patches (`kind: 'fields'`, each a compare-and-set against the value the
// device last saw). Validation, tenant scoping, ownership, ordering, and DB
// writes all live in `saveDraftSyncRequest`. Failures carry a machine-readable
// `reason` the queue uses to decide between retrying, asking the worker, or
// dropping its copy.

import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/auth'
import {
  saveDraftSyncRequest,
  type DraftSaveFailureReason,
} from '@/app/(app)/apps/_lib/draft-persistence'
import {
  readBoundedJsonBody,
  RequestBodyLengthError,
  RequestBodyParseError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'

export const dynamic = 'force-dynamic'
const MAX_DRAFT_BYTES = 1024 * 1024
const MAX_DRAFT_READ_MS = 15_000

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

function failure(reason: DraftSaveFailureReason, error: string) {
  return NextResponse.json({ ok: false, error, reason }, { status: STATUS_BY_REASON[reason] })
}

export async function POST(req: Request): Promise<NextResponse> {
  // Drafts are only ever written by this app's own pages. Browsers label
  // cross-site requests (including beacons), so refuse them outright.
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') {
    return failure('forbidden', 'You do not have access to this app')
  }

  const ctx = await getRequestContext()
  if (!ctx) return failure('unauthorized', 'Sign in again to sync your changes.')

  let body: unknown
  try {
    body = await readBoundedJsonBody(req, {
      maxBytes: MAX_DRAFT_BYTES,
      timeoutMs: MAX_DRAFT_READ_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return failure('too_large', 'This draft is too large to save')
    }
    if (error instanceof RequestBodyTimeoutError) {
      return failure('unavailable', 'Unable to save this draft right now')
    }
    if (error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError) {
      return failure('invalid', 'Invalid draft payload')
    }
    console.error('[forms] failed to read draft request', error)
    return failure('invalid', 'Invalid draft payload')
  }

  const result = await saveDraftSyncRequest(ctx, body)
  if (!result.ok) {
    return NextResponse.json(result, { status: STATUS_BY_REASON[result.reason] })
  }
  return NextResponse.json(result)
}
