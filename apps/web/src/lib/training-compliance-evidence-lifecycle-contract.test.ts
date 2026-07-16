import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start)
  const endIndex = value.indexOf(end, startIndex + start.length)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  expect(endIndex).toBeGreaterThan(startIndex)
  return value.slice(startIndex, endIndex)
}

const recordActions = source('../app/(app)/training/records/_actions.ts')
const skillActions = source('../app/(app)/training/skills/_actions.ts')
const classActions = source('../app/(app)/training/classes/_actions.ts')
const learnActions = source('../app/(app)/training/learn/_actions.ts')
const completion = source('../app/(app)/training/learn/_lib/completion.ts')
const assessmentActions = source('../app/(app)/training/_actions/assessments.ts')
const practicalActions = source('../app/(app)/training/courses/[id]/evaluations/_actions.ts')
const onlineCompletionActions = source('../app/(app)/training/courses/[id]/completions/_actions.ts')
const apiWrites = source('./api/write.ts')

describe('training compliance evidence lifecycle', () => {
  it('refreshes course evidence atomically for every training-record mutation', () => {
    const update = between(
      recordActions,
      'export async function updateTrainingRecordField',
      'export async function renewTrainingRecord',
    )
    const renew = between(
      recordActions,
      'export async function renewTrainingRecord',
      'export async function revokeTrainingRecord',
    )
    const revoke = between(
      recordActions,
      'export async function revokeTrainingRecord',
      'type BulkActionResult',
    )
    const bulkRenew = between(
      recordActions,
      'export async function bulkRenewTrainingRecords',
      'export async function bulkRevokeTrainingRecords',
    )
    const bulkRevoke = between(
      recordActions,
      'export async function bulkRevokeTrainingRecords',
      'export async function bulkExportTrainingRecordsCsv',
    )

    expect(recordActions).toContain('materializeEvidenceTargetsObligations(')
    expect(recordActions).toContain("sourceModule: 'training' as const")
    expect(update).toContain('record.courseId')
    expect(update).toContain("update.field === 'courseId' ? update.value : record.courseId")
    for (const mutation of [update, renew, revoke, bulkRenew, bulkRevoke]) {
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).toContain('await materializeCourseEvidence(')
    }
  })

  it('refreshes old and new skill types for grant, retarget, renewal, and revocation', () => {
    const update = between(
      skillActions,
      'export async function updateSkillAssignmentField',
      'export async function renewSkillAssignment',
    )
    const renew = between(
      skillActions,
      'export async function renewSkillAssignment',
      'export async function revokeSkillAssignment',
    )
    const revoke = between(
      skillActions,
      'export async function revokeSkillAssignment',
      '// ---------------------------------------------------------------------------\n// Files',
    )

    expect(skillActions).toContain("sourceModule: 'cert_requirement' as const")
    expect(skillActions).toContain('targetRef: { skillTypeId }')
    expect(update).toContain('assignment.skillTypeId')
    expect(update).toContain(
      "update.field === 'skillTypeId' ? update.value : assignment.skillTypeId",
    )
    for (const mutation of [update, renew, revoke]) {
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).toContain('await materializeSkillEvidence(')
    }
  })

  it('refreshes course obligations in the same transaction as class issuance', () => {
    const markComplete = between(
      classActions,
      'export async function markClassComplete',
      'function classFieldUpdate',
    )
    expect(markComplete).toContain('.insert(trainingRecords)')
    expect(markComplete).toContain('await recordAuditInTransaction(tx, ctx')
    expect(markComplete).toContain('await materializeEvidenceTargetObligations(tx, ctx.tenantId')
    expect(markComplete).toContain("sourceModule: 'training'")
    expect(markComplete).toContain('targetRef: { courseId: course.id }')
  })

  it('refreshes enrollment starts, restarts, and verified completion modes atomically', () => {
    const enroll = between(
      learnActions,
      'export async function enrollInCourse',
      'export async function requestOnlineCourseCompletion',
    )
    const online = between(
      learnActions,
      'export async function requestOnlineCourseCompletion',
      'export async function startLesson',
    )
    const lesson = between(
      learnActions,
      'export async function markLessonComplete',
      'export async function startLessonQuiz',
    )

    expect(enroll.match(/await materializeEvidenceTargetObligations\(tx/gu)).toHaveLength(2)
    expect(enroll.match(/await recordAuditInTransaction\(tx, ctx/gu)).toHaveLength(2)
    expect(completion.match(/await materializeEvidenceTargetObligations\(tx/gu)).toHaveLength(2)
    expect(online).toContain('await recordAuditInTransaction(tx, ctx')
    expect(onlineCompletionActions).toContain('await completeVerifiedOnlineEnrollment(tx')
    expect(onlineCompletionActions).toContain('await recordAuditInTransaction(tx, ctx')
    expect(lesson.match(/await recordAuditInTransaction\(tx, ctx/gu)).toHaveLength(2)
  })

  it('refreshes assessment and course targets when an assessment mints or revokes a record', () => {
    const submit = between(
      assessmentActions,
      'export async function submitAssessmentAttempt',
      'export async function cancelAssessmentAttempt',
    )
    const cancel = between(
      assessmentActions,
      'export async function cancelAssessmentAttempt',
      "revalidatePath('/training')",
    )

    for (const mutation of [submit, cancel]) {
      expect(mutation).toContain('targetRef: { assessmentTypeId: attempt.typeId }')
      expect(mutation).toContain('await materializeEvidenceTargetsObligations(')
      expect(mutation).toContain('await recordAuditInTransaction(tx, ctx')
      expect(mutation).toContain(".for('update')")
    }
    expect(submit).toContain('targetRef: { courseId: attempt.courseId }')
    expect(cancel).toContain('targetRef: { courseId: revokedCourseId }')
    expect(cancel).toContain(
      '.returning({ id: trainingRecords.id, courseId: trainingRecords.courseId })',
    )
  })

  it('serializes API record patches and refreshes both sides of a course retarget', () => {
    const create = between(
      apiWrites,
      'async function createTrainingRecord',
      'function trainingRecordResult',
    )
    const update = between(
      apiWrites,
      'async function updateTrainingRecord',
      'async function deleteTrainingRecord',
    )
    const revoke = between(
      apiWrites,
      'async function deleteTrainingRecord',
      'const TRAINING_RECORD_BODY',
    )

    expect(create).toContain('await recordAuditInTransaction(tx, ctx')
    expect(create).toContain('await materializeTrainingRecordCourses(tx, ctx.tenantId')
    expect(update).toContain(".for('update')")
    expect(update).toContain('before.courseId')
    expect(update).toContain('updated.courseId')
    expect(update).toContain('await recordAuditInTransaction(tx, ctx')
    expect(revoke).toContain(".for('update')")
    expect(revoke).toContain('.update(trainingCertificates)')
    expect(revoke).toContain('await materializeTrainingRecordCourses(tx, ctx.tenantId')
    expect(revoke).toContain('await recordAuditInTransaction(tx, ctx')
  })

  it('keeps practical completion evidence and audit inside the signature saga transaction', () => {
    const practical = between(
      practicalActions,
      'export async function evaluatePractical',
      "return { ok: false, error: e instanceof Error ? e.message : 'Evaluation failed' }",
    )
    expect(practical).toContain('withStoredSignatureAttachment(')
    expect(practical).toContain('await recomputeEnrollmentCompletion(tx')
    expect(practical).toContain('await recordAuditInTransaction(tx, ctx')
    expect(practical).not.toContain('await recordAudit(ctx')
  })
})
