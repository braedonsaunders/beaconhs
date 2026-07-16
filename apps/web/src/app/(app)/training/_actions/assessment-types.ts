'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm'
import { trainingAssessmentTypeQuestions, trainingAssessmentTypes } from '@beaconhs/db/schema'
import { assertComplianceTargetCanRetire } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'

/**
 * Instant-create an assessment type and land in its detail editor (where the
 * admin sets the name and adds questions). Called from the list "New" button —
 * no separate create form. A blank name defaults to a placeholder.
 */
export async function createAssessmentType(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const name = String(formData.get('name') ?? '').trim() || 'Untitled assessment'
  const description = String(formData.get('description') ?? '').trim() || null
  const passingRaw = String(formData.get('passingScore') ?? '80').trim()
  const passingScore = clamp(Number(passingRaw), 0, 100)
  const courseRaw = String(formData.get('courseId') ?? '').trim()
  const courseId = courseRaw && courseRaw !== '__none__' ? courseRaw : null
  const preMsg = String(formData.get('preAssessmentMessage') ?? '').trim() || null
  const postMsg = String(formData.get('postAssessmentMessage') ?? '').trim() || null
  const graded = formData.has('graded') ? formData.get('graded') === 'on' : true
  const active = formData.has('active') ? formData.get('active') === 'on' : true

  const created = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingAssessmentTypes)
      .values({
        tenantId,
        name,
        description,
        passingScore,
        courseId,
        preAssessmentMessage: preMsg,
        postAssessmentMessage: postMsg,
        graded,
        active,
      })
      .returning()
    if (row) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_assessment_type',
        entityId: row.id,
        action: 'create',
        summary: `Created assessment type "${name}"`,
        after: { name, passingScore, courseId, graded, active },
      })
    }
    return row
  })
  revalidatePath('/training/assessments/types')
  if (created) redirect(`/training/assessments/types/${created.id}`)
  redirect('/training/assessments/types')
}

export async function updateAssessmentType(typeId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const passingScore = clamp(Number(String(formData.get('passingScore') ?? '80')), 0, 100)
  const courseRaw = String(formData.get('courseId') ?? '').trim()
  const courseId = courseRaw && courseRaw !== '__none__' ? courseRaw : null
  const preMsg = String(formData.get('preAssessmentMessage') ?? '').trim() || null
  const postMsg = String(formData.get('postAssessmentMessage') ?? '').trim() || null
  const graded = formData.get('graded') === 'on'
  const active = formData.get('active') === 'on'

  await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(
        and(
          eq(trainingAssessmentTypes.tenantId, tenantId),
          eq(trainingAssessmentTypes.id, typeId),
          isNull(trainingAssessmentTypes.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!before) throw new Error('Assessment type not found')
    if (!active) {
      await assertComplianceTargetCanRetire(tx, tenantId, 'assessment_type', typeId)
    }
    const [row] = await tx
      .update(trainingAssessmentTypes)
      .set({
        name,
        description,
        passingScore,
        courseId,
        preAssessmentMessage: preMsg,
        postAssessmentMessage: postMsg,
        graded,
        active,
      })
      .where(
        and(
          eq(trainingAssessmentTypes.tenantId, tenantId),
          eq(trainingAssessmentTypes.id, typeId),
          isNull(trainingAssessmentTypes.deletedAt),
        ),
      )
      .returning()
    if (!row) throw new Error('Assessment type not found')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment_type',
      entityId: typeId,
      action: 'update',
      summary: `Updated assessment type "${name}"`,
      before: { ...before },
      after: { name, passingScore, courseId, graded, active },
    })
  })

  revalidatePath(`/training/assessments/types/${typeId}`)
  revalidatePath('/training/assessments/types')
}

export async function deleteAssessmentType(typeId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId
  await ctx.db(async (tx) => {
    const [type] = await tx
      .select({ id: trainingAssessmentTypes.id })
      .from(trainingAssessmentTypes)
      .where(
        and(
          eq(trainingAssessmentTypes.tenantId, tenantId),
          eq(trainingAssessmentTypes.id, typeId),
          isNull(trainingAssessmentTypes.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!type) throw new Error('Assessment type not found')
    await assertComplianceTargetCanRetire(tx, tenantId, 'assessment_type', typeId)
    await tx
      .update(trainingAssessmentTypes)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(trainingAssessmentTypes.tenantId, tenantId),
          eq(trainingAssessmentTypes.id, typeId),
          isNull(trainingAssessmentTypes.deletedAt),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment_type',
      entityId: typeId,
      action: 'delete',
      summary: `Deleted assessment type ${typeId}`,
    })
  })
  revalidatePath('/training/assessments/types')
  redirect('/training/assessments/types')
}

// ----- Question CRUD ------------------------------------------------------

const QUESTION_KINDS = ['text', 'single_choice', 'multi_choice', 'numeric', 'true_false'] as const
type QuestionKind = (typeof QUESTION_KINDS)[number]

function parseOptions(raw: string | null): { value: string; label: string }[] | null {
  if (!raw) return null
  // Accept newline-separated list or JSON array.
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr)) {
        return arr
          .map((x) => {
            if (typeof x === 'string') return { value: x, label: x }
            if (x && typeof x === 'object' && typeof x.value === 'string') {
              return { value: String(x.value), label: String(x.label ?? x.value) }
            }
            return null
          })
          .filter((x): x is { value: string; label: string } => x !== null)
      }
    } catch {
      /* fallthrough to line-split */
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => ({ value: String.fromCharCode(65 + i), label: s }))
}

export async function createAssessmentQuestion(typeId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const prompt = String(formData.get('prompt') ?? '').trim()
  if (!prompt) throw new Error('Prompt is required')
  const kindRaw = String(formData.get('kind') ?? 'single_choice')
  if (!QUESTION_KINDS.includes(kindRaw as QuestionKind)) throw new Error('Invalid kind')
  const kind = kindRaw as QuestionKind
  const optionsRaw = String(formData.get('options') ?? '').trim() || null
  let options =
    kind === 'single_choice' || kind === 'multi_choice' ? parseOptions(optionsRaw) : null
  if (kind === 'true_false') {
    options = [
      { value: 'true', label: 'True' },
      { value: 'false', label: 'False' },
    ]
  }
  const correctAnswer = String(formData.get('correctAnswer') ?? '').trim() || null
  const helpText = String(formData.get('helpText') ?? '').trim() || null
  const points = Math.max(1, Number(String(formData.get('points') ?? '1')) || 1)
  const mandatory = formData.has('mandatory') ? formData.getAll('mandatory').includes('on') : true

  await ctx.db(async (tx) => {
    const [{ next } = { next: 0 }] = await tx
      .select({ next: max(trainingAssessmentTypeQuestions.entityOrder) })
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, typeId))
    const [question] = await tx
      .insert(trainingAssessmentTypeQuestions)
      .values({
        tenantId,
        typeId,
        prompt,
        kind,
        options,
        correctAnswer,
        helpText,
        points,
        mandatory,
        entityOrder: (next ?? 0) + 1,
      })
      .returning({ id: trainingAssessmentTypeQuestions.id })
    if (!question) throw new Error('Could not create assessment question')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment_type_question',
      entityId: question.id,
      action: 'create',
      summary: `Added question to assessment type ${typeId}`,
      after: { typeId, prompt, kind, points },
    })
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

export async function updateAssessmentQuestion(
  typeId: string,
  questionId: string,
  formData: FormData,
) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')

  const prompt = String(formData.get('prompt') ?? '').trim()
  if (!prompt) throw new Error('Prompt is required')
  const kindRaw = String(formData.get('kind') ?? 'single_choice')
  if (!QUESTION_KINDS.includes(kindRaw as QuestionKind)) throw new Error('Invalid kind')
  const kind = kindRaw as QuestionKind
  const optionsRaw = String(formData.get('options') ?? '').trim() || null
  let options =
    kind === 'single_choice' || kind === 'multi_choice' ? parseOptions(optionsRaw) : null
  if (kind === 'true_false') {
    options = [
      { value: 'true', label: 'True' },
      { value: 'false', label: 'False' },
    ]
  }
  const correctAnswer = String(formData.get('correctAnswer') ?? '').trim() || null
  const helpText = String(formData.get('helpText') ?? '').trim() || null
  const points = Math.max(1, Number(String(formData.get('points') ?? '1')) || 1)
  const mandatory = formData.get('mandatory') === 'on'

  await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingAssessmentTypeQuestions)
      .where(
        and(
          eq(trainingAssessmentTypeQuestions.id, questionId),
          eq(trainingAssessmentTypeQuestions.typeId, typeId),
        ),
      )
      .limit(1)
      .for('update')
    if (!before) throw new Error('Assessment question not found')
    const [question] = await tx
      .update(trainingAssessmentTypeQuestions)
      .set({ prompt, kind, options, correctAnswer, helpText, points, mandatory })
      .where(
        and(
          eq(trainingAssessmentTypeQuestions.id, questionId),
          eq(trainingAssessmentTypeQuestions.typeId, typeId),
        ),
      )
      .returning({ id: trainingAssessmentTypeQuestions.id })
    if (!question) throw new Error('Assessment question not found')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment_type_question',
      entityId: questionId,
      action: 'update',
      summary: `Updated assessment question ${questionId}`,
      before,
      after: { ...before, prompt, kind, options, correctAnswer, helpText, points, mandatory },
    })
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

export async function deleteAssessmentQuestion(typeId: string, questionId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    const [question] = await tx
      .delete(trainingAssessmentTypeQuestions)
      .where(
        and(
          eq(trainingAssessmentTypeQuestions.id, questionId),
          eq(trainingAssessmentTypeQuestions.typeId, typeId),
        ),
      )
      .returning({ id: trainingAssessmentTypeQuestions.id })
    if (!question) throw new Error('Assessment question not found')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment_type_question',
      entityId: questionId,
      action: 'delete',
      summary: `Deleted assessment question ${questionId}`,
    })
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

export async function reorderAssessmentQuestions(typeId: string, questionIds: string[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    const all = await tx
      .select({ id: trainingAssessmentTypeQuestions.id })
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, typeId))
      .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))
      .for('update')
    const expected = new Set(all.map((question) => question.id))
    if (
      questionIds.length !== expected.size ||
      new Set(questionIds).size !== questionIds.length ||
      questionIds.some((questionId) => !expected.has(questionId))
    ) {
      throw new Error('Question order is stale. Refresh and try again.')
    }
    for (const [index, questionId] of questionIds.entries()) {
      await tx
        .update(trainingAssessmentTypeQuestions)
        .set({ entityOrder: index + 1 })
        .where(
          and(
            eq(trainingAssessmentTypeQuestions.typeId, typeId),
            inArray(trainingAssessmentTypeQuestions.id, [questionId]),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_assessment_type',
      entityId: typeId,
      action: 'update',
      summary: 'Reordered assessment questions',
      after: { questionIds },
      dedupKey: `training.assessment-type-order:${typeId}:${questionIds.join(':')}`,
    })
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.trunc(n)))
}
