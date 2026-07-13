import type { FormResponseDraftData } from '@beaconhs/db/schema'

type DraftSaveCursor = {
  sessionId: string
  sequence: number
  baseRevision: number
}

type DraftSaveDecision =
  | { kind: 'apply'; nextRevision: number }
  | { kind: 'superseded'; revision: number; sequence: number }
  | { kind: 'conflict'; revision: number }

function safeCounter(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? (value as number) : 0
}

/**
 * Orders whole-draft writes from normal autosave requests and unload beacons.
 *
 * Requests from one browser session are ordered by their local edit sequence,
 * so a delayed older request can never replace a newer payload. A different
 * tab/session must present the current database revision before it can claim
 * the draft; otherwise it receives a conflict instead of silently overwriting
 * work that was loaded after its own snapshot.
 */
export function decideDraftSave(
  current: FormResponseDraftData | null,
  incoming: DraftSaveCursor,
): DraftSaveDecision {
  const revision = safeCounter(current?.saveRevision)
  const sequence = safeCounter(current?.saveSequence)

  if (current?.saveSessionId === incoming.sessionId) {
    if (incoming.sequence <= sequence) {
      return { kind: 'superseded', revision, sequence }
    }
    return { kind: 'apply', nextRevision: revision + 1 }
  }

  if (incoming.baseRevision !== revision) {
    return { kind: 'conflict', revision }
  }

  return { kind: 'apply', nextRevision: revision + 1 }
}
