'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  complianceObligations,
  complianceStatus,
  people,
  trainingAssessmentResults,
  trainingAssessments,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import {
  materializeEvidenceTargetsObligations,
  type ComplianceEvidenceTarget,
} from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { createAssessmentAttempt } from '../_lib/assessment-attempts'
import { addMonthsIso, isoToday } from '../_lib/dates'
import { gradeAnswer, normalizeSubmittedAnswer, type QuestionKind } from '../_lib/grading'

/**
 * Resolve the signed-in user's People record id, or null when no People row is
 * linked to their login (e.g. an admin with no worker profile). Mirrors
 * resolvePersonId() in learn/_actions.ts but returns null instead of throwing,
 * so proctors without a People row fall through to the permission check below.
 */
async function resolveMyPersonId(ctx: RequestContext): Promise<string | null> {
  return ctx.db(async (tx) => {
    const [p] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    return p?.id ?? null
  })
}

/**
 * A proctor/manager may start, answer, submit, or cancel an attempt on behalf of
 * another candidate; ordinary candidates may only act on their own attempt.
 * Either training-staff permission qualifies (recording training or running
 * classes) — the admin roles grant them together.
 */
function canProctorAssessments(ctx: RequestContext): boolean {
  return can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
}

/**
 * Begin a new assessment attempt. Creates the parent row + one
 * `training_assessment_results` shell per question (so the candidate view
 * can render directly off those rows).
 */
export async function startAssessmentAttempt(formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const typeId = String(formData.get('typeId') ?? '').trim()
  const personId = String(formData.get('personId') ?? '').trim()
  const complianceObligationId = String(formData.get('complianceObligationId') ?? '').trim() || null
  if (!typeId || !personId) throw new Error('Type and person are required')
  if (complianceObligationId && !isUuid(complianceObligationId)) {
    throw new Error('The compliance requirement is invalid')
  }

  // Starting an attempt for another person is a proctor/manager action (it can
  // ultimately mint a training record for them). A learner may only start their
  // own; anyone else needs an explicit training-write permission.
  const myPersonId = await resolveMyPersonId(ctx)
  if (personId !== myPersonId && !canProctorAssessments(ctx)) {
    throw new Error('You can only start an assessment attempt for yourself')
  }

  // Shared creation path (also used by lesson quizzes). Standalone attempts
  // must come from the live catalogue: soft-deleted or deactivated types are
  // rejected server-side — the New-attempt page only filters options in the UI.
  const result = await ctx.db(async (tx) => {
    if (complianceObligationId) {
      const [requirement] = await tx
        .select()
        .from(complianceObligations)
        .where(
          and(
            eq(complianceObligations.tenantId, tenantId),
            eq(complianceObligations.id, complianceObligationId),
            eq(complianceObligations.status, 'active'),
            inArray(complianceObligations.sourceModule, ['training', 'cert_requirement']),
            isNull(complianceObligations.deletedAt),
          ),
        )
        .limit(1)
      if (!requirement || requirement.targetRef?.assessmentTypeId !== typeId) {
        throw new Error('That assessment does not match the active compliance requirement')
      }

      const [outstanding] = await tx
        .select({ id: complianceStatus.id })
        .from(complianceStatus)
        .where(
          and(
            eq(complianceStatus.tenantId, tenantId),
            eq(complianceStatus.obligationId, complianceObligationId),
            eq(complianceStatus.personId, personId),
            inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue', 'expiring']),
          ),
        )
        .limit(1)
      if (!outstanding) {
        throw new Error('That person does not have this outstanding compliance requirement')
      }
    }

    const attempt = await createAssessmentAttempt(tx, {
      tenantId,
      typeId,
      personId,
      complianceObligationId,
      requireActive: true,
    })
    if (attempt.created) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_assessment',
        entityId: attempt.attempt.id,
        action: 'create',
        summary: `Started assessment ${attempt.attempt.id}`,
        after: { typeId, personId, complianceObligationId },
      })
    }
    if (complianceObligationId) {
      await materializeEvidenceTargetsObligations(tx, tenantId, [
        { sourceModule: 'training', targetRef: { assessmentTypeId: typeId } },
      ])
    }
    return attempt
  })
  redirect(`/training/assessments/${result.attempt.id}`)
}

/**
 * Submit (or re-grade) an attempt. Reads the user's answers from the form
 * payload — each result row has a field named `answer_<resultId>` — grades
 * each one server-side using the snapshotted correctAnswer, totals the
 * points, computes percentage, flips passed bool against passingScore, and
 * flips status to 'submitted'.
 *
 * If the type is linked to a course AND the attempt passed, a training_records
 * row is created so it lights up the matrix.
 */
export async function submitAssessmentAttempt(attemptId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId
  const myPersonId = await resolveMyPersonId(ctx)

  await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, attemptId))
      .for('update')
      .limit(1)
    if (!attempt) throw new Error('Attempt not found')
    // Ownership: only the candidate (or a proctor/manager) may grade an attempt.
    // A server action is a POST endpoint, so without this any tenant user could
    // finalize someone else's in-progress attempt with arbitrary answers and
    // mint a training record for that other person.
    if (attempt.personId !== myPersonId && !canProctorAssessments(ctx)) {
      throw new Error('That assessment attempt is not yours')
    }
    if (attempt.status !== 'in_progress') throw new Error('Attempt is no longer editable')

    const results = await tx
      .select()
      .from(trainingAssessmentResults)
      .where(eq(trainingAssessmentResults.assessmentId, attemptId))

    let pointsAwarded = 0
    let pointsPossible = 0
    for (const r of results) {
      const kind = r.kindSnapshot as QuestionKind
      const answer = normalizeSubmittedAnswer(
        kind,
        formData.getAll(`answer_${r.id}`).map(String),
        r.optionsSnapshot,
        r.mandatorySnapshot,
      )
      const correct = gradeAnswer(kind, r.correctAnswerSnapshot, answer)
      const awarded = correct === true ? (r.pointsPossible ?? 1) : 0
      // Free-text questions are never auto-graded and have no manual-marking
      // flow — leaving them in the denominator would cap the achievable score
      // below 100% and could make a passing score unreachable. They are
      // recorded but unscored.
      if (r.kindSnapshot !== 'text') {
        pointsAwarded += awarded
        pointsPossible += r.pointsPossible ?? 1
      }
      await tx
        .update(trainingAssessmentResults)
        .set({ answer, correct, pointsAwarded: awarded })
        .where(eq(trainingAssessmentResults.id, r.id))
    }
    const score = pointsPossible > 0 ? Math.round((pointsAwarded / pointsPossible) * 100) : 0
    const passed = score >= attempt.passingScore

    let trainingRecordId: string | null = null
    if (passed && attempt.courseId) {
      // Look up the linked course to compute expiry from validForMonths.
      const [course] = await tx
        .select()
        .from(trainingCourses)
        .where(eq(trainingCourses.id, attempt.courseId))
        .limit(1)
      const completedOn = isoToday()
      const expiresOn = course?.validForMonths
        ? addMonthsIso(completedOn, course.validForMonths)
        : null
      const [rec] = await tx
        .insert(trainingRecords)
        .values({
          tenantId,
          personId: attempt.personId,
          courseId: attempt.courseId,
          source: 'self_paced',
          completedOn,
          expiresOn,
          score,
          grade: score,
          instructor: 'Assessment',
          details: `Auto-recorded from assessment attempt ${attempt.id}`,
          certificateType: 'auto',
        })
        .returning()
      if (!rec) throw new Error('Could not issue the course training record')
      trainingRecordId = rec.id
    }

    await tx
      .update(trainingAssessments)
      .set({
        status: 'submitted',
        score,
        pointsAwarded,
        pointsPossible,
        passed,
        completedAt: new Date(),
        trainingRecordId,
      })
      .where(eq(trainingAssessments.id, attemptId))

    await recordModuleFlowEvent(tx, ctx, {
      subjectId: attemptId,
      moduleKey: 'training',
      event: 'on_submit',
      occurrenceKey: attemptId,
    })

    const targets: ComplianceEvidenceTarget[] = []
    if (attempt.complianceObligationId) {
      targets.push({
        sourceModule: 'training' as const,
        targetRef: { assessmentTypeId: attempt.typeId },
      })
    }
    if (trainingRecordId && attempt.courseId) {
      targets.push({
        sourceModule: 'training' as const,
        targetRef: { courseId: attempt.courseId },
      })
    }
    await materializeEvidenceTargetsObligations(tx, tenantId, targets)

    const submission = { score, passed, pointsAwarded, pointsPossible, trainingRecordId }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment',
      entityId: attemptId,
      action: 'sign',
      summary: `Submitted assessment ${attemptId} (${score}%, ${passed ? 'pass' : 'fail'})`,
      after: submission,
    })
    return submission
  })
  revalidatePath(`/training/assessments/${attemptId}`)
  revalidatePath('/training/assessments')
}

/**
 * Cancel an in-progress attempt, or void a submitted one. Voiding a submitted
 * attempt is training-staff-only, and revokes the training record (plus any
 * issued certificates) it minted — the credential must not outlive the voided
 * evidence.
 */
export async function cancelAssessmentAttempt(attemptId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const myPersonId = await resolveMyPersonId(ctx)

  await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select({
        personId: trainingAssessments.personId,
        status: trainingAssessments.status,
        typeId: trainingAssessments.typeId,
        trainingRecordId: trainingAssessments.trainingRecordId,
        complianceObligationId: trainingAssessments.complianceObligationId,
      })
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, attemptId))
      .for('update')
      .limit(1)
    if (!attempt) throw new Error('Attempt not found')
    if (attempt.personId !== myPersonId && !canProctorAssessments(ctx)) {
      throw new Error('That assessment attempt is not yours')
    }
    if (attempt.status === 'cancelled') {
      return { changed: false, wasSubmitted: false, revokedRecordId: null as string | null }
    }
    const wasSubmitted = attempt.status === 'submitted'
    if (wasSubmitted && !canProctorAssessments(ctx)) {
      throw new Error('Only training staff can void a submitted attempt')
    }
    let revokedRecordId: string | null = null
    let revokedCourseId: string | null = null
    if (wasSubmitted && attempt.trainingRecordId) {
      const [revokedRecord] = await tx
        .update(trainingRecords)
        .set({ deletedAt: new Date(), notes: 'Revoked: assessment attempt voided' })
        .where(
          and(eq(trainingRecords.id, attempt.trainingRecordId), isNull(trainingRecords.deletedAt)),
        )
        .returning({ id: trainingRecords.id, courseId: trainingRecords.courseId })
      await tx
        .update(trainingCertificates)
        .set({ revokedAt: new Date(), revokedReason: 'Assessment attempt voided' })
        .where(
          and(
            eq(trainingCertificates.recordId, attempt.trainingRecordId),
            isNull(trainingCertificates.revokedAt),
          ),
        )
      revokedRecordId = revokedRecord?.id ?? null
      revokedCourseId = revokedRecord?.courseId ?? null
    }
    await tx
      .update(trainingAssessments)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(trainingAssessments.id, attemptId))
    const targets: ComplianceEvidenceTarget[] = []
    if (attempt.complianceObligationId) {
      targets.push({
        sourceModule: 'training' as const,
        targetRef: { assessmentTypeId: attempt.typeId },
      })
    }
    if (revokedRecordId && revokedCourseId) {
      targets.push({
        sourceModule: 'training' as const,
        targetRef: { courseId: revokedCourseId },
      })
    }
    await materializeEvidenceTargetsObligations(tx, ctx.tenantId, targets)

    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment',
      entityId: attemptId,
      action: 'update',
      summary: wasSubmitted
        ? `Voided submitted assessment attempt ${attemptId}`
        : `Cancelled assessment attempt ${attemptId}`,
      metadata: revokedRecordId ? { revokedTrainingRecordId: revokedRecordId } : undefined,
    })
    return { changed: true, wasSubmitted, revokedRecordId }
  })
  revalidatePath(`/training/assessments/${attemptId}`)
  revalidatePath('/training/assessments')
  revalidatePath('/training')
}
