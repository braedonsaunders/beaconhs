// Canonical merge of a response's persisted `data` with its in-flight
// `draftData`. A populated draft is by construction NEWER than `data`: every
// writer of `data` clears `draftData` (submit, finalize, per-field autosave),
// so draft values can only be edits made AFTER `data` was last written. Draft
// values therefore win per key. Shared by the record page, lifecycle actions,
// per-field autosave, and the CSV export so the merge semantics cannot diverge.

import type { FormResponseDraftData } from '@beaconhs/db/schema'

export function responsePayload(
  data: Record<string, unknown> | null,
  draftData: FormResponseDraftData | null,
): Record<string, unknown> {
  if (!draftData) return data ?? {}
  return {
    ...(data ?? {}),
    ...(draftData.values ?? {}),
    ...(draftData.rows ?? {}),
  }
}
