'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, eq, max } from 'drizzle-orm'
import {
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/**
 * Create a new assessment type. Redirects to its detail page where the admin
 * adds questions.
 */
export async function createAssessmentType(formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId: string = ctx.tenantId

  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const passingRaw = String(formData.get('passingScore') ?? '80').trim()
  const passingScore = clamp(Number(passingRaw), 0, 100)
  const courseRaw = String(formData.get('courseId') ?? '').trim()
  const courseId = courseRaw && courseRaw !== '__none__' ? courseRaw : null
  const preMsg = String(formData.get('preAssessmentMessage') ?? '').trim() || null
  const postMsg = String(formData.get('postAssessmentMessage') ?? '').trim() || null
  const graded = formData.get('graded') !== 'off'
  const active = formData.get('active') !== 'off'

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
    return row
  })

  if (created) {
    await recordAudit(ctx, {
      entityType: 'training_assessment_type',
      entityId: created.id,
      action: 'create',
      summary: `Created assessment type "${name}"`,
      after: { name, passingScore, courseId, graded, active },
    })
  }
  revalidatePath('/training/assessments/types')
  if (created) redirect(`/training/assessments/types/${created.id}`)
  redirect('/training/assessments/types')
}

export async function updateAssessmentType(typeId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) throw new Error('Name is required')
  const description = String(formData.get('description') ?? '').trim() || null
  const passingScore = clamp(Number(String(formData.get('passingScore') ?? '80')), 0, 100)
  const courseRaw = String(formData.get('courseId') ?? '').trim()
  const courseId = courseRaw && courseRaw !== '__none__' ? courseRaw : null
  const preMsg = String(formData.get('preAssessmentMessage') ?? '').trim() || null
  const postMsg = String(formData.get('postAssessmentMessage') ?? '').trim() || null
  const graded = formData.get('graded') !== 'off'
  const active = formData.get('active') !== 'off'

  const updated = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(eq(trainingAssessmentTypes.id, typeId))
      .limit(1)
    if (!before) throw new Error('Assessment type not found')
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
      .where(eq(trainingAssessmentTypes.id, typeId))
      .returning()
    return { before, row }
  })

  if (updated.row) {
    await recordAudit(ctx, {
      entityType: 'training_assessment_type',
      entityId: typeId,
      action: 'update',
      summary: `Updated assessment type "${name}"`,
      before: { ...updated.before },
      after: { name, passingScore, courseId, graded, active },
    })
  }
  revalidatePath(`/training/assessments/types/${typeId}`)
  revalidatePath('/training/assessments/types')
}

export async function deleteAssessmentType(typeId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingAssessmentTypes)
      .set({ deletedAt: new Date() })
      .where(eq(trainingAssessmentTypes.id, typeId))
  })
  await recordAudit(ctx, {
    entityType: 'training_assessment_type',
    entityId: typeId,
    action: 'delete',
    summary: `Deleted assessment type ${typeId}`,
  })
  revalidatePath('/training/assessments/types')
  redirect('/training/assessments/types')
}

// ----- Question CRUD ------------------------------------------------------

const QUESTION_KINDS = [
  'text',
  'single_choice',
  'multi_choice',
  'numeric',
  'true_false',
] as const
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
  const mandatory = formData.get('mandatory') !== 'off'

  await ctx.db(async (tx) => {
    const [{ next } = { next: 0 }] = await tx
      .select({ next: max(trainingAssessmentTypeQuestions.entityOrder) })
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, typeId))
    await tx.insert(trainingAssessmentTypeQuestions).values({
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
  })

  await recordAudit(ctx, {
    entityType: 'training_assessment_type_question',
    entityId: typeId,
    action: 'create',
    summary: `Added question to assessment type ${typeId}`,
    after: { prompt, kind, points },
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

export async function updateAssessmentQuestion(
  typeId: string,
  questionId: string,
  formData: FormData,
) {
  const ctx = await requireRequestContext()
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
  const mandatory = formData.get('mandatory') !== 'off'

  await ctx.db(async (tx) => {
    await tx
      .update(trainingAssessmentTypeQuestions)
      .set({ prompt, kind, options, correctAnswer, helpText, points, mandatory })
      .where(
        and(
          eq(trainingAssessmentTypeQuestions.id, questionId),
          eq(trainingAssessmentTypeQuestions.typeId, typeId),
        ),
      )
  })

  await recordAudit(ctx, {
    entityType: 'training_assessment_type_question',
    entityId: questionId,
    action: 'update',
    summary: `Updated assessment question ${questionId}`,
    after: { prompt, kind, points },
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

export async function deleteAssessmentQuestion(typeId: string, questionId: string) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    await tx
      .delete(trainingAssessmentTypeQuestions)
      .where(
        and(
          eq(trainingAssessmentTypeQuestions.id, questionId),
          eq(trainingAssessmentTypeQuestions.typeId, typeId),
        ),
      )
  })
  await recordAudit(ctx, {
    entityType: 'training_assessment_type_question',
    entityId: questionId,
    action: 'delete',
    summary: `Deleted assessment question ${questionId}`,
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

export async function reorderAssessmentQuestion(
  typeId: string,
  questionId: string,
  direction: 'up' | 'down',
) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    const all = await tx
      .select()
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, typeId))
      .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))
    const idx = all.findIndex((q) => q.id === questionId)
    if (idx === -1) return
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= all.length) return
    const a = all[idx]!
    const b = all[swapWith]!
    await tx
      .update(trainingAssessmentTypeQuestions)
      .set({ entityOrder: b.entityOrder })
      .where(eq(trainingAssessmentTypeQuestions.id, a.id))
    await tx
      .update(trainingAssessmentTypeQuestions)
      .set({ entityOrder: a.entityOrder })
      .where(eq(trainingAssessmentTypeQuestions.id, b.id))
  })
  revalidatePath(`/training/assessments/types/${typeId}`)
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.trunc(n)))
}
