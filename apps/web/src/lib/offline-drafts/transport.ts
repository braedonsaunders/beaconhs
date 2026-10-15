// Network transport for the sync queue.
//
// Queued work goes to route handlers (not Server Actions): a plain fetch can
// be timed out with AbortController, never queues behind router navigations,
// keeps working from any page in the app, and the same endpoint receives the
// fire-and-forget `sendBeacon` sent when a page is hidden.
// - Builder guided-fill snapshots → /api/apps/draft-save (the server's draft
//   ordering).
// - Field edits on an existing record of any module → /api/records/sync (a
//   per-field compare-and-set run by that module's saver).

import type { DraftSaveRequest } from '@/app/(app)/apps/_lib/draft-persistence'
import type { DraftSaveFailureReason, RecordSyncRequest, RecordSyncSuccess } from './protocol'
import type { DraftSyncResult } from './model'

export type DraftSyncRequest =
  { target: 'form'; body: DraftSaveRequest } | { target: 'record'; body: RecordSyncRequest }

const ENDPOINTS: Record<DraftSyncRequest['target'], string> = {
  form: '/api/apps/draft-save',
  record: '/api/records/sync',
}

export interface DraftTransport {
  save(payload: DraftSyncRequest): Promise<DraftSyncResult>
  /** Best-effort delivery while the page is being hidden or unloaded. */
  beacon(payload: DraftSyncRequest): void
}

const REQUEST_TIMEOUT_MS = 20_000
// Browsers cap queued beacon/keepalive bodies at 64 KiB.
const BEACON_MAX_BYTES = 60 * 1024

const OFFLINE_ERROR = 'No connection. Changes are kept on this device.'
const SERVER_ERROR = 'BeaconHS could not be reached. Retrying automatically.'
const SIGNED_OUT_ERROR = 'Sign in again to sync your changes.'

type FailureBody = {
  ok: false
  error?: unknown
  reason?: DraftSaveFailureReason
  revision?: unknown
}
type SuccessBody =
  | { ok: true; kind?: undefined; savedAt: string; revision: number; sequence: number }
  | RecordSyncSuccess

function message(body: FailureBody | null, fallback: string): string {
  return typeof body?.error === 'string' && body.error.trim() ? body.error : fallback
}

/** Map an HTTP response from either sync route onto a queue outcome. */
export function classifyDraftSaveResponse(
  status: number,
  body: SuccessBody | FailureBody | null,
): DraftSyncResult {
  if (body?.ok === true && status >= 200 && status < 300) {
    if (body.kind === 'fields') {
      return {
        kind: 'fields',
        applied: body.applied,
        conflicts: body.conflicts,
        rejected: body.rejected,
      }
    }
    const savedAt = Date.parse(body.savedAt)
    return {
      kind: 'ok',
      revision: body.revision,
      sequence: body.sequence,
      savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
    }
  }
  const failure = body && body.ok === false ? body : null
  if (status === 401 || failure?.reason === 'unauthorized') {
    return { kind: 'retry', error: SIGNED_OUT_ERROR, offline: false }
  }
  switch (failure?.reason) {
    case 'conflict':
      return {
        kind: 'conflict',
        error: message(failure, SERVER_ERROR),
        revision: typeof failure.revision === 'number' ? failure.revision : null,
      }
    case 'closed':
      return { kind: 'closed', error: message(failure, SERVER_ERROR) }
    case 'unavailable':
      return { kind: 'retry', error: message(failure, SERVER_ERROR), offline: false }
    case undefined:
      break
    default:
      return { kind: 'rejected', error: message(failure, SERVER_ERROR) }
  }
  // Proxies, deploys, and gateway timeouts: transient.
  return { kind: 'retry', error: SERVER_ERROR, offline: false }
}

export function createFetchDraftTransport(): DraftTransport {
  return {
    async save(payload) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(ENDPOINTS[payload.target], {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload.body),
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
      } catch {
        return { kind: 'retry', error: OFFLINE_ERROR, offline: true }
      } finally {
        clearTimeout(timer)
      }
      let body: SuccessBody | FailureBody | null = null
      try {
        body = (await response.json()) as SuccessBody | FailureBody
      } catch {
        body = null
      }
      return classifyDraftSaveResponse(response.status, body)
    },
    beacon(payload) {
      try {
        const json = JSON.stringify(payload.body)
        if (json.length > BEACON_MAX_BYTES || typeof navigator.sendBeacon !== 'function') return
        navigator.sendBeacon(
          ENDPOINTS[payload.target],
          new Blob([json], { type: 'application/json' }),
        )
      } catch {
        // The device copy is already written; the queue delivers it later.
      }
    },
  }
}
