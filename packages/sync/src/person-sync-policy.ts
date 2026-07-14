export type SyncOwnershipMode = 'source_wins' | 'manual_wins'

type PersonSyncDecision = 'unchanged' | 'repair' | 'conflict'
type NaturalPersonAdoptionDecision = 'adopt' | 'conflict'

export type PersonSyncState = {
  ownershipMode: SyncOwnershipMode
  sourceChanged: boolean
  scalarValuesMatch: boolean
  titleValuesMatch: boolean
  titleOwnershipMatches: boolean
  targetChangedAfterLastSync: boolean
}

/**
 * Decide whether a linked person is converged without relying on rowHash
 * alone. The source hash says whether the source changed; the value and
 * provenance checks say whether the canonical target still represents it.
 */
export function decidePersonSync(state: PersonSyncState): PersonSyncDecision {
  const valuesMatch = state.scalarValuesMatch && state.titleValuesMatch
  const converged = valuesMatch && state.titleOwnershipMatches

  if (!state.sourceChanged && converged) return 'unchanged'

  if (
    state.ownershipMode === 'manual_wins' &&
    ((!state.sourceChanged && !valuesMatch) ||
      (state.sourceChanged && state.targetChangedAfterLastSync))
  ) {
    return 'conflict'
  }

  // Missing ownership provenance with matching visible values is safe to
  // claim: the relationship retains its manual-maintenance marker, so a later
  // blank/change from the source cannot delete the pre-existing manual title.
  return 'repair'
}

/**
 * A natural-key match has no source ownership record yet. Source-wins may
 * adopt it, while manual-wins may only claim a row whose visible source-owned
 * values already agree. This prevents the first sync from silently replacing
 * manually maintained identity data.
 */
export function decideNaturalPersonAdoption(
  state: Pick<PersonSyncState, 'ownershipMode' | 'scalarValuesMatch' | 'titleValuesMatch'>,
): NaturalPersonAdoptionDecision {
  if (
    state.ownershipMode === 'manual_wins' &&
    (!state.scalarValuesMatch || !state.titleValuesMatch)
  ) {
    return 'conflict'
  }
  return 'adopt'
}
