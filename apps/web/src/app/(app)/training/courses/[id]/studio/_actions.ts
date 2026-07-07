'use server'

// Authoring Studio — curriculum (modules + lessons) CRUD for a course.
// Native to training: no Forms/Builder. Rich lesson content is a bespoke
// LessonBlock[] (see packages/db/src/schema/training-lms.ts). Quiz lessons point
// at an existing training_assessment_types row; session lessons at a class.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import {
  trainingCourseFiles,
  trainingCourses,
  trainingCourseModules,
  trainingLessons,
  type PracticalCriterion,
} from '@beaconhs/db/schema'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { enqueueSlidesImport } from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { purgeDeckAssets } from '../../../pptx/_lib'

type LessonKind = 'rich' | 'video' | 'file' | 'embed' | 'quiz' | 'session' | 'slides' | 'practical'
type CompletionRule = 'view' | 'pass' | 'acknowledge' | 'min_time' | 'evaluator'

// The course page IS the builder now.
const studioPath = (courseId: string) => `/training/courses/${courseId}`

// --- Modules ---------------------------------------------------------------

export async function createModule(courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const title = String(formData.get('title') ?? '').trim() || 'Untitled module'

  const created = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ s: trainingCourseModules.sortOrder })
      .from(trainingCourseModules)
      .where(
        and(eq(trainingCourseModules.courseId, courseId), isNull(trainingCourseModules.deletedAt)),
      )
    const sortOrder = existing.reduce((m, r) => Math.max(m, r.s), -1) + 1
    const [row] = await tx
      .insert(trainingCourseModules)
      .values({ tenantId, courseId, title, sortOrder })
      .returning()
    return row
  })
  if (created) {
    await recordAudit(ctx, {
      entityType: 'training_course_module',
      entityId: created.id,
      action: 'create',
      summary: `Added module "${title}"`,
    })
  }
  revalidatePath(studioPath(courseId))
}

export async function updateModule(moduleId: string, courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  await ctx.db(async (tx) => {
    await tx
      .update(trainingCourseModules)
      .set({ title: title || 'Untitled module', description })
      .where(eq(trainingCourseModules.id, moduleId))
  })
  revalidatePath(studioPath(courseId))
}

export async function deleteModule(moduleId: string, courseId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const decks = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        slides: trainingLessons.slides,
        sourceAttachmentId: trainingLessons.sourceAttachmentId,
      })
      .from(trainingLessons)
      .where(eq(trainingLessons.moduleId, moduleId))
    const now = new Date()
    await tx
      .update(trainingLessons)
      .set({ deletedAt: now, slides: [], sourceAttachmentId: null })
      .where(eq(trainingLessons.moduleId, moduleId))
    await tx
      .update(trainingCourseModules)
      .set({ deletedAt: now })
      .where(eq(trainingCourseModules.id, moduleId))
    return rows
  })
  const purged = await purgeDeckAssets(ctx.db, decks)
  await recordAudit(ctx, {
    entityType: 'training_course_module',
    entityId: moduleId,
    action: 'delete',
    summary: 'Deleted module and its lessons',
    metadata: purged ? { purgedAttachments: purged } : {},
  })
  revalidatePath(studioPath(courseId))
}

export async function reorderModules(courseId: string, orderedIds: string[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(trainingCourseModules)
        .set({ sortOrder: i })
        .where(eq(trainingCourseModules.id, orderedIds[i]!))
    }
  })
  revalidatePath(studioPath(courseId))
}

// --- Lessons ---------------------------------------------------------------

const KIND_DEFAULT_TITLE: Record<LessonKind, string> = {
  rich: 'New text lesson',
  slides: 'New slideshow',
  video: 'New video',
  file: 'New file / handout',
  embed: 'New embedded page',
  quiz: 'New quiz',
  session: 'In-person session',
  practical: 'Practical test',
}

// Drag-and-drop create: drop a palette element on a module (or on the empty
// course, which creates the first module too). Returns the new lesson id so
// the client can open its editor immediately.
export async function createLessonOfKind(
  courseId: string,
  moduleId: string | null,
  kind: LessonKind,
): Promise<{ id: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId

  const created = await ctx.db(async (tx) => {
    let targetModuleId = moduleId
    if (!targetModuleId) {
      const existing = await tx
        .select({ s: trainingCourseModules.sortOrder })
        .from(trainingCourseModules)
        .where(
          and(
            eq(trainingCourseModules.courseId, courseId),
            isNull(trainingCourseModules.deletedAt),
          ),
        )
      const sortOrder = existing.reduce((m, r) => Math.max(m, r.s), -1) + 1
      const [mod] = await tx
        .insert(trainingCourseModules)
        .values({ tenantId, courseId, title: `Module ${sortOrder + 1}`, sortOrder })
        .returning()
      if (!mod) throw new Error('Failed to create module')
      targetModuleId = mod.id
    }
    const existing = await tx
      .select({ s: trainingLessons.sortOrder })
      .from(trainingLessons)
      .where(and(eq(trainingLessons.moduleId, targetModuleId), isNull(trainingLessons.deletedAt)))
    const sortOrder = existing.reduce((m, r) => Math.max(m, r.s), -1) + 1
    const completionRule: CompletionRule =
      kind === 'quiz' ? 'pass' : kind === 'practical' ? 'evaluator' : 'view'
    const [row] = await tx
      .insert(trainingLessons)
      .values({
        tenantId,
        courseId,
        moduleId: targetModuleId,
        title: KIND_DEFAULT_TITLE[kind] ?? 'New lesson',
        kind,
        sortOrder,
        completionRule,
      })
      .returning()
    if (!row) throw new Error('Failed to create lesson')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: created.id,
    action: 'create',
    summary: `Added ${kind} lesson via builder`,
  })
  revalidatePath(studioPath(courseId))
  return { id: created.id }
}

// --- Course files (left-rail Files tab) -------------------------------------

export async function addCourseFile(
  courseId: string,
  attachmentId: string,
  label: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!courseId || !attachmentId) return { ok: false, error: 'Missing fields' }
  await ctx.db(async (tx) => {
    const rows = await tx
      .select({ s: trainingCourseFiles.sortOrder })
      .from(trainingCourseFiles)
      .where(eq(trainingCourseFiles.courseId, courseId))
    const next = rows.reduce((m, r) => Math.max(m, r.s), -1) + 1
    await tx.insert(trainingCourseFiles).values({
      tenantId: ctx.tenantId,
      courseId,
      attachmentId,
      label,
      sortOrder: next,
    })
  })
  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: courseId,
    action: 'update',
    summary: `Attached file${label ? ` "${label}"` : ''}`,
    after: { attachmentId, label },
  })
  revalidatePath(studioPath(courseId))
  return { ok: true }
}

export async function removeCourseFile(courseId: string, fileId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db((tx) => tx.delete(trainingCourseFiles).where(eq(trainingCourseFiles.id, fileId)))
  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: courseId,
    action: 'delete',
    summary: 'Detached course file',
    before: { fileId },
  })
  revalidatePath(studioPath(courseId))
}

export async function updateLesson(lessonId: string, courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const title = String(formData.get('title') ?? '').trim()
  const kindRaw = String(formData.get('kind') ?? '').trim() as LessonKind | ''
  const ruleRaw = String(formData.get('completionRule') ?? '').trim() as CompletionRule | ''
  const isRequired = formData.get('isRequired') !== 'off'
  const assessmentTypeId = String(formData.get('assessmentTypeId') ?? '').trim() || null
  const classId = String(formData.get('classId') ?? '').trim() || null
  const attachmentId = String(formData.get('attachmentId') ?? '').trim() || null
  const embedUrl = String(formData.get('embedUrl') ?? '').trim() || null
  const contentItemId = String(formData.get('contentItemId') ?? '').trim() || null
  const durationRaw = String(formData.get('durationMinutes') ?? '').trim()
  const durationMinutes = durationRaw ? Math.max(0, Number(durationRaw) || 0) : null
  // Practical criteria arrive as a JSON array of {id, text}.
  let practicalCriteria: PracticalCriterion[] | undefined
  const criteriaRaw = formData.get('practicalCriteria')
  if (typeof criteriaRaw === 'string' && criteriaRaw) {
    try {
      const parsed = JSON.parse(criteriaRaw)
      if (Array.isArray(parsed)) {
        practicalCriteria = parsed
          .filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string')
          .slice(0, 100)
      }
    } catch {
      // ignore malformed payloads — keep the existing criteria
    }
  }
  // Practical lessons always require an evaluator sign-off.
  const effectiveRule: CompletionRule | '' = kindRaw === 'practical' ? 'evaluator' : ruleRaw

  await ctx.db(async (tx) => {
    await tx
      .update(trainingLessons)
      .set({
        ...(title ? { title } : {}),
        ...(kindRaw ? { kind: kindRaw } : {}),
        ...(effectiveRule ? { completionRule: effectiveRule } : {}),
        ...(practicalCriteria !== undefined ? { practicalCriteria } : {}),
        isRequired,
        assessmentTypeId,
        classId,
        attachmentId,
        embedUrl,
        contentItemId,
        durationMinutes,
      })
      .where(eq(trainingLessons.id, lessonId))
  })
  revalidatePath(studioPath(courseId))
}

// TipTap-authored lesson content (rich lessons + practical instructions).
export async function saveLessonRich(
  lessonId: string,
  courseId: string,
  json: unknown,
  html: string,
) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Content too large')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingLessons)
      .set({
        contentJson: (json ?? null) as Record<string, unknown> | null,
        contentHtml: sanitizeDocumentHtml(html),
      })
      .where(eq(trainingLessons.id, lessonId))
  })
  revalidatePath(studioPath(courseId))
}

// Kick off the worker-side PowerPoint → slides conversion for a lesson.
export async function importLessonPptx(lessonId: string, courseId: string, attachmentId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingLessons)
      .set({ importStatus: 'pending', importError: null })
      .where(eq(trainingLessons.id, lessonId))
  })
  await enqueueSlidesImport({
    kind: 'slides_import',
    tenantId: ctx.tenantId,
    target: 'lesson',
    targetId: lessonId,
    attachmentId,
  })
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: lessonId,
    action: 'update',
    summary: 'Queued PowerPoint import',
    after: { attachmentId },
  })
  revalidatePath(studioPath(courseId))
}

const DELIVERY_TYPES = [
  'classroom',
  'self_paced',
  'on_the_job',
  'external_certificate',
  'online',
] as const
type DeliveryType = (typeof DELIVERY_TYPES)[number]

export async function updateCourseSettings(courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()
  const descriptionRaw = String(formData.get('description') ?? '').trim()
  const description = descriptionRaw ? sanitizeDocumentHtml(descriptionRaw) : null
  const deliveryRaw = String(formData.get('deliveryType') ?? '').trim()
  const deliveryType: DeliveryType | null = DELIVERY_TYPES.includes(deliveryRaw as DeliveryType)
    ? (deliveryRaw as DeliveryType)
    : null
  const onlineUrl = String(formData.get('onlineUrl') ?? '').trim() || null
  const instructionsRaw = String(formData.get('instructions') ?? '').trim()
  const instructions = instructionsRaw ? sanitizeDocumentHtml(instructionsRaw) : null
  const durationRaw = String(formData.get('durationMinutes') ?? '').trim()
  const validRaw = String(formData.get('validForMonths') ?? '').trim()
  // Card Studio designs pinned to this course (any number; empty = tenant defaults).
  const credentialOutputIds = Array.from(
    new Set(
      formData
        .getAll('credentialOutputIds')
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  )
  await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ metadata: trainingCourses.metadata })
      .from(trainingCourses)
      .where(eq(trainingCourses.id, courseId))
      .limit(1)
    const metadata = { ...(existing?.metadata ?? {}), credentialOutputIds }
    await tx
      .update(trainingCourses)
      .set({
        ...(name ? { name } : {}),
        ...(code ? { code } : {}),
        ...(deliveryType ? { deliveryType } : {}),
        description,
        onlineUrl,
        instructions,
        durationMinutes: durationRaw ? Math.max(0, Number(durationRaw) || 0) : null,
        validForMonths: validRaw ? Math.max(0, Number(validRaw) || 0) : null,
        metadata,
      })
      .where(eq(trainingCourses.id, courseId))
  })
  revalidatePath(studioPath(courseId))
  revalidatePath(`/training/courses/${courseId}`)
}

export async function deleteLesson(lessonId: string, courseId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const deck = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        slides: trainingLessons.slides,
        sourceAttachmentId: trainingLessons.sourceAttachmentId,
      })
      .from(trainingLessons)
      .where(eq(trainingLessons.id, lessonId))
      .limit(1)
    await tx
      .update(trainingLessons)
      .set({ deletedAt: new Date(), slides: [], sourceAttachmentId: null })
      .where(eq(trainingLessons.id, lessonId))
    return row ?? null
  })
  const purged = deck ? await purgeDeckAssets(ctx.db, [deck]) : 0
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: lessonId,
    action: 'delete',
    summary: 'Deleted lesson',
    metadata: purged ? { purgedAttachments: purged } : {},
  })
  revalidatePath(studioPath(courseId))
}

export async function reorderLessons(courseId: string, orderedIds: string[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(trainingLessons)
        .set({ sortOrder: i })
        .where(eq(trainingLessons.id, orderedIds[i]!))
    }
  })
  revalidatePath(studioPath(courseId))
}
