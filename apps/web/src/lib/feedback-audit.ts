import type { FeedbackTurnResult } from '@braedonsaunders/appkit-feedback'
import { isUuid } from './list-params'

/** Audit payload for a filed GitHub issue. `audit_log.entity_id` is a UUID. */
export function feedbackFiledAuditEvent(
  result: Extract<FeedbackTurnResult, { kind: 'filed' }>,
  sessionId: string,
) {
  return {
    entityType: 'feedback_issue',
    entityId: isUuid(sessionId) ? sessionId : undefined,
    action: 'create' as const,
    summary: 'Filed a product issue from the in-app reporter',
    metadata: {
      number: result.issue.number,
      url: result.issue.url,
      githubId: result.issue.id,
      stripped: result.stripped,
    },
  }
}
