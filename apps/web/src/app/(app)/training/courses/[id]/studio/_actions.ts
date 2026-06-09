'use server'

// Authoring Studio — curriculum (modules + lessons) CRUD for a course.
// Native to training: no Forms/Builder. Rich lesson content is a bespoke
// LessonBlock[] (see packages/db/src/schema/training-lms.ts). Quiz lessons point
// at an existing training_assessment_types row; session lessons at a class.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { trainingCourseModules, trainingLessons, type LessonBlock } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

type LessonKind = 'rich' | 'video' | 'file' | 'embed' | 'quiz' | 'session'
type CompletionRule = 'view' | 'pass' | 'acknowledge' | 'min_time'

const studioPath = (courseId: string) => `/training/courses/${courseId}/studio`

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
  await ctx.db(async (tx) => {
    const now = new Date()
    await tx
      .update(trainingLessons)
      .set({ deletedAt: now })
      .where(eq(trainingLessons.moduleId, moduleId))
    await tx
      .update(trainingCourseModules)
      .set({ deletedAt: now })
      .where(eq(trainingCourseModules.id, moduleId))
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

export async function createLesson(courseId: string, moduleId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const title = String(formData.get('title') ?? '').trim() || 'Untitled lesson'
  const kind = ((String(formData.get('kind') ?? 'rich').trim() || 'rich') as LessonKind)

  const created = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ s: trainingLessons.sortOrder })
      .from(trainingLessons)
      .where(and(eq(trainingLessons.moduleId, moduleId), isNull(trainingLessons.deletedAt)))
    const sortOrder = existing.reduce((m, r) => Math.max(m, r.s), -1) + 1
    const completionRule: CompletionRule = kind === 'quiz' ? 'pass' : 'view'
    const [row] = await tx
      .insert(trainingLessons)
      .values({ tenantId, courseId, moduleId, title, kind, sortOrder, completionRule })
      .returning()
    return row
  })
  if (created) {
    await recordAudit(ctx, {
      entityType: 'training_lesson',
      entityId: created.id,
      action: 'create',
      summary: `Added ${kind} lesson "${title}"`,
    })
  }
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
  const durationRaw = String(formData.get('durationMinutes') ?? '').trim()
  const durationMinutes = durationRaw ? Math.max(0, Number(durationRaw) || 0) : null

  await ctx.db(async (tx) => {
    await tx
      .update(trainingLessons)
      .set({
        ...(title ? { title } : {}),
        ...(kindRaw ? { kind: kindRaw } : {}),
        ...(ruleRaw ? { completionRule: ruleRaw } : {}),
        isRequired,
        assessmentTypeId,
        classId,
        attachmentId,
        embedUrl,
        durationMinutes,
      })
      .where(eq(trainingLessons.id, lessonId))
  })
  revalidatePath(studioPath(courseId))
}

export async function saveLessonContent(lessonId: string, courseId: string, blocks: LessonBlock[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingLessons)
      .set({ contentBlocks: blocks })
      .where(eq(trainingLessons.id, lessonId))
  })
  revalidatePath(studioPath(courseId))
}

export async function deleteLesson(lessonId: string, courseId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingLessons)
      .set({ deletedAt: new Date() })
      .where(eq(trainingLessons.id, lessonId))
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
