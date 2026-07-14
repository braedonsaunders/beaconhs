import { describe, expect, it } from 'vitest'
import { parseResponseDetailListState } from './_detail-list-state'

describe('parseResponseDetailListState', () => {
  it('keeps every embedded list independently addressable', () => {
    const state = parseResponseDetailListState({
      commentQ: 'review note',
      commentPage: '3',
      caQ: 'CA-2026',
      caStatus: 'pending_verification',
      caPage: '4',
      incidentQ: 'forklift',
      incidentStatus: 'under_investigation',
      incidentPage: '5',
      checkinQ: 'supervisor',
      checkinKind: 'escalation_acknowledged',
      checkinPage: '6',
      activityQ: 'locked',
      activityAction: 'update',
      activityPage: '7',
    })

    expect(state.comments).toMatchObject({ q: 'review note', page: 3 })
    expect(state.correctiveActions).toMatchObject({
      q: 'CA-2026',
      status: 'pending_verification',
      page: 4,
    })
    expect(state.incidents).toMatchObject({
      q: 'forklift',
      status: 'under_investigation',
      page: 5,
    })
    expect(state.checkins).toMatchObject({
      q: 'supervisor',
      kind: 'escalation_acknowledged',
      page: 6,
    })
    expect(state.activity).toMatchObject({ q: 'locked', action: 'update', page: 7 })
  })

  it('rejects unknown facets and clamps untrusted pagination', () => {
    const state = parseResponseDetailListState({
      caStatus: 'not-a-status',
      incidentStatus: 'not-a-status',
      checkinKind: 'not-a-kind',
      commentPage: '-50',
      caPerPage: '9999',
      incidentSort: 'not-a-sort',
    })

    expect(state.correctiveActions.status).toBeUndefined()
    expect(state.incidents.status).toBeUndefined()
    expect(state.checkins.kind).toBeUndefined()
    expect(state.comments.page).toBe(1)
    expect(state.correctiveActions.perPage).toBe(100)
    expect(state.incidents.sort).toBe('recent')
  })

  it('normalizes and bounds search terms before they reach SQL', () => {
    const long = `  ${'x'.repeat(250)}  `
    const state = parseResponseDetailListState({
      commentQ: long,
      caQ: '  reference  ',
      activityAction: ` ${'a'.repeat(150)} `,
    })

    expect(state.comments.q).toHaveLength(200)
    expect(state.correctiveActions.q).toBe('reference')
    expect(state.activity.action).toHaveLength(100)
  })
})
