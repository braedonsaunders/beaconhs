// The `training-assessments` record saver: a candidate's in-progress answers
// on an assessment attempt, queued on the device by the attempt page and
// applied by /api/records/sync (see lib/record-sync), so a quiz can be
// answered with no signal and submitted once it returns.
//
// Ops: `answer:<resultId>` — the answer to one question, stored on the
// attempt's result row (the column submission grades and the page pre-fills
// from). Storing a draft answer never grades anything: `correct` and points
// are only set when the attempt is submitted. The same people may answer as
// may submit — the candidate, or training staff proctoring the attempt — and
// only while the attempt is in progress and not locked for review. Answers
// are checked against the question with the submission's own rules
// (unanswered stays allowed until submit).

import { and, eq } from 'drizzle-orm'
import { people, trainingAssessmentResults, trainingAssessments } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import {
  defineRecordSaver,
  recordForbidden,
  recordNotFound,
  recordOp,
  RecordSyncError,
} from '@/lib/record-sync/edits'
import {
  draftAnswerWire,
  parseDraftAnswer,
  type DraftAnswerWire,
  type QuestionKind,
} from '../_lib/grading'

type AttemptRow = typeof trainingAssessments.$inferSelect

const ANSWER_PREFIX = 'answer:'

export const trainingAssessmentRecordSaver = defineRecordSaver<AttemptRow>('training-assessments', {
  // Ownership (the candidate, or a proctor) is checked against the attempt.
  authorize: () => true,
  async load(tx, ctx, attemptId) {
    const [attempt] = await tx
      .select()
      .from(trainingAssessments)
      .where(
        and(eq(trainingAssessments.id, attemptId), eq(trainingAssessments.tenantId, ctx.tenantId)),
      )
      .limit(1)
      .for('update')
    if (!attempt) throw recordNotFound()
    const isProctor = can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
    if (!isProctor) {
      const [me] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.userId, ctx.userId))
        .limit(1)
      if (me?.id !== attempt.personId) {
        throw recordForbidden('That assessment attempt is not yours')
      }
    }
    // Submitted, cancelled, and review-locked attempts never take answers again.
    if (attempt.status !== 'in_progress' || attempt.reviewStatus === 'pending') {
      throw new RecordSyncError('closed', 'Attempt is no longer editable')
    }
    return attempt
  },
  async resolve(tx, ctx, attempt, op) {
    if (!op.startsWith(ANSWER_PREFIX)) return null
    const resultId = op.slice(ANSWER_PREFIX.length)
    if (!isUuid(resultId)) return null
    const [result] = await tx
      .select({
        id: trainingAssessmentResults.id,
        answer: trainingAssessmentResults.answer,
        kind: trainingAssessmentResults.kindSnapshot,
        options: trainingAssessmentResults.optionsSnapshot,
      })
      .from(trainingAssessmentResults)
      .where(
        and(
          eq(trainingAssessmentResults.id, resultId),
          eq(trainingAssessmentResults.assessmentId, attempt.id),
          eq(trainingAssessmentResults.tenantId, ctx.tenantId),
        ),
      )
      .limit(1)
      .for('update')
    if (!result) return null
    const kind = result.kind as QuestionKind
    return recordOp<string | null>({
      current: result.answer,
      parse: (wire) => parseDraftAnswer(kind, wire, result.options),
      format: (value): DraftAnswerWire => draftAnswerWire(kind, value),
      write: async (value) => {
        await tx
          .update(trainingAssessmentResults)
          .set({ answer: value })
          .where(
            and(
              eq(trainingAssessmentResults.id, result.id),
              eq(trainingAssessmentResults.tenantId, ctx.tenantId),
            ),
          )
        result.answer = value
      },
    })
  },
  // One entry per synced batch: who recorded which answers (a proctor may
  // answer for the candidate). Grading is audited when the attempt is submitted.
  async afterWrites(tx, ctx, attempt, changes) {
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment',
      entityId: attempt.id,
      action: 'update',
      summary: `Saved answers on assessment ${attempt.id}`,
      metadata: { resultIds: changes.map((change) => change.op.slice(ANSWER_PREFIX.length)) },
    })
  },
  revalidate: (attemptId) => [`/training/assessments/${attemptId}`],
})
