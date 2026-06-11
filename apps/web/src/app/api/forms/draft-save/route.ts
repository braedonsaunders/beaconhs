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
import { persistDraft, type SaveDraftInput } from '@/app/(app)/forms/templates/[id]/fill/actions'

export const dynamic = 'force-dynamic'

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
    body = await req.json()
  } catch {
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
