import type { RecordSyncModule } from './record-sync-modules'

// Pure model for local-first drafts and record edits.
//
// Unsynced work lives in three places: React state (what the worker sees),
// the device store (IndexedDB — survives the tab being frozen or discarded),
// and the server. This module holds the rules that connect them. Two kinds of
// queued work share one store, engine, and UI:
//
// - `snapshot` — the Builder guided fill page saves the whole draft into
//   `form_responses.draft_data` (target `form`). It reuses the server's
//   existing ordering (`decideDraftSave` in apps/_lib/draft-save-order.ts): a
//   browser editing session has a `sessionId` and a monotonic `sequence`, and
//   a different session must present the current `revision` before it can
//   write. The device copy persists that same cursor so it survives a reload.
// - `fields` — a record page (a Builder record or any native module record,
//   target `record`) saves one field or operation at a time through the
//   record sync route. Pending edits are coalesced per field. Each patch
//   carries the value the field had on the server when the edit started
//   (`base`); the server applies it only if the field still has that value,
//   so an edit made offline can never silently overwrite a newer change made
//   elsewhere.

export type DraftSnapshot = {
  values: Record<string, unknown>
  rows: Record<string, Array<Record<string, unknown>>>
  stepIndex: number
}

/** The server's ordering cursor, read from `form_responses.draft_data`. */
export type DraftServerCursor = {
  revision: number
  sessionId: string | null
  sequence: number
}

/** This device's ordering cursor for one whole-draft (snapshot) draft. */
export type DraftClientCursor = {
  sessionId: string
  /** Last local snapshot number. Each device write takes the next number. */
  sequence: number
  /** Highest sequence the server has acknowledged for this session. */
  ackedSequence: number
  /** Server revision this session last saw (sent as `baseRevision`). */
  baseRevision: number
  /** False until the server row exists (new entries get a client-made id). */
  serverCreated: boolean
}

export type SnapshotWork = {
  kind: 'snapshot'
  cursor: DraftClientCursor
  /** Latest unsynced snapshot; null when the server has everything. */
  snapshot: DraftSnapshot | null
  /** Server revision reported by a conflict, used when keeping this copy. */
  conflictRevision: number | null
}

type FieldPatch = {
  value: unknown
  /** The field's server value when this device started editing it. */
  base: unknown
  /** Edit number, so an ack for an older value never drops a newer one. */
  sequence: number
  /** Set when the server holds a different value than `base`. */
  conflict: { current: unknown } | null
  /** Why the server refused this value (validation). Cleared by the next edit. */
  rejected: string | null
  /**
   * Values already sent for this patch whose answer never arrived (a dropped
   * response, a page-hide beacon). If the server reports one of them as the
   * current value, that is this device's own save landing — not a conflict.
   */
  sent: unknown[]
}

export type FieldsWork = {
  kind: 'fields'
  sequence: number
  patches: Record<string, FieldPatch>
  /** Last value the server confirmed per field — the base of the next edit. */
  known: Record<string, unknown>
}

/**
 * Answers to a one-shot form whose record does not exist until it is
 * submitted (e.g. a PPE inspection). Kept on the device only — never synced —
 * so a dead zone or a discarded tab cannot lose them; the submit itself needs
 * a connection.
 */
export type LocalWork = {
  kind: 'local'
  sequence: number
  values: Record<string, unknown> | null
}

export type DraftWork = SnapshotWork | FieldsWork | LocalWork

export type DraftScope = {
  tenantId: string
  userId: string
  /** The real admin while impersonating, so their device copy stays separate. */
  actorUserId: string | null
}

type DraftMetaBase = {
  key: string
  scope: string
  tenantId: string
  userId: string
}

/** A Builder guided-fill draft (whole-draft snapshots). */
export type FormDraftMeta = DraftMetaBase & {
  target: 'form'
  templateId: string
  responseId: string
  complianceObligationId: string | null
  /** `new` drafts started on a blank fill page; `resume` drafts were opened by id. */
  origin: 'new' | 'resume'
}

/** Field edits on one existing record of a module (see record-sync-modules.ts). */
export type RecordEditsMeta = DraftMetaBase & {
  target: 'record'
  module: RecordSyncModule
  recordId: string
}

/** A one-shot form's device copy (see `LocalWork`). */
type LocalFormMeta = DraftMetaBase & {
  target: 'local'
  /** Which form, e.g. `ppe-inspection`. */
  form: string
  /** Which instance of it, e.g. the item and inspection kind. */
  localId: string
}

export type DraftMeta = FormDraftMeta | RecordEditsMeta | LocalFormMeta

export type DraftBlock = 'conflict' | 'rejected'

/** The record stored on the device while a draft has unsynced changes. */
export type OfflineDraftRecord = DraftMeta & {
  work: DraftWork
  updatedAt: number
  attempts: number
  nextAttemptAt: number
  lastError: string | null
  blocked: DraftBlock | null
}

/** A stored Builder guided-fill draft. */
export type FormDraftRecord = OfflineDraftRecord & FormDraftMeta & { work: SnapshotWork }

export function draftScopeKey(scope: DraftScope): string {
  const base = `${scope.tenantId}:${scope.userId}`
  return scope.actorUserId ? `${base}:as:${scope.actorUserId}` : base
}

/** Device key for a Builder guided-fill draft. */
export function formDraftKey(scopeKey: string, responseId: string): string {
  return `${scopeKey}|snapshot|${responseId}`
}

/** Device key for a one-shot form's answers. */
export function localFormKey(scopeKey: string, form: string, localId: string): string {
  return `${scopeKey}|local|${form}|${localId}`
}

/** Device key for one record's queued field edits (fields are keyed inside it). */
export function recordEditsKey(
  scopeKey: string,
  module: RecordSyncModule,
  recordId: string,
): string {
  return `${scopeKey}|record|${module}|${recordId}`
}

// --- Shared ---------------------------------------------------------------

/**
 * Unsynced changes: snapshots for a whole draft, fields for record edits, one
 * unsubmitted form for a local form.
 */
export function pendingCount(work: DraftWork): number {
  if (work.kind === 'snapshot') {
    return work.snapshot ? Math.max(0, work.cursor.sequence - work.cursor.ackedSequence) : 0
  }
  if (work.kind === 'local') return work.values ? 1 : 0
  return Object.keys(work.patches).length
}

/** Monotonic edit number; a stored copy at or below it holds nothing newer. */
export function workVersion(work: DraftWork): number {
  return work.kind === 'snapshot' ? work.cursor.sequence : work.sequence
}

const SYNC_RETRY_BASE_MS = 2_000
export const SYNC_RETRY_MAX_MS = 5 * 60_000

/** Exponential backoff with ±20% jitter, capped at five minutes. */
export function syncRetryDelayMs(attempts: number, random: number): number {
  const exponent = Math.max(0, Math.min(attempts, 20) - 1)
  const base = Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** exponent)
  const jitter = 0.8 + 0.4 * Math.min(1, Math.max(0, random))
  return Math.round(Math.min(SYNC_RETRY_MAX_MS, base * jitter))
}

/** The server's per-field answer to a batch of record edits. */
export type FieldResults = {
  applied: Array<{ fieldId: string; stored: unknown }>
  conflicts: Array<{ fieldId: string; current: unknown }>
  rejected: Array<{ fieldId: string; error: string }>
}

/** Result of one sync attempt, already classified by the transport. */
export type DraftSyncResult =
  | { kind: 'ok'; revision: number; sequence: number; savedAt: number }
  | ({ kind: 'fields' } & FieldResults)
  | { kind: 'retry'; error: string; offline: boolean }
  | { kind: 'conflict'; error: string; revision: number | null }
  | { kind: 'closed'; error: string }
  | { kind: 'rejected'; error: string }

/** Whether a stored record should be attempted now by the background queue. */
export function isSyncDue(record: OfflineDraftRecord, now: number): boolean {
  return (
    record.work.kind !== 'local' &&
    record.blocked === null &&
    pendingCount(record.work) > 0 &&
    record.nextAttemptAt <= now
  )
}

/**
 * Structural JSON equality (object key order ignored; `null` and a missing
 * value are the same "empty" answer). Matches how jsonb stores answers.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) if (!jsonEqual(left[key], right[key])) return false
    return true
  }
  return false
}

// --- Whole-draft snapshots --------------------------------------------------

function hasPendingChanges(cursor: DraftClientCursor): boolean {
  return cursor.sequence > cursor.ackedSequence
}

export type DraftReconciliation =
  /** The device copy is newer than the server draft: load it. */
  | { kind: 'restore' }
  /** Another tab/device saved after this device's copy was based: ask. */
  | { kind: 'conflict'; serverRevision: number }
  /** The server already holds everything this device has: drop the copy. */
  | { kind: 'discard' }

/**
 * Decide what to do with a device snapshot when the form loads.
 *
 * Mirrors `decideDraftSave` on the server so the answer matches what the
 * server would do with the queued save:
 * - same session as the server's last write → newer only if its sequence is
 *   higher (a beacon may already have delivered it);
 * - different session → it can only apply on top of the revision it was
 *   based on; if the server moved on, it is a conflict.
 * A draft the server has never seen (`server === null`) is always restored.
 */
export function reconcileDeviceDraft(
  cursor: DraftClientCursor,
  server: DraftServerCursor | null,
): DraftReconciliation {
  if (!hasPendingChanges(cursor)) return { kind: 'discard' }
  if (!server) return { kind: 'restore' }
  if (server.sessionId !== null && server.sessionId === cursor.sessionId) {
    return server.sequence >= cursor.sequence ? { kind: 'discard' } : { kind: 'restore' }
  }
  if (server.revision === cursor.baseRevision) return { kind: 'restore' }
  return { kind: 'conflict', serverRevision: server.revision }
}

/** Apply a server acknowledgement to the device cursor. */
export function acknowledge(
  cursor: DraftClientCursor,
  ack: { revision: number; sequence: number },
): DraftClientCursor {
  return {
    ...cursor,
    serverCreated: true,
    ackedSequence: Math.max(cursor.ackedSequence, Math.min(ack.sequence, cursor.sequence)),
    baseRevision: Math.max(cursor.baseRevision, ack.revision),
  }
}

// --- Record-page field patches ---------------------------------------------

export function emptyFieldsWork(): FieldsWork {
  return { kind: 'fields', sequence: 0, patches: {}, known: {} }
}

/**
 * Queue one field edit. A field that already has a pending edit keeps its
 * original base (the server value the device last saw), so repeated edits
 * coalesce into a single patch.
 */
export function recordFieldEdit(
  work: FieldsWork,
  fieldId: string,
  value: unknown,
  serverValue: unknown,
): FieldsWork {
  const sequence = work.sequence + 1
  const existing = work.patches[fieldId]
  const base = existing ? existing.base : fieldId in work.known ? work.known[fieldId] : serverValue
  return {
    ...work,
    sequence,
    patches: {
      ...work.patches,
      [fieldId]: {
        value,
        base,
        sequence,
        conflict: existing?.conflict ?? null,
        rejected: null,
        sent: existing?.sent ?? [],
      },
    },
  }
}

/** Largest batch sent in one request; the rest follow in the next round. */
const MAX_PATCHES_PER_REQUEST = 100
/** Body budget for one batch, well under the route's 1 MiB limit. */
const MAX_BATCH_BYTES = 600 * 1024
/** A single value larger than this can never be accepted by the route. */
export const MAX_PATCH_BYTES = 900 * 1024
const MAX_SENT_VALUES = 5

function patchBytes(fieldId: string, patch: { value: unknown; base: unknown }): number {
  return JSON.stringify({ fieldId, value: patch.value, base: patch.base }).length
}

/**
 * Patches to send now, oldest edit first. Conflicted ones wait for the
 * worker's choice; rejected ones wait for a new value (or an explicit retry).
 */
export function sendableFieldPatches(
  work: FieldsWork,
  limit = MAX_PATCHES_PER_REQUEST,
): Array<{ fieldId: string; value: unknown; base: unknown; sequence: number }> {
  const ordered = Object.entries(work.patches)
    .filter(([, patch]) => patch.conflict === null && patch.rejected === null)
    .sort(([, a], [, b]) => a.sequence - b.sequence)
  const batch: Array<{ fieldId: string; value: unknown; base: unknown; sequence: number }> = []
  let bytes = 0
  for (const [fieldId, patch] of ordered) {
    if (batch.length >= limit) break
    const size = patchBytes(fieldId, patch)
    // Large values (signatures, long narratives) split across requests; the
    // first patch always goes so a batch is never empty.
    if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) break
    bytes += size
    batch.push({ fieldId, value: patch.value, base: patch.base, sequence: patch.sequence })
  }
  return batch
}

/** Remember the values a request is carrying (see `FieldPatch.sent`). */
export function markPatchesSent(
  work: FieldsWork,
  sent: Array<{ fieldId: string; value: unknown }>,
): FieldsWork {
  const patches = { ...work.patches }
  for (const { fieldId, value } of sent) {
    const patch = patches[fieldId]
    if (!patch || patch.sent.some((earlier) => jsonEqual(earlier, value))) continue
    patches[fieldId] = { ...patch, sent: [...patch.sent, value].slice(-MAX_SENT_VALUES) }
  }
  return { ...work, patches }
}

/** Refuse, on the device, values too large for the route to ever accept. */
export function rejectOversizedPatches(work: FieldsWork, error: string): FieldsWork {
  let changed = false
  const patches = { ...work.patches }
  for (const [fieldId, patch] of Object.entries(patches)) {
    if (patch.rejected === null && patchBytes(fieldId, patch) > MAX_PATCH_BYTES) {
      patches[fieldId] = { ...patch, rejected: error }
      changed = true
    }
  }
  return changed ? { ...work, patches } : work
}

/**
 * Apply the server's per-field answer. An applied field is cleared only if it
 * was not edited again after the request left; otherwise the newer edit is
 * rebased onto the stored value. A conflicted field keeps the device value and
 * records what the server holds.
 */
export function applyFieldResults(
  work: FieldsWork,
  sent: Record<string, number>,
  result: FieldResults,
): FieldsWork {
  const patches = { ...work.patches }
  const known = { ...work.known }
  for (const { fieldId, stored } of result.applied) {
    known[fieldId] = stored
    const patch = patches[fieldId]
    if (!patch) continue
    if (patch.sequence <= (sent[fieldId] ?? -1)) delete patches[fieldId]
    else patches[fieldId] = { ...patch, base: stored }
  }
  for (const { fieldId, current } of result.conflicts) {
    const patch = patches[fieldId]
    if (!patch) continue
    // The server holds a value this device sent earlier (its answer was
    // lost): rebase onto it and send the newer value — not a conflict.
    patches[fieldId] = patch.sent.some((earlier) => jsonEqual(earlier, current))
      ? { ...patch, base: current, conflict: null }
      : { ...patch, conflict: { current } }
  }
  for (const { fieldId, error } of result.rejected) {
    const patch = patches[fieldId]
    // A value edited after the request left gets its own chance.
    if (patch && patch.sequence <= (sent[fieldId] ?? -1)) {
      patches[fieldId] = { ...patch, rejected: error }
    }
  }
  return { ...work, patches, known }
}

export function hasFieldConflicts(work: FieldsWork): boolean {
  return Object.values(work.patches).some((patch) => patch.conflict !== null)
}

/** The first refusal reason among pending patches, if any. */
export function firstRejection(work: FieldsWork): string | null {
  for (const patch of Object.values(work.patches)) if (patch.rejected) return patch.rejected
  return null
}

/** Send rejected values again (the worker pressed Retry). */
export function clearRejections(work: FieldsWork): FieldsWork {
  const patches: Record<string, FieldPatch> = {}
  for (const [fieldId, patch] of Object.entries(work.patches)) {
    patches[fieldId] = patch.rejected ? { ...patch, rejected: null } : patch
  }
  return { ...work, patches }
}

/** Where one field stands in the queue (drives the field's own save dot). */
export type FieldQueueStatus =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'conflict' }
  | { kind: 'rejected'; error: string }

export function fieldQueueStatus(work: FieldsWork | null, fieldId: string): FieldQueueStatus {
  const patch = work?.patches[fieldId]
  if (!patch) return { kind: 'none' }
  if (patch.conflict) return { kind: 'conflict' }
  if (patch.rejected) return { kind: 'rejected', error: patch.rejected }
  return { kind: 'pending' }
}

/** Keep this device's values: rebase conflicted patches onto the server value. */
export function rebaseFieldConflicts(work: FieldsWork): FieldsWork {
  const patches: Record<string, FieldPatch> = {}
  for (const [fieldId, patch] of Object.entries(work.patches)) {
    patches[fieldId] = patch.conflict
      ? { ...patch, base: patch.conflict.current, conflict: null }
      : patch
  }
  return { ...work, patches }
}

/**
 * Reconcile one field's device edit with the value the page now shows (a
 * field that appeared after the record was claimed). Same rule as
 * `reconcileFieldPatches`; `known` is left alone.
 */
export function reconcileFieldPatch(
  work: FieldsWork,
  fieldId: string,
  server: unknown,
): { work: FieldsWork; outcome: 'none' | 'dropped' | 'restored' | 'conflicted'; value?: unknown } {
  const patch = work.patches[fieldId]
  if (!patch) return { work, outcome: 'none' }
  // A conflict reported earlier (perhaps before a reload) waits for the
  // worker's choice; show it again when its field appears.
  if (patch.conflict) return { work, outcome: 'conflicted', value: patch.value }
  if (jsonEqual(server, patch.value)) {
    return { work: dropFieldPatches(work, [fieldId]), outcome: 'dropped' }
  }
  if (jsonEqual(server, patch.base) || patch.sent.some((earlier) => jsonEqual(earlier, server))) {
    return {
      work: { ...work, patches: { ...work.patches, [fieldId]: { ...patch, base: server } } },
      outcome: 'restored',
      value: patch.value,
    }
  }
  return {
    work: {
      ...work,
      patches: { ...work.patches, [fieldId]: { ...patch, conflict: { current: server } } },
    },
    outcome: 'conflicted',
    value: patch.value,
  }
}

/**
 * The page showed a newer server value for a field with no pending edit
 * (after a refresh): later edits are based on it.
 */
export function noteKnownValue(work: FieldsWork, fieldId: string, value: unknown): FieldsWork {
  if (work.patches[fieldId] || jsonEqual(work.known[fieldId], value)) return work
  return { ...work, known: { ...work.known, [fieldId]: value } }
}

/** Drop patches (all conflicted ones, or the listed fields). */
export function dropFieldPatches(work: FieldsWork, fieldIds: 'conflicts' | string[]): FieldsWork {
  const patches: Record<string, FieldPatch> = {}
  for (const [fieldId, patch] of Object.entries(work.patches)) {
    const drop = fieldIds === 'conflicts' ? patch.conflict !== null : fieldIds.includes(fieldId)
    if (!drop) patches[fieldId] = patch
  }
  return { ...work, patches }
}

/**
 * Reconcile device field edits with the values the record page loaded,
 * using the same rule the server applies: a patch is newer only while the
 * server still holds its base. One the server already holds is dropped;
 * one whose field changed elsewhere becomes a conflict.
 *
 * `serverValue` returns null for a field the page has not shown (yet): its
 * patch is left as it is, and the server's compare-and-set decides.
 */
export function reconcileFieldPatches(
  work: FieldsWork,
  serverValue: (fieldId: string) => { value: unknown } | null,
): { work: FieldsWork; restored: Record<string, unknown>; conflicted: Record<string, unknown> } {
  const patches: Record<string, FieldPatch> = {}
  const restored: Record<string, unknown> = {}
  const conflicted: Record<string, unknown> = {}
  for (const [fieldId, patch] of Object.entries(work.patches)) {
    const loaded = serverValue(fieldId)
    if (!loaded) {
      patches[fieldId] = patch
      continue
    }
    const server = loaded.value
    if (jsonEqual(server, patch.value)) continue
    if (jsonEqual(server, patch.base) || patch.sent.some((earlier) => jsonEqual(earlier, server))) {
      patches[fieldId] = { ...patch, base: server, conflict: null }
      restored[fieldId] = patch.value
    } else {
      patches[fieldId] = { ...patch, conflict: { current: server } }
      conflicted[fieldId] = patch.value
    }
  }
  return { work: { ...work, patches, known: {} }, restored, conflicted }
}
