import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideNaturalPersonAdoption,
  decidePersonSync,
  type PersonSyncState,
} from './person-sync-policy'

const converged: PersonSyncState = {
  ownershipMode: 'source_wins',
  sourceChanged: false,
  scalarValuesMatch: true,
  titleValuesMatch: true,
  titleOwnershipMatches: true,
  targetChangedAfterLastSync: false,
}

describe('people sync convergence policy', () => {
  it('does not treat an unchanged source hash as proof the target is unchanged', () => {
    assert.equal(decidePersonSync({ ...converged, scalarValuesMatch: false }), 'repair')
    assert.equal(
      decidePersonSync({
        ...converged,
        ownershipMode: 'manual_wins',
        titleValuesMatch: false,
      }),
      'conflict',
    )
  })

  it('protects differing manual rows during first natural-key adoption', () => {
    assert.equal(
      decideNaturalPersonAdoption({
        ownershipMode: 'manual_wins',
        scalarValuesMatch: false,
        titleValuesMatch: true,
      }),
      'conflict',
    )
    assert.equal(
      decideNaturalPersonAdoption({
        ownershipMode: 'manual_wins',
        scalarValuesMatch: true,
        titleValuesMatch: false,
      }),
      'conflict',
    )
    assert.equal(
      decideNaturalPersonAdoption({
        ownershipMode: 'manual_wins',
        scalarValuesMatch: true,
        titleValuesMatch: true,
      }),
      'adopt',
    )
    assert.equal(
      decideNaturalPersonAdoption({
        ownershipMode: 'source_wins',
        scalarValuesMatch: false,
        titleValuesMatch: false,
      }),
      'adopt',
    )
  })

  it('repairs provenance without conflicting when the visible manual title matches', () => {
    assert.equal(decidePersonSync({ ...converged, titleOwnershipMatches: false }), 'repair')
    assert.equal(
      decidePersonSync({
        ...converged,
        ownershipMode: 'manual_wins',
        titleOwnershipMatches: false,
      }),
      'repair',
    )
  })

  it('conflicts only when manual-wins target edits overlap a changed source', () => {
    assert.equal(
      decidePersonSync({
        ...converged,
        ownershipMode: 'manual_wins',
        sourceChanged: true,
        targetChangedAfterLastSync: true,
      }),
      'conflict',
    )
    assert.equal(
      decidePersonSync({
        ...converged,
        ownershipMode: 'manual_wins',
        sourceChanged: true,
      }),
      'repair',
    )
  })
})
