'use server'

// Authoring Studio — curriculum (modules + lessons) CRUD for a course.
// Native to training: no Forms/Builder. Rich lessons use the shared training
// TipTap editor. Quiz lessons point at an existing training_assessment_types
// row; session lessons point at a class.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  attachments,
  tenants,
  trainingAssessmentTypes,
  trainingClasses,
  trainingContentItems,
  trainingCourseFiles,
  trainingCourses,
  trainingCourseModules,
  trainingLessons,
} from '@beaconhs/db/schema'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { enabledCredentialOutputs } from '@/lib/credential-designs'
import { validateTrainingExternalUrl } from '@/lib/training-external-url.server'
import {
  assertExactTrainingOrder,
  MAX_TRAINING_DURATION_MINUTES,
  MAX_TRAINING_VALIDITY_MONTHS,
  optionalTrainingInteger,
  optionalTrainingText,
  optionalTrainingUuid,
  parsePracticalCriteria,
  parseTrainingOrder,
  requiredTrainingText,
  requireTrainingEnum,
  requireTrainingUuid,
  TRAINING_COMPLETION_RULES,
  TRAINING_LESSON_KINDS,
  type TrainingCompletionRule as CompletionRule,
  type TrainingLessonKind as LessonKind,
} from '@/lib/training-mutation-validation'
import { sanitizeTrainingHtml } from '@/lib/training-rich-content'
import { assertTrainingPptxAttachment } from '@/lib/training-pptx-policy'
import { purgeDeckAssets } from '../../../pptx/_lib'
import { DELIVERY_TYPES, type DeliveryType } from '../../../_lib/delivery'

// The course page IS the builder now.
const studioPath = (courseId: string) => `/training/courses/${courseId}`

async function requireActiveCourse(tx: Database, courseId: string) {
  const [course] = await tx
    .select({ id: trainingCourses.id })
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
    .limit(1)
  if (!course) throw new Error('Course not found.')
  return course
}

async function requireOwnedAttachment(tx: Database, attachmentId: string | null): Promise<void> {
  if (!attachmentId) return
  const [attachment] = await tx
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1)
  if (!attachment) throw new Error('Attachment not found.')
}

async function requireOwnedPptxAttachment(tx: Database, attachmentId: string): Promise<void> {
  const [attachment] = await tx
    .select({
      kind: attachments.kind,
      contentType: attachments.contentType,
      sizeBytes: attachments.sizeBytes,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1)
  if (!attachment) throw new Error('PowerPoint attachment not found.')
  assertTrainingPptxAttachment(attachment)
}

// Create a draft course and jump straight into its workspace — no intermediate
// form. Name, code, delivery type and the rest are captured inline on the
// Overview tab; the curriculum is built on the same page. Mirrors how training
// records and hazard assessments start.
export async function startCourse() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId

  const created = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingCourses)
      .values({ tenantId, name: 'Untitled course', code: '', deliveryType: 'self_paced' })
      .returning({ id: trainingCourses.id })
    return row ?? null
  })
  if (!created) throw new Error('Could not create the course.')

  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: created.id,
    action: 'create',
    summary: 'Created course draft',
  })
  revalidatePath('/training/courses')
  redirect(`/training/courses/${created.id}`)
}

// --- Modules ---------------------------------------------------------------

export async function createModule(courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  courseId = requireTrainingUuid(courseId, 'Course')
  const titleRaw = String(formData.get('title') ?? '').trim()
  const title = titleRaw ? requiredTrainingText(titleRaw, 'Module title', 200) : 'Untitled module'

  const created = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
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
    if (!row) throw new Error('Could not create the module.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_course_module',
    entityId: created.id,
    action: 'create',
    summary: `Added module "${title}"`,
    after: { courseId },
  })
  revalidatePath(studioPath(courseId))
}

export async function updateModule(moduleId: string, courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  moduleId = requireTrainingUuid(moduleId, 'Module')
  courseId = requireTrainingUuid(courseId, 'Course')
  const titleRaw = String(formData.get('title') ?? '').trim()
  const title = titleRaw ? requiredTrainingText(titleRaw, 'Module title', 200) : 'Untitled module'
  const description = optionalTrainingText(
    formData.get('description'),
    'Module description',
    20_000,
  )
  const updated = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const [row] = await tx
      .update(trainingCourseModules)
      .set({ title, description })
      .where(
        and(
          eq(trainingCourseModules.id, moduleId),
          eq(trainingCourseModules.courseId, courseId),
          isNull(trainingCourseModules.deletedAt),
        ),
      )
      .returning({ id: trainingCourseModules.id })
    if (!row) throw new Error('Module not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_course_module',
    entityId: updated.id,
    action: 'update',
    summary: `Updated module "${title}"`,
    after: { courseId },
  })
  revalidatePath(studioPath(courseId))
}

export async function deleteModule(moduleId: string, courseId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  moduleId = requireTrainingUuid(moduleId, 'Module')
  courseId = requireTrainingUuid(courseId, 'Course')
  const decks = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const [module] = await tx
      .select({ id: trainingCourseModules.id })
      .from(trainingCourseModules)
      .where(
        and(
          eq(trainingCourseModules.id, moduleId),
          eq(trainingCourseModules.courseId, courseId),
          isNull(trainingCourseModules.deletedAt),
        ),
      )
      .limit(1)
    if (!module) throw new Error('Module not found.')
    const rows = await tx
      .select({
        sourceAttachmentId: trainingLessons.sourceAttachmentId,
      })
      .from(trainingLessons)
      .where(
        and(
          eq(trainingLessons.moduleId, moduleId),
          eq(trainingLessons.courseId, courseId),
          isNull(trainingLessons.deletedAt),
        ),
      )
    const now = new Date()
    await tx
      .update(trainingLessons)
      .set({ deletedAt: now, sourceAttachmentId: null })
      .where(
        and(
          eq(trainingLessons.moduleId, moduleId),
          eq(trainingLessons.courseId, courseId),
          isNull(trainingLessons.deletedAt),
        ),
      )
    const [deleted] = await tx
      .update(trainingCourseModules)
      .set({ deletedAt: now })
      .where(
        and(
          eq(trainingCourseModules.id, moduleId),
          eq(trainingCourseModules.courseId, courseId),
          isNull(trainingCourseModules.deletedAt),
        ),
      )
      .returning({ id: trainingCourseModules.id })
    if (!deleted) throw new Error('Module changed while it was being deleted.')
    return rows
  })
  const purged = await purgeDeckAssets(ctx.db, decks)
  await recordAudit(ctx, {
    entityType: 'training_course_module',
    entityId: moduleId,
    action: 'delete',
    summary: 'Deleted module and its lessons',
    metadata: { courseId, ...(purged ? { purgedAttachments: purged } : {}) },
  })
  revalidatePath(studioPath(courseId))
}

export async function reorderModules(courseId: string, orderedIds: string[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  courseId = requireTrainingUuid(courseId, 'Course')
  orderedIds = parseTrainingOrder(orderedIds, 'Module')
  await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const modules = await tx
      .select({ id: trainingCourseModules.id })
      .from(trainingCourseModules)
      .where(
        and(eq(trainingCourseModules.courseId, courseId), isNull(trainingCourseModules.deletedAt)),
      )
    assertExactTrainingOrder(
      modules.map((module) => module.id),
      orderedIds,
      'Module',
    )
    for (let i = 0; i < orderedIds.length; i++) {
      const [updated] = await tx
        .update(trainingCourseModules)
        .set({ sortOrder: i })
        .where(
          and(
            eq(trainingCourseModules.id, orderedIds[i]!),
            eq(trainingCourseModules.courseId, courseId),
            isNull(trainingCourseModules.deletedAt),
          ),
        )
        .returning({ id: trainingCourseModules.id })
      if (!updated) throw new Error('Module order changed while it was being saved.')
    }
  })
  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: courseId,
    action: 'update',
    summary: `Reordered ${orderedIds.length} course modules`,
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
  courseId = requireTrainingUuid(courseId, 'Course')
  moduleId = moduleId ? requireTrainingUuid(moduleId, 'Module') : null
  kind = requireTrainingEnum(kind, TRAINING_LESSON_KINDS, 'Lesson type')

  const created = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
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
    } else {
      const [module] = await tx
        .select({ id: trainingCourseModules.id })
        .from(trainingCourseModules)
        .where(
          and(
            eq(trainingCourseModules.id, targetModuleId),
            eq(trainingCourseModules.courseId, courseId),
            isNull(trainingCourseModules.deletedAt),
          ),
        )
        .limit(1)
      if (!module) throw new Error('Module not found.')
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
    after: { courseId, moduleId: created.moduleId },
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
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  try {
    courseId = requireTrainingUuid(courseId, 'Course')
    attachmentId = requireTrainingUuid(attachmentId, 'Attachment')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid file' }
  }
  label = optionalTrainingText(label, 'File label', 255)
  const created = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    await requireOwnedAttachment(tx, attachmentId)
    const [duplicate] = await tx
      .select({ id: trainingCourseFiles.id })
      .from(trainingCourseFiles)
      .where(
        and(
          eq(trainingCourseFiles.courseId, courseId),
          eq(trainingCourseFiles.attachmentId, attachmentId),
        ),
      )
      .limit(1)
    if (duplicate) throw new Error('That file is already attached to this course.')
    const rows = await tx
      .select({ s: trainingCourseFiles.sortOrder })
      .from(trainingCourseFiles)
      .where(eq(trainingCourseFiles.courseId, courseId))
    const next = rows.reduce((m, r) => Math.max(m, r.s), -1) + 1
    const [row] = await tx
      .insert(trainingCourseFiles)
      .values({
        tenantId: ctx.tenantId,
        courseId,
        attachmentId,
        label,
        sortOrder: next,
      })
      .returning({ id: trainingCourseFiles.id })
    if (!row) throw new Error('Could not attach the file.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_course_file',
    entityId: created.id,
    action: 'create',
    summary: `Attached file${label ? ` "${label}"` : ''}`,
    after: { courseId, attachmentId, label },
  })
  revalidatePath(studioPath(courseId))
  return { ok: true }
}

export async function removeCourseFile(courseId: string, fileId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  courseId = requireTrainingUuid(courseId, 'Course')
  fileId = requireTrainingUuid(fileId, 'Course file')
  const removed = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const [row] = await tx
      .delete(trainingCourseFiles)
      .where(and(eq(trainingCourseFiles.id, fileId), eq(trainingCourseFiles.courseId, courseId)))
      .returning({
        id: trainingCourseFiles.id,
        attachmentId: trainingCourseFiles.attachmentId,
        label: trainingCourseFiles.label,
      })
    if (!row) throw new Error('Course file not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_course_file',
    entityId: removed.id,
    action: 'delete',
    summary: 'Detached course file',
    before: { courseId, attachmentId: removed.attachmentId, label: removed.label },
  })
  revalidatePath(studioPath(courseId))
}

export async function updateLesson(lessonId: string, courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')
  courseId = requireTrainingUuid(courseId, 'Course')
  const kind = requireTrainingEnum(formData.get('kind'), TRAINING_LESSON_KINDS, 'Lesson type')
  const titleRaw = String(formData.get('title') ?? '').trim()
  const title = titleRaw
    ? requiredTrainingText(titleRaw, 'Lesson title', 200)
    : KIND_DEFAULT_TITLE[kind]
  const rule = requireTrainingEnum(
    formData.get('completionRule'),
    TRAINING_COMPLETION_RULES,
    'Completion rule',
  )
  const requiredRaw = formData.get('isRequired')
  if (requiredRaw !== 'on' && requiredRaw !== 'off') {
    throw new Error('Required-lesson setting is invalid.')
  }
  const isRequired = requiredRaw === 'on'
  const assessmentTypeIdRaw = optionalTrainingUuid(
    formData.get('assessmentTypeId'),
    'Assessment type',
  )
  const classIdRaw = optionalTrainingUuid(formData.get('classId'), 'Class')
  const attachmentIdRaw = optionalTrainingUuid(formData.get('attachmentId'), 'Attachment')
  const embedUrlRaw = String(formData.get('embedUrl') ?? '').trim()
  const contentItemIdRaw = optionalTrainingUuid(formData.get('contentItemId'), 'Library item')
  const durationMinutes = optionalTrainingInteger(
    formData.get('durationMinutes'),
    'Duration',
    MAX_TRAINING_DURATION_MINUTES,
  )
  const minimumMinutes = optionalTrainingInteger(
    formData.get('minimumMinutes'),
    'Minimum time',
    MAX_TRAINING_DURATION_MINUTES,
  )
  const practicalCriteria = parsePracticalCriteria(formData.get('practicalCriteria'))

  const effectiveRule: CompletionRule =
    kind === 'practical' ? 'evaluator' : kind === 'quiz' ? 'pass' : rule
  if (effectiveRule === 'evaluator' && kind !== 'practical') {
    throw new Error('Evaluator sign-off is only valid for practical lessons.')
  }
  if (effectiveRule === 'pass' && kind !== 'quiz') {
    throw new Error('Pass is only valid for quiz lessons.')
  }
  if (effectiveRule === 'min_time' && (!minimumMinutes || minimumMinutes < 1)) {
    throw new Error('Set a minimum time of at least one minute.')
  }

  const reusable =
    kind === 'rich' || kind === 'video' || kind === 'file' || kind === 'embed' || kind === 'slides'
  const contentItemId = reusable ? contentItemIdRaw : null
  const attachmentId =
    !contentItemId && (kind === 'video' || kind === 'file') ? attachmentIdRaw : null
  const embedUrl =
    !contentItemId && (kind === 'video' || kind === 'embed') && embedUrlRaw
      ? await validateTrainingExternalUrl(embedUrlRaw)
      : null
  const assessmentTypeId = kind === 'quiz' ? assessmentTypeIdRaw : null
  const classId = kind === 'session' ? classIdRaw : null
  const minTimeSeconds = effectiveRule === 'min_time' ? minimumMinutes! * 60 : null

  const updated = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    await requireOwnedAttachment(tx, attachmentId)
    if (assessmentTypeId) {
      const [assessmentType] = await tx
        .select({ id: trainingAssessmentTypes.id })
        .from(trainingAssessmentTypes)
        .where(
          and(
            eq(trainingAssessmentTypes.id, assessmentTypeId),
            isNull(trainingAssessmentTypes.deletedAt),
          ),
        )
        .limit(1)
      if (!assessmentType) throw new Error('Assessment type not found.')
    }
    if (classId) {
      const [trainingClass] = await tx
        .select({ id: trainingClasses.id })
        .from(trainingClasses)
        .where(and(eq(trainingClasses.id, classId), eq(trainingClasses.courseId, courseId)))
        .limit(1)
      if (!trainingClass) throw new Error('Class not found for this course.')
    }
    if (contentItemId) {
      const [contentItem] = await tx
        .select({ id: trainingContentItems.id, kind: trainingContentItems.kind })
        .from(trainingContentItems)
        .where(
          and(eq(trainingContentItems.id, contentItemId), isNull(trainingContentItems.deletedAt)),
        )
        .limit(1)
      if (!contentItem) throw new Error('Library item not found.')
      if ((kind === 'slides') !== (contentItem.kind === 'slides')) {
        throw new Error('The selected library item is not compatible with this lesson type.')
      }
    }

    const [row] = await tx
      .update(trainingLessons)
      .set({
        title,
        kind,
        completionRule: effectiveRule,
        minTimeSeconds,
        practicalCriteria: kind === 'practical' ? (practicalCriteria ?? []) : [],
        isRequired,
        assessmentTypeId,
        classId,
        attachmentId,
        embedUrl,
        contentItemId,
        durationMinutes,
      })
      .where(
        and(
          eq(trainingLessons.id, lessonId),
          eq(trainingLessons.courseId, courseId),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .returning({ id: trainingLessons.id })
    if (!row) throw new Error('Lesson not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: updated.id,
    action: 'update',
    summary: `Updated lesson "${title}"`,
    after: {
      courseId,
      kind,
      completionRule: effectiveRule,
      minTimeSeconds,
      assessmentTypeId,
      classId,
      attachmentId,
      contentItemId,
    },
  })
  revalidatePath(studioPath(courseId))
}

// TipTap-authored lesson content (rich lessons + practical instructions).
export async function saveLessonRich(lessonId: string, courseId: string, html: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')
  courseId = requireTrainingUuid(courseId, 'Course')
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Content too large')
  const updated = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const [row] = await tx
      .update(trainingLessons)
      .set({
        contentHtml: sanitizeTrainingHtml(html),
      })
      .where(
        and(
          eq(trainingLessons.id, lessonId),
          eq(trainingLessons.courseId, courseId),
          inArray(trainingLessons.kind, ['rich', 'practical']),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .returning({ id: trainingLessons.id })
    if (!row) throw new Error('Rich-text lesson not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: updated.id,
    action: 'update',
    summary: 'Updated lesson content',
    after: { courseId },
  })
  revalidatePath(studioPath(courseId))
}

// Attach the PowerPoint master used directly by Collabora editing/playback.
export async function importLessonPptx(lessonId: string, courseId: string, attachmentId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')
  courseId = requireTrainingUuid(courseId, 'Course')
  attachmentId = requireTrainingUuid(attachmentId, 'PowerPoint attachment')
  await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    await requireOwnedPptxAttachment(tx, attachmentId)
    const [updated] = await tx
      .update(trainingLessons)
      .set({ sourceAttachmentId: attachmentId })
      .where(
        and(
          eq(trainingLessons.id, lessonId),
          eq(trainingLessons.courseId, courseId),
          eq(trainingLessons.kind, 'slides'),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .returning({ id: trainingLessons.id })
    if (!updated) throw new Error('Slideshow lesson not found.')
  })
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: lessonId,
    action: 'update',
    summary: 'Imported PowerPoint master',
    after: { courseId, attachmentId },
  })
  revalidatePath(studioPath(courseId))
}

export async function updateCourseSettings(courseId: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  courseId = requireTrainingUuid(courseId, 'Course')
  const name = requiredTrainingText(formData.get('name'), 'Course name', 200)
  const code = optionalTrainingText(formData.get('code'), 'Course code', 100) ?? ''
  const descriptionRaw = optionalTrainingText(
    formData.get('description'),
    'Course description',
    2_000_000,
  )
  const description = descriptionRaw ? sanitizeDocumentHtml(descriptionRaw) : null
  const deliveryType = requireTrainingEnum(
    formData.get('deliveryType'),
    DELIVERY_TYPES,
    'Delivery type',
  ) as DeliveryType
  const onlineUrlRaw = optionalTrainingText(formData.get('onlineUrl'), 'Course URL', 4_096)
  const onlineUrl = onlineUrlRaw ? await validateTrainingExternalUrl(onlineUrlRaw) : null
  const instructionsRaw = optionalTrainingText(
    formData.get('instructions'),
    'Course instructions',
    2_000_000,
  )
  const instructions = instructionsRaw ? sanitizeDocumentHtml(instructionsRaw) : null
  const durationMinutes = optionalTrainingInteger(
    formData.get('durationMinutes'),
    'Duration',
    MAX_TRAINING_DURATION_MINUTES,
  )
  const validForMonths = optionalTrainingInteger(
    formData.get('validForMonths'),
    'Validity',
    MAX_TRAINING_VALIDITY_MONTHS,
  )
  // Card Studio designs pinned to this course (any number; empty = tenant defaults).
  const credentialOutputIds = Array.from(
    new Set(
      formData
        .getAll('credentialOutputIds')
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  )
  if (credentialOutputIds.length > 20 || credentialOutputIds.some((id) => id.length > 120)) {
    throw new Error('Credential design selection is invalid.')
  }
  const updated = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    if (!tenant) throw new Error('Tenant not found.')
    const allowedOutputIds = new Set(
      enabledCredentialOutputs(tenant.settings).map((output) => output.id),
    )
    if (credentialOutputIds.some((id) => !allowedOutputIds.has(id))) {
      throw new Error('Credential design selection is invalid.')
    }
    const [existing] = await tx
      .select({ metadata: trainingCourses.metadata })
      .from(trainingCourses)
      .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
      .limit(1)
    if (!existing) throw new Error('Course not found.')
    const metadata = { ...(existing?.metadata ?? {}), credentialOutputIds }
    const [row] = await tx
      .update(trainingCourses)
      .set({
        name,
        code,
        deliveryType,
        description,
        onlineUrl,
        instructions,
        durationMinutes,
        validForMonths,
        requiresEvaluator: formData.get('requiresEvaluator') === 'on',
        metadata,
      })
      .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
      .returning({ id: trainingCourses.id })
    if (!row) throw new Error('Course not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_course',
    entityId: updated.id,
    action: 'update',
    summary: `Updated course "${name}"`,
    after: {
      code,
      deliveryType,
      durationMinutes,
      validForMonths,
      credentialOutputIds,
    },
  })
  revalidatePath(studioPath(courseId))
  revalidatePath(`/training/courses/${courseId}`)
}

export async function deleteLesson(lessonId: string, courseId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  lessonId = requireTrainingUuid(lessonId, 'Lesson')
  courseId = requireTrainingUuid(courseId, 'Course')
  const deck = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const [row] = await tx
      .select({
        sourceAttachmentId: trainingLessons.sourceAttachmentId,
      })
      .from(trainingLessons)
      .where(
        and(
          eq(trainingLessons.id, lessonId),
          eq(trainingLessons.courseId, courseId),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Lesson not found.')
    const [deleted] = await tx
      .update(trainingLessons)
      .set({ deletedAt: new Date(), sourceAttachmentId: null })
      .where(
        and(
          eq(trainingLessons.id, lessonId),
          eq(trainingLessons.courseId, courseId),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .returning({ id: trainingLessons.id })
    if (!deleted) throw new Error('Lesson changed while it was being deleted.')
    return row
  })
  const purged = await purgeDeckAssets(ctx.db, [deck])
  await recordAudit(ctx, {
    entityType: 'training_lesson',
    entityId: lessonId,
    action: 'delete',
    summary: 'Deleted lesson',
    metadata: { courseId, ...(purged ? { purgedAttachments: purged } : {}) },
  })
  revalidatePath(studioPath(courseId))
}

export async function reorderLessons(courseId: string, orderedIds: string[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  courseId = requireTrainingUuid(courseId, 'Course')
  orderedIds = parseTrainingOrder(orderedIds, 'Lesson')
  const moduleId = await ctx.db(async (tx) => {
    await requireActiveCourse(tx, courseId)
    const lessons = await tx
      .select({ id: trainingLessons.id, moduleId: trainingLessons.moduleId })
      .from(trainingLessons)
      .where(
        and(
          eq(trainingLessons.courseId, courseId),
          inArray(trainingLessons.id, orderedIds),
          isNull(trainingLessons.deletedAt),
        ),
      )
    if (lessons.length !== orderedIds.length) {
      throw new Error('Lesson order contains unrelated records.')
    }
    const moduleIds = new Set(lessons.map((lesson) => lesson.moduleId))
    if (moduleIds.size !== 1) throw new Error('Lessons can only be reordered within one module.')
    const targetModuleId = lessons[0]!.moduleId
    const moduleLessons = await tx
      .select({ id: trainingLessons.id })
      .from(trainingLessons)
      .where(
        and(
          eq(trainingLessons.courseId, courseId),
          eq(trainingLessons.moduleId, targetModuleId),
          isNull(trainingLessons.deletedAt),
        ),
      )
    assertExactTrainingOrder(
      moduleLessons.map((lesson) => lesson.id),
      orderedIds,
      'Lesson',
    )
    for (let i = 0; i < orderedIds.length; i++) {
      const [updated] = await tx
        .update(trainingLessons)
        .set({ sortOrder: i })
        .where(
          and(
            eq(trainingLessons.id, orderedIds[i]!),
            eq(trainingLessons.courseId, courseId),
            eq(trainingLessons.moduleId, targetModuleId),
            isNull(trainingLessons.deletedAt),
          ),
        )
        .returning({ id: trainingLessons.id })
      if (!updated) throw new Error('Lesson order changed while it was being saved.')
    }
    return targetModuleId
  })
  await recordAudit(ctx, {
    entityType: 'training_course_module',
    entityId: moduleId,
    action: 'update',
    summary: `Reordered ${orderedIds.length} lessons`,
    after: { courseId },
  })
  revalidatePath(studioPath(courseId))
}
