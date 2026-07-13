import type { SyncEntityKey } from './types'

interface SnapshotArchivePlan {
  eligible: SyncEntityKey[]
  blockedEmpty: SyncEntityKey[]
  blockedByFailures: boolean
  missingAuthority: boolean
}

/**
 * Decide which entity snapshots are safe to use for missing-record archival.
 * A failed run or a zero-record entity is never authoritative enough to drive
 * destructive changes.
 */
export function planSnapshotArchives(
  authoritativeEntities: readonly SyncEntityKey[],
  seenCounts: Readonly<Partial<Record<SyncEntityKey, number>>>,
  processingFailures: number,
): SnapshotArchivePlan {
  const entities = [...new Set(authoritativeEntities)]
  if (processingFailures > 0) {
    return {
      eligible: [],
      blockedEmpty: [],
      blockedByFailures: true,
      missingAuthority: entities.length === 0,
    }
  }

  const eligible: SyncEntityKey[] = []
  const blockedEmpty: SyncEntityKey[] = []
  for (const entity of entities) {
    if ((seenCounts[entity] ?? 0) > 0) eligible.push(entity)
    else blockedEmpty.push(entity)
  }
  return {
    eligible,
    blockedEmpty,
    blockedByFailures: false,
    missingAuthority: entities.length === 0,
  }
}
