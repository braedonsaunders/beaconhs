import { describe, expect, it } from 'vitest'
import { parseFeedbackTurnRequest } from './feedback-turn-request'

describe('parseFeedbackTurnRequest', () => {
  it('accepts a first report with a null session', () => {
    const parsed = parseFeedbackTurnRequest({
      text: '  Save does nothing  ',
      context: { pathname: '/journals/new', pageTitle: 'New journal' },
      sessionId: null,
    })
    expect(parsed).toEqual({
      ok: true,
      request: {
        text: 'Save does nothing',
        pathname: '/journals/new',
        pageTitle: 'New journal',
        answers: {},
        forceFile: false,
        includePage: true,
        sessionId: null,
      },
    })
  })

  it('rejects an empty report', () => {
    expect(parseFeedbackTurnRequest({ text: '   ' })).toEqual({
      ok: false,
      status: 400,
      reason: 'Invalid report',
    })
  })

  it('rejects a non-uuid session', () => {
    expect(parseFeedbackTurnRequest({ text: 'Broken', sessionId: 'nope' })).toEqual({
      ok: false,
      status: 400,
      reason: 'Bad request',
    })
  })
})
