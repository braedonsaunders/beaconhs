// Record sync endpoint: field edits on an existing record of any module.
//
// Every record page queues its inline edits on the device
// (apps/web/src/lib/offline-drafts) and posts them here, in batches, with
// fetch — or with `navigator.sendBeacon` while the page is being hidden. Each
// edit is a compare-and-set against the value the device last saw, run by
// the module's saver (apps/web/src/lib/record-sync/registry.ts) under the
// module's own permission, visibility, lock, validation, and audit rules.

import { saveRecordEdits } from '@/lib/record-sync/registry'
import { handleSyncRequest } from '@/lib/offline-drafts/sync-route'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return handleSyncRequest(req, saveRecordEdits)
}
