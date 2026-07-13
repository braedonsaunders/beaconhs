// Draft autosave endpoint.
//
// The fill page's client-side autosave normally hits the `saveFormResponseDraft`
// Server Action. But on `beforeunload` the browser tears the page down before
// any fetch can settle — and Server Action invocations require an alive React
// tree on the client. The reliable cross-browser path for "save before exit"
// is `navigator.sendBeacon`, which fires a fire-and-forget POST with a Blob
// body even as the document is unloading.
//
// This route accepts the same shape `saveFormResponseDraft` does and delegates
// to the shared `persistDraft` helper (which carries the Zod validation,
// tenant scoping, ownership check, and DB writes). The handler itself just
// resolves the request context and shuttles the parsed JSON through.

import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/auth'
import { persistDraft, type SaveDraftInput } from '@/app/(app)/apps/templates/[id]/fill/actions'
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

export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await getRequestContext()
  if (!ctx) {
    // sendBeacon ignores response status, so this only matters for the
    // explicit-fetch fallback path. Still return a real status so the
    // browser doesn't try to retry.
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await readBoundedJsonBody(req, {
      maxBytes: MAX_DRAFT_BYTES,
      timeoutMs: MAX_DRAFT_READ_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false, error: 'draft payload too large' }, { status: 413 })
    }
    if (error instanceof RequestBodyTimeoutError) {
      return NextResponse.json({ ok: false, error: 'draft request timed out' }, { status: 408 })
    }
    if (error instanceof RequestBodyLengthError || error instanceof RequestBodyParseError) {
      return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
    }
    console.error('[forms] failed to read draft request', error)
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  // persistDraft runs the same Zod validation as the Server Action — if the
  // shape is wrong it returns { ok: false, error }, which we forward as a
  // 400. Tenant scoping + ownership are enforced inside persistDraft.
  const result = await persistDraft(ctx, body as SaveDraftInput)
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 })
  }
  return NextResponse.json(result)
}
