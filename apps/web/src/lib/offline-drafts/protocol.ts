// Wire protocol shared by the browser sync queue and the two sync routes:
// /api/apps/draft-save (Builder guided-fill snapshots) and /api/records/sync
// (field edits on an existing record of any module). Both routes answer a
// failure with the same machine-readable `reason`, which the queue uses to
// decide between retrying, asking the worker, or dropping its copy.

import type { RecordSyncModule } from './record-sync-modules'

/**
 * Why a sync request failed. `unavailable` retries with backoff, `closed`
 * drops the device copy (the record can no longer take edits), `conflict`
 * asks the worker which copy to keep, and every other reason holds the
 * device copy until the worker acts.
 */
export type DraftSaveFailureReason =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'closed'
  | 'locked'
  | 'conflict'
  | 'unavailable'
  | 'unauthorized'
  | 'too_large'

export type SyncFailure = { ok: false; error: string; reason: DraftSaveFailureReason }

/** One queued field edit: the new value and the value the device last saw. */
export type RecordSyncPatch = { fieldId: string; value: unknown; base: unknown }

export type RecordSyncRequest = {
  /**
   * The device scope the edits were queued under (tenant + user + any
   * impersonating admin, see `draftScopeKey`). The server applies them only
   * while the session matches it, so a tenant or account switch can never
   * replay one workspace's edits into another.
   */
  scope: string
  module: RecordSyncModule
  recordId: string
  patches: RecordSyncPatch[]
}

/**
 * Per-field answer. `applied` covers values written now and values the
 * server already held (a retried request); `conflicts` are fields that
 * changed elsewhere since the device's base; `rejected` failed validation.
 */
export type RecordSyncSuccess = {
  ok: true
  kind: 'fields'
  applied: Array<{ fieldId: string; stored: unknown }>
  conflicts: Array<{ fieldId: string; current: unknown }>
  rejected: Array<{ fieldId: string; error: string }>
}

export type RecordSyncResult = RecordSyncSuccess | SyncFailure

/** Upper bound on one request's body (signatures can be large data URLs). */
export const SYNC_MAX_BODY_BYTES = 1024 * 1024
/** Upper bound on patches in one request. */
export const SYNC_MAX_PATCHES = 200
