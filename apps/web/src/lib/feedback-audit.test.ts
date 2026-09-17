import { describe, expect, it } from 'vitest'
import { feedbackFiledAuditEvent } from './feedback-audit'

const filed = {
  kind: 'filed' as const,
  issue: {
    id: '5488084589',
    number: 54,
    url: 'https://github.com/example/repo/issues/54',
    title: 'Reporter confirmation never appears',
  },
  stripped: [] as string[],
}

describe('feedbackFiledAuditEvent', () => {
  it('audits the conversation UUID instead of the GitHub numeric id', () => {
    const sessionId = '2f1c0a0e-6d4b-4c8a-9f21-0a1b2c3d4e5f'
    expect(feedbackFiledAuditEvent(filed, sessionId)).toEqual({
      entityType: 'feedback_issue',
      entityId: sessionId,
      action: 'create',
      summary: 'Filed a product issue from the in-app reporter',
      metadata: {
        number: 54,
        url: 'https://github.com/example/repo/issues/54',
        githubId: '5488084589',
        stripped: [],
      },
    })
  })

  it('omits entityId when the session id is not a UUID', () => {
    expect(feedbackFiledAuditEvent(filed, '5488084589').entityId).toBeUndefined()
  })
})
