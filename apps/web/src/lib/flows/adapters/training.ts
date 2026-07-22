import 'server-only'

// Training FlowSubjectAdapter — subject = a training ASSESSMENT (attempt).
// Field-map keys mirror MODULE_FLOW_PROFILES.training.

import { asc, eq } from 'drizzle-orm'
import {
  people,
  trainingAssessmentResults,
  trainingAssessmentTypes,
  trainingAssessments,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDateTime, personName, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'

export function createTrainingFlowAdapter(
  ctx: RequestContext,
  assessmentId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'training',
    subjectId: assessmentId,
    notifyCategory: 'training',
    auditEntityType: 'training_assessment',
    deepLink: () => `/training/assessments/${assessmentId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: assessmentId,
        entityType: 'training_assessment',
        heading: 'Training assessment',
        reference: assessmentId.slice(0, 8),
        subtitle: 'Assessment result',
        values,
      }),

    async loadValues() {
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            a: trainingAssessments,
            assessmentName: trainingAssessmentTypes.name,
            assessmentDescription: trainingAssessmentTypes.description,
            pFirst: people.firstName,
            pLast: people.lastName,
            pFormal: people.formalName,
          })
          .from(trainingAssessments)
          .leftJoin(
            trainingAssessmentTypes,
            eq(trainingAssessmentTypes.id, trainingAssessments.typeId),
          )
          .leftJoin(people, eq(people.id, trainingAssessments.personId))
          .where(eq(trainingAssessments.id, assessmentId))
          .limit(1),
      )
      if (!head) return {}
      const a = head.a

      const questions = await ctx.db((tx) =>
        tx
          .select({
            prompt: trainingAssessmentResults.promptSnapshot,
            answer: trainingAssessmentResults.answer,
            correctAnswer: trainingAssessmentResults.correctAnswerSnapshot,
            correct: trainingAssessmentResults.correct,
            pointsAwarded: trainingAssessmentResults.pointsAwarded,
            pointsPossible: trainingAssessmentResults.pointsPossible,
            reviewNotes: trainingAssessmentResults.reviewNotes,
          })
          .from(trainingAssessmentResults)
          .where(eq(trainingAssessmentResults.assessmentId, assessmentId))
          .orderBy(asc(trainingAssessmentResults.createdAt)),
      )

      return {
        status: a.status ?? null,
        status_label:
          a.status === 'in_progress' && a.reviewStatus === 'pending'
            ? 'Awaiting review'
            : !a.graded && a.status === 'submitted'
              ? 'Completed'
              : titleize(a.status),
        score: a.score ?? null,
        score_percent: a.score != null ? `${a.score}%` : '',
        passing_score: a.graded && a.passingScore != null ? `${a.passingScore}%` : '',
        passed: a.passed ?? null,
        pass_fail: !a.graded
          ? a.status === 'submitted'
            ? 'Completed'
            : 'Not completed'
          : a.passed === true
            ? 'Pass'
            : a.passed === false
              ? 'Fail'
              : 'Not graded',
        assessment_name: head.assessmentName ?? '',
        assessment_description: head.assessmentDescription ?? '',
        person_name: personName({
          firstName: head.pFirst,
          lastName: head.pLast,
          formalName: head.pFormal,
        }),
        completed_at: fmtDateTime(a.completedAt),
        // FK ids for conditions / recipient `field` targets.
        type_id: a.typeId ?? null,
        person_id: a.personId ?? null,
        // Collections.
        questions: questions.map((q) => ({
          prompt: q.prompt ?? '',
          answer: q.answer ?? '',
          correct_answer: q.correctAnswer ?? '',
          result: !a.graded
            ? 'Recorded'
            : q.correct === true
              ? 'Correct'
              : q.correct === false
                ? 'Incorrect'
                : 'Awaiting review',
          points: a.graded ? `${q.pointsAwarded}/${q.pointsPossible}` : '',
          review_notes: q.reviewNotes ?? '',
        })),
      }
    },

    async resolveSubmitter() {
      const [a] = await ctx.db((tx) =>
        tx
          .select({ tuid: trainingAssessments.submittedByTenantUserId })
          .from(trainingAssessments)
          .where(eq(trainingAssessments.id, assessmentId))
          .limit(1),
      )
      const tuid = a?.tuid ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },
  }
}
