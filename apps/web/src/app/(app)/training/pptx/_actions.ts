'use server'

// Actions for PowerPoint-mastered training decks. Collabora Impress is the
// editor and the only playback engine; BeaconHS never rasterizes PPTX slides.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import {
  attachments,
  people,
  trainingContentItems,
  trainingEnrollments,
  trainingLessons,
} from '@beaconhs/db/schema'
import { deleteObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { PPTX_MIME_TYPE } from '@beaconhs/office/limits'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import {
  buildEditorUrl,
  buildPresentationUrl,
  getCollaboraEditUrl,
  getCollaboraViewUrl,
} from '@/lib/collabora'
import { mintWopiToken, type WopiDeckTarget } from '@/lib/wopi'
import { tenantIsActive } from '@/lib/active-tenant'
import { blankPptxBuffer } from '@/lib/pptx-blank'
import { requireTrainingUuid } from '@/lib/training-mutation-validation'
import { assertTrainingPptxAttachment } from '@/lib/training-pptx-policy'
import { loadDeckMaster, parseDeckTarget } from './_lib'

type PptxSession =
  | { ok: true; actionUrl: string; accessToken: string; accessTokenTtl: number }
  | {
      ok: false
      error:
        | 'not_configured'
        | 'no_master'
        | 'unknown_target'
        | 'workspace_unavailable'
        | 'impersonation_blocked'
        | 'access_denied'
    }

/**
 * Mint a WOPI session for the inline Collabora editor: resolves the deck's
 * master, the Collabora discovery URL, and a single-file access token.
 */
export async function getPptxEditorSession(
  targetRaw: string,
  targetId: string,
): Promise<PptxSession> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (ctx.impersonation) return { ok: false, error: 'impersonation_blocked' }
  if (!(await tenantIsActive(ctx.tenantId))) {
    return { ok: false, error: 'workspace_unavailable' }
  }
  const target = parseDeckTarget(targetRaw)
  if (!target) return { ok: false, error: 'unknown_target' }
  targetId = requireTrainingUuid(targetId, 'Deck')

  const master = await loadDeckMaster(ctx.db, target, targetId)
  if (!master) return { ok: false, error: 'no_master' }

  const editUrl = await getCollaboraEditUrl()
  if (!editUrl) return { ok: false, error: 'not_configured' }

  const { token, exp } = mintWopiToken({
    attachmentId: master.attachment.id,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userName: ctx.membership?.displayName ?? 'BeaconHS user',
    target,
    targetId,
    audience: 'author',
    courseId: null,
    enrollmentId: null,
    lessonId: null,
    canWrite: true,
    activeRoleId: ctx.activeRoleId ?? null,
  })
  return {
    ok: true,
    actionUrl: buildEditorUrl(editUrl, master.attachment.id),
    accessToken: token,
    accessTokenTtl: exp,
  }
}

async function createPlaybackSession(input: {
  target: WopiDeckTarget
  targetId: string
  courseId: string | null
  enrollmentId: string | null
  lessonId: string | null
  audience: 'author' | 'instructor' | 'learner'
}): Promise<PptxSession> {
  const ctx = await requireRequestContext()
  if (ctx.impersonation) return { ok: false, error: 'impersonation_blocked' }
  if (!(await tenantIsActive(ctx.tenantId))) {
    return { ok: false, error: 'workspace_unavailable' }
  }
  const master = await loadDeckMaster(ctx.db, input.target, input.targetId)
  if (!master) return { ok: false, error: 'no_master' }
  const viewUrl = await getCollaboraViewUrl()
  if (!viewUrl) return { ok: false, error: 'not_configured' }
  const { token, exp } = mintWopiToken({
    attachmentId: master.attachment.id,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userName: ctx.membership?.displayName ?? 'BeaconHS user',
    target: input.target,
    targetId: input.targetId,
    audience: input.audience,
    courseId: input.courseId,
    enrollmentId: input.enrollmentId,
    lessonId: input.lessonId,
    canWrite: false,
    activeRoleId: ctx.activeRoleId ?? null,
  })
  return {
    ok: true,
    actionUrl: buildPresentationUrl(viewUrl, master.attachment.id),
    accessToken: token,
    accessTokenTtl: exp,
  }
}

/** Read-only playback for an author previewing one deck. */
export async function getPptxAuthorPlaybackSession(
  targetRaw: string,
  targetId: string,
): Promise<PptxSession> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const target = parseDeckTarget(targetRaw)
  if (!target) return { ok: false, error: 'unknown_target' }
  targetId = requireTrainingUuid(targetId, 'Deck')
  return createPlaybackSession({
    target,
    targetId,
    audience: 'author',
    courseId: null,
    enrollmentId: null,
    lessonId: null,
  })
}

/** Read-only playback for course preview and live classroom presentation. */
export async function getPptxInstructorPlaybackSession(
  targetRaw: string,
  targetId: string,
  courseId: string,
): Promise<PptxSession> {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'training.class.manage') && !can(ctx, 'training.course.manage')) {
    return { ok: false, error: 'access_denied' }
  }
  const target = parseDeckTarget(targetRaw)
  if (!target) return { ok: false, error: 'unknown_target' }
  targetId = requireTrainingUuid(targetId, 'Deck')
  courseId = requireTrainingUuid(courseId, 'Course')
  const bound = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ id: trainingLessons.id })
      .from(trainingLessons)
      .where(
        and(
          eq(trainingLessons.courseId, courseId),
          target === 'lesson'
            ? eq(trainingLessons.id, targetId)
            : eq(trainingLessons.contentItemId, targetId),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .limit(1)
    return Boolean(row)
  })
  if (!bound) return { ok: false, error: 'access_denied' }
  return createPlaybackSession({
    target,
    targetId,
    audience: 'instructor',
    courseId,
    enrollmentId: null,
    lessonId: null,
  })
}

/** Read-only playback bound to the signed-in learner's concrete enrollment. */
export async function getPptxLearnerPlaybackSession(
  lessonId: string,
  enrollmentId: string,
): Promise<PptxSession> {
  const ctx = await requireRequestContext()
  lessonId = requireTrainingUuid(lessonId, 'Lesson')
  enrollmentId = requireTrainingUuid(enrollmentId, 'Enrollment')
  const binding = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        courseId: trainingEnrollments.courseId,
        enrollmentStatus: trainingEnrollments.status,
        personStatus: people.status,
        contentItemId: trainingLessons.contentItemId,
      })
      .from(trainingEnrollments)
      .innerJoin(people, eq(people.id, trainingEnrollments.personId))
      .innerJoin(
        trainingLessons,
        and(
          eq(trainingLessons.id, lessonId),
          eq(trainingLessons.courseId, trainingEnrollments.courseId),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .where(
        and(
          eq(trainingEnrollments.id, enrollmentId),
          eq(people.userId, ctx.userId),
          isNull(trainingEnrollments.deletedAt),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
    return row ?? null
  })
  if (
    !binding ||
    binding.personStatus !== 'active' ||
    binding.enrollmentStatus === 'withdrawn' ||
    binding.enrollmentStatus === 'expired'
  ) {
    return { ok: false, error: 'access_denied' }
  }
  return createPlaybackSession({
    target: binding.contentItemId ? 'content_item' : 'lesson',
    targetId: binding.contentItemId ?? lessonId,
    audience: 'learner',
    courseId: binding.courseId,
    enrollmentId,
    lessonId,
  })
}

/**
 * Start a new deck: create a blank .pptx master for a slides lesson / library
 * item. Replaces any existing master; the PPTX remains the single source of
 * truth and Collabora renders it directly.
 */
export async function createBlankDeckMaster(targetRaw: string, targetId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const target = parseDeckTarget(targetRaw)
  if (!target) throw new Error('Unknown deck target')
  targetId = requireTrainingUuid(targetId, 'Deck')

  const pptx = blankPptxBuffer()
  assertTrainingPptxAttachment({
    kind: 'document',
    contentType: PPTX_MIME_TYPE,
    sizeBytes: pptx.length,
  })

  const targetMetadata = await ctx.db(async (tx) => {
    let title = 'Presentation'
    let revalidate = '/training/library'
    if (target === 'lesson') {
      const [row] = await tx
        .select({ title: trainingLessons.title, courseId: trainingLessons.courseId })
        .from(trainingLessons)
        .where(
          and(
            eq(trainingLessons.id, targetId),
            eq(trainingLessons.kind, 'slides'),
            isNull(trainingLessons.deletedAt),
          ),
        )
        .limit(1)
      if (!row) throw new Error('Lesson not found')
      title = row.title || title
      revalidate = `/training/courses/${row.courseId}`
    } else {
      const [row] = await tx
        .select({ title: trainingContentItems.title })
        .from(trainingContentItems)
        .where(
          and(
            eq(trainingContentItems.id, targetId),
            eq(trainingContentItems.kind, 'slides'),
            isNull(trainingContentItems.deletedAt),
          ),
        )
        .limit(1)
      if (!row) throw new Error('Library item not found')
      title = row.title || title
      revalidate = `/training/library/${targetId}`
    }
    return { title, revalidate }
  })

  const filename = `${targetMetadata.title.replace(/[^\w.\- ]+/g, '').trim() || 'Presentation'}.pptx`
  const key = newAttachmentKey({ tenantId, kind: 'document', filename })
  await putObject({ key, body: pptx, contentType: PPTX_MIME_TYPE })
  let attachmentId: string
  try {
    attachmentId = await ctx.db(async (tx) => {
      const [att] = await tx
        .insert(attachments)
        .values({
          tenantId,
          uploadedBy: ctx.userId,
          kind: 'document',
          r2Key: key,
          contentType: PPTX_MIME_TYPE,
          sizeBytes: pptx.length,
          filename,
        })
        .returning({ id: attachments.id })
      if (!att) throw new Error('Failed to create the presentation file')

      const table = target === 'lesson' ? trainingLessons : trainingContentItems
      const [updated] = await tx
        .update(table)
        .set({ sourceAttachmentId: att.id })
        .where(and(eq(table.id, targetId), eq(table.kind, 'slides'), isNull(table.deletedAt)))
        .returning({ id: table.id })
      if (!updated) throw new Error('Slideshow target was removed before deck creation')
      return att.id
    })
  } catch (error) {
    await deleteObject({ key }).catch(() => undefined)
    throw error
  }

  await recordAudit(ctx, {
    entityType: target === 'lesson' ? 'training_lesson' : 'training_content_item',
    entityId: targetId,
    action: 'update',
    summary: 'Started a new PowerPoint deck',
    after: { attachmentId },
  })
  revalidatePath(targetMetadata.revalidate)
}
