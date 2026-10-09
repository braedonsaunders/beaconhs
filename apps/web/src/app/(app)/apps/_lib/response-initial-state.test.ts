import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { responseInitialState } from './response-initial-state'
import { decideDraftSave } from './draft-save-order'

const schema = { sections: [{ id: 'rescue', repeating: true }] } as FormSchemaV1

describe('reopening a builder response', () => {
  it('retains the cursor so a new session can save a resumed hazard-assessment app', () => {
    const draftData = {
      values: { wah_type: 'FallArrest' },
      rows: { rescue: [{ name: 'Crew' }] },
      saveRevision: 7,
      saveSessionId: 'previous-session',
      saveSequence: 9,
    }
    const state = responseInitialState(schema, {
      status: 'in_progress',
      draftData,
      data: {},
      draftStepIndex: 2,
    })
    expect(state.initialValues.wah_type).toBe('FallArrest')
    expect(state.initialRows.rescue).toEqual([{ name: 'Crew' }])
    expect(state.initialStepIndex).toBe(2)
    expect(
      decideDraftSave(draftData, {
        sessionId: 'new-session',
        sequence: 1,
        baseRevision: state.initialDraftRevision,
      }),
    ).toEqual({ kind: 'apply', nextRevision: 8 })
  })
  it('reads final answers after submission instead of a stale draft', () => {
    const state = responseInitialState(schema, {
      status: 'submitted',
      draftData: { values: { wah_type: 'stale' }, rows: {}, saveRevision: 5 },
      data: { wah_type: 'FallArrest', rescue: [{ name: 'Crew' }] },
      draftStepIndex: 2,
    })
    expect(state.initialValues.wah_type).toBe('FallArrest')
    expect(state.initialRows.rescue).toEqual([{ name: 'Crew' }])
    expect(state.isResumed).toBe(false)
  })
})
