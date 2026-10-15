// Draft sync endpoint for the Builder guided fill page.
//
// The filler's local-first draft queue (apps/web/src/lib/offline-drafts) posts
// every queued whole-draft snapshot here with fetch, and sends the same body
// with `navigator.sendBeacon` when the page is hidden or unloaded. A route
// handler (not a Server Action) is used because a beacon outlives the React
// tree and a fetch can be timed out and retried from any page.
//
// The body carries the server ordering cursor and, for an entry whose id was
// minted on the device, an idempotent `create` block. Validation, tenant
// scoping, ownership, ordering, and DB writes all live in `saveDraftRequest`.
// Field edits on an existing record go to /api/records/sync instead.

import { saveDraftRequest } from '@/app/(app)/apps/_lib/draft-persistence'
import { handleSyncRequest } from '@/lib/offline-drafts/sync-route'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return handleSyncRequest(req, saveDraftRequest)
}
