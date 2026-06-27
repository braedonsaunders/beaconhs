'use server'

// Server actions for the hazard-assessment TYPE builder. Typed object args —
// called from the client builder inside a transition. Sub-rows (PPE, questions,
// attached apps) reuse the existing entity_order column for drag ordering.

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import {
  formTemplates,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

async function manageCtx() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'hazid')
  return ctx
}
function revalidateType(id: string) {
  revalidatePath(`/hazard-assessments/types/${id}`)
  revalidatePath('/hazard-assessments/types')
}
function slugKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// --- type settings ---------------------------------------------------------

export async function updateAssessmentType(input: {
  id: string
  name: string
  description: string | null
  style: 'task_based' | 'hazard_based'
  defaultHazardSetId: string | null
  hasPPE: boolean
  hasQuestions: boolean
  availableToGroupIds: string[]
}) {
  const ctx = await manageCtx()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentTypes)
      .set({
        name,
        description: input.description?.trim() || null,
        style: input.style,
        defaultHazardSetId:
          input.style === 'hazard_based' ? input.defaultHazardSetId || null : null,
        hasPPE: input.hasPPE,
        hasQuestions: input.hasQuestions,
        availableToGroupIds: input.availableToGroupIds,
      })
      .where(eq(hazidAssessmentTypes.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_type',
    entityId: input.id,
    action: 'update',
    summary: 'Updated assessment type',
  })
  revalidateType(input.id)
}

export async function deleteAssessmentType(input: { id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentTypes)
      .set({ deletedAt: new Date() })
      .where(eq(hazidAssessmentTypes.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'hazid_assessment_type',
    entityId: input.id,
    action: 'delete',
    summary: 'Deleted assessment type',
  })
  revalidatePath('/hazard-assessments/types')
}

// --- default PPE -----------------------------------------------------------

export async function addTypePPE(input: {
  typeId: string
  name: string
  description: string | null
  required: boolean
}) {
  const ctx = await manageCtx()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  const result = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${hazidAssessmentTypePPE.entityOrder}), -1)`.mapWith(Number),
      })
      .from(hazidAssessmentTypePPE)
      .where(eq(hazidAssessmentTypePPE.typeId, input.typeId))
    const entityOrder = Number(maxRow?.m ?? -1) + 1
    const [row] = await tx
      .insert(hazidAssessmentTypePPE)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        name,
        description: input.description?.trim() || null,
        required: input.required,
        entityOrder,
      })
      .returning({ id: hazidAssessmentTypePPE.id })
    return { id: row?.id, entityOrder }
  })
  revalidateType(input.typeId)
  return result
}

export async function updateTypePPE(input: {
  typeId: string
  id: string
  name: string
  description: string | null
  required: boolean
}) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentTypePPE)
      .set({
        name: input.name.trim() || 'PPE',
        description: input.description?.trim() || null,
        required: input.required,
      })
      .where(eq(hazidAssessmentTypePPE.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function deleteTypePPE(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(hazidAssessmentTypePPE).where(eq(hazidAssessmentTypePPE.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function reorderTypePPE(input: { typeId: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(hazidAssessmentTypePPE)
        .set({ entityOrder: i })
        .where(eq(hazidAssessmentTypePPE.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- default questions -----------------------------------------------------

export async function addTypeQuestion(input: {
  typeId: string
  question: string
  questionType: 'yes_no' | 'text' | 'multi_select'
  answers: string[]
  requiresYes: boolean
}) {
  const ctx = await manageCtx()
  const question = input.question.trim()
  if (!question) throw new Error('Question is required')
  const result = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${hazidAssessmentTypeQuestions.entityOrder}), -1)`.mapWith(
          Number,
        ),
      })
      .from(hazidAssessmentTypeQuestions)
      .where(eq(hazidAssessmentTypeQuestions.typeId, input.typeId))
    const entityOrder = Number(maxRow?.m ?? -1) + 1
    const [row] = await tx
      .insert(hazidAssessmentTypeQuestions)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        question,
        questionType: input.questionType,
        answers: input.answers,
        requiresYes: input.requiresYes,
        entityOrder,
      })
      .returning({ id: hazidAssessmentTypeQuestions.id })
    return { id: row?.id, entityOrder }
  })
  revalidateType(input.typeId)
  return result
}

export async function updateTypeQuestion(input: {
  typeId: string
  id: string
  question: string
  questionType: 'yes_no' | 'text' | 'multi_select'
  answers: string[]
  requiresYes: boolean
}) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentTypeQuestions)
      .set({
        question: input.question.trim() || 'Question',
        questionType: input.questionType,
        answers: input.answers,
        requiresYes: input.requiresYes,
      })
      .where(eq(hazidAssessmentTypeQuestions.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function deleteTypeQuestion(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(hazidAssessmentTypeQuestions).where(eq(hazidAssessmentTypeQuestions.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function reorderTypeQuestions(input: { typeId: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(hazidAssessmentTypeQuestions)
        .set({ entityOrder: i })
        .where(eq(hazidAssessmentTypeQuestions.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- attached builder apps -------------------------------------------------

export async function addTypeApp(input: {
  typeId: string
  templateId: string
  label: string | null
  key: string | null
  description: string | null
  required: boolean
  autoCreate: boolean
}) {
  const ctx = await manageCtx()
  if (!input.templateId) throw new Error('Pick a published app')
  const result = await ctx.db(async (tx) => {
    const [template] = await tx
      .select({ name: formTemplates.name, description: formTemplates.description })
      .from(formTemplates)
      .where(eq(formTemplates.id, input.templateId))
      .limit(1)
    if (!template) throw new Error('App not found')
    const label = input.label?.trim() || template.name
    const key = slugKey(input.key?.trim() || label)
    if (!key) throw new Error('App key is required')
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${hazidAssessmentTypeApps.entityOrder}), -1)`.mapWith(Number),
      })
      .from(hazidAssessmentTypeApps)
      .where(eq(hazidAssessmentTypeApps.typeId, input.typeId))
    const entityOrder = Number(maxRow?.m ?? -1) + 1
    const [row] = await tx
      .insert(hazidAssessmentTypeApps)
      .values({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        templateId: input.templateId,
        key,
        label,
        description: input.description?.trim() || template.description,
        required: input.required,
        autoCreate: input.autoCreate,
        entityOrder,
        config: {},
      })
      .returning({
        id: hazidAssessmentTypeApps.id,
        label: hazidAssessmentTypeApps.label,
        key: hazidAssessmentTypeApps.key,
        description: hazidAssessmentTypeApps.description,
        required: hazidAssessmentTypeApps.required,
        autoCreate: hazidAssessmentTypeApps.autoCreate,
        entityOrder: hazidAssessmentTypeApps.entityOrder,
        templateName: sql<string>`${template.name}`,
      })
    return row
  })
  revalidateType(input.typeId)
  return result
}

export async function updateTypeApp(input: {
  typeId: string
  id: string
  label: string
  description: string | null
  required: boolean
  autoCreate: boolean
}) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(hazidAssessmentTypeApps)
      .set({
        label: input.label.trim() || 'App',
        description: input.description?.trim() || null,
        required: input.required,
        autoCreate: input.autoCreate,
      })
      .where(eq(hazidAssessmentTypeApps.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function deleteTypeApp(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(hazidAssessmentTypeApps).where(eq(hazidAssessmentTypeApps.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function reorderTypeApps(input: { typeId: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(hazidAssessmentTypeApps)
        .set({ entityOrder: i })
        .where(eq(hazidAssessmentTypeApps.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}
