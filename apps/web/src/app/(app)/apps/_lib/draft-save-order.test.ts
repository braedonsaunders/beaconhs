import { describe, expect, it } from 'vitest'
import { decideDraftSave } from './draft-save-order'

const draft = {
  values: {},
  rows: {},
  saveSessionId: 'session-a',
  saveSequence: 4,
  saveRevision: 7,
}

describe('decideDraftSave', () => {
  it('accepts the next write from the active editing session', () => {
    expect(
      decideDraftSave(draft, { sessionId: 'session-a', sequence: 5, baseRevision: 1 }),
    ).toEqual({ kind: 'apply', nextRevision: 8 })
  })

  it('treats a delayed same-session request as already superseded', () => {
    expect(
      decideDraftSave(draft, { sessionId: 'session-a', sequence: 3, baseRevision: 7 }),
    ).toEqual({ kind: 'superseded', revision: 7, sequence: 4 })
  })

  it('allows a new tab to claim an unchanged snapshot', () => {
    expect(
      decideDraftSave(draft, { sessionId: 'session-b', sequence: 1, baseRevision: 7 }),
    ).toEqual({ kind: 'apply', nextRevision: 8 })
  })

  it('rejects a new tab whose snapshot is stale', () => {
    expect(
      decideDraftSave(draft, { sessionId: 'session-b', sequence: 1, baseRevision: 6 }),
    ).toEqual({ kind: 'conflict', revision: 7 })
  })

  it('adopts legacy drafts at revision zero', () => {
    expect(
      decideDraftSave(
        { values: { note: 'legacy' }, rows: {} },
        { sessionId: 'session-a', sequence: 1, baseRevision: 0 },
      ),
    ).toEqual({ kind: 'apply', nextRevision: 1 })
  })

  it('orders a newer unload beacon ahead of an older in-flight request', () => {
    const beacon = decideDraftSave(draft, {
      sessionId: 'session-a',
      sequence: 6,
      baseRevision: 7,
    })
    expect(beacon).toEqual({ kind: 'apply', nextRevision: 8 })

    const afterBeacon = { ...draft, saveSequence: 6, saveRevision: 8 }
    expect(
      decideDraftSave(afterBeacon, {
        sessionId: 'session-a',
        sequence: 5,
        baseRevision: 7,
      }),
    ).toEqual({ kind: 'superseded', revision: 8, sequence: 6 })
  })
})
