'use server'

// Server actions for /people/titles admin pages — CRUD + per-title task list
// + per-person task acknowledgements. Mirrors the legacy
// `PeopleJobTitleApiController` (postData, postTasks, getTasks, saveTasks,
// generatePDF) but breaks ownership cleanly between titles and tasks.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import { normalizeCatalogDisplayName, normalizedCatalogNameSql, type Database } from '@beaconhs/db'
import {
  attachments,
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  complianceObligations,
  people,
  personTitleAssignments,
  personTitles,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { getPersonSyncOrigin } from '@/lib/people-sync'
import {
  lockJobTitleObligations,
  materializeLockedJobTitleObligations,
} from '@/lib/job-title-compliance'
import { assertCanActOnPerson } from '../_lib/person-access'
import { refreshPersonTitleCache } from '../_lib/person-assignments'

const DUPLICATE_TITLE_ERROR = 'A job title with this name already exists.'

function isDuplicateTitleName(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('person_titles_tenant_normalized_name_ux')
}

// ---------- title CRUD --------------------------------------------------

export async function createTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = normalizeCatalogDisplayName(formData.get('name'))
  const description = String(formData.get('description') ?? '').trim() || null
  const responsibilities = String(formData.get('responsibilities') ?? '').trim() || null
  const education = String(formData.get('education') ?? '').trim() || null
  const experience = String(formData.get('experience') ?? '').trim() || null
  if (!name) return
  const duplicate = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ id: personTitles.id })
      .from(personTitles)
      .where(
        eq(normalizedCatalogNameSql(personTitles.name), normalizedCatalogNameSql(sql`${name}`)),
      )
      .limit(1)
    return row ?? null
  })
  if (duplicate) {
    redirect(`/people/titles/new?error=${encodeURIComponent(DUPLICATE_TITLE_ERROR)}`)
  }
  let row: typeof personTitles.$inferSelect | undefined
  try {
    row = await ctx.db(async (tx) => {
      const [created] = await tx
        .insert(personTitles)
        .values({
          tenantId: ctx.tenantId,
          name,
          description,
          responsibilities,
          education,
          experience,
        })
        .returning()
      if (!created) throw new Error('Job title could not be created')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person_title',
        entityId: created.id,
        action: 'create',
        summary: `Added title "${name}"`,
        after: { name, description, responsibilities, education, experience },
      })
      return created
    })
  } catch (error) {
    if (isDuplicateTitleName(error)) {
      redirect(`/people/titles/new?error=${encodeURIComponent(DUPLICATE_TITLE_ERROR)}`)
    }
    throw error
  }
  revalidatePath('/people/titles')
  if (row) redirect(`/people/titles/${row.id}`)
}

export async function updateTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = normalizeCatalogDisplayName(formData.get('name'))
  const description = String(formData.get('description') ?? '').trim() || null
  const responsibilities = String(formData.get('responsibilities') ?? '').trim() || null
  const education = String(formData.get('education') ?? '').trim() || null
  const experience = String(formData.get('experience') ?? '').trim() || null
  if (!name) return
  const duplicate = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ id: personTitles.id })
      .from(personTitles)
      .where(
        and(
          ne(personTitles.id, id),
          eq(normalizedCatalogNameSql(personTitles.name), normalizedCatalogNameSql(sql`${name}`)),
        ),
      )
      .limit(1)
    return row ?? null
  })
  if (duplicate) {
    redirect(`/people/titles/${id}?error=${encodeURIComponent(DUPLICATE_TITLE_ERROR)}`)
  }
  let updated = false
  try {
    updated = await ctx.db(async (tx) => {
      const [before] = await tx
        .select()
        .from(personTitles)
        .where(and(eq(personTitles.id, id), isNull(personTitles.deletedAt)))
        .limit(1)
        .for('update')
      if (!before) return false
      if (
        before.name === name &&
        before.description === description &&
        before.responsibilities === responsibilities &&
        before.education === education &&
        before.experience === experience
      ) {
        return false
      }
      await tx
        .update(personTitles)
        .set({ name, description, responsibilities, education, experience })
        .where(eq(personTitles.id, id))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person_title',
        entityId: id,
        action: 'update',
        summary: `Updated title "${name}"`,
        before: before as unknown as Record<string, unknown>,
        after: { name, description, responsibilities, education, experience },
      })
      return true
    })
  } catch (error) {
    if (isDuplicateTitleName(error)) {
      redirect(`/people/titles/${id}?error=${encodeURIComponent(DUPLICATE_TITLE_ERROR)}`)
    }
    throw error
  }
  if (!updated) return
  revalidatePath(`/people/titles/${id}`)
  revalidatePath('/people/titles')
}

export async function archiveTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const result = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(personTitles)
      .where(and(eq(personTitles.id, id), isNull(personTitles.deletedAt)))
      .limit(1)
      .for('update')
    if (!row) return { row: null, blockers: [] as string[] }

    const [assignment] = await tx
      .select({ id: personTitleAssignments.id })
      .from(personTitleAssignments)
      .where(eq(personTitleAssignments.titleId, id))
      .limit(1)
    const [task] = await tx
      .select({ id: jobTitleTasks.id })
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.titleId, id), isNull(jobTitleTasks.deletedAt)))
      .limit(1)
    const [obligation] = await tx
      .select({ id: complianceObligations.id })
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.sourceModule, 'job_title_signoff'),
          isNull(complianceObligations.deletedAt),
          ne(complianceObligations.status, 'archived'),
          sql`${complianceObligations.targetRef} ->> 'jobTitleId' = ${id}`,
        ),
      )
      .limit(1)
    const blockers = [
      assignment ? 'assigned people' : null,
      task ? 'active tasks' : null,
      obligation ? 'active compliance obligations' : null,
    ].filter((value): value is string => Boolean(value))
    if (blockers.length > 0) return { row, blockers }

    const archivedAt = new Date()
    await tx.update(personTitles).set({ deletedAt: archivedAt }).where(eq(personTitles.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person_title',
      entityId: id,
      action: 'archive',
      summary: `Archived title "${row.name}"`,
      before: row as unknown as Record<string, unknown>,
      after: { deletedAt: archivedAt.toISOString() },
    })
    return { row, blockers }
  })
  if (result.blockers.length > 0) {
    redirect(
      `/people/titles/${id}?error=${encodeURIComponent(`Archive blocked: remove ${result.blockers.join(', ')} first.`)}`,
    )
  }
  if (!result.row) redirect('/people/titles')
  revalidatePath('/people/titles')
  redirect('/people/titles')
}

export async function restoreTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const restored = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(personTitles)
      .where(and(eq(personTitles.id, id), sql`${personTitles.deletedAt} is not null`))
      .limit(1)
      .for('update')
    if (!before) return null
    await tx.update(personTitles).set({ deletedAt: null }).where(eq(personTitles.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person_title',
      entityId: id,
      action: 'update',
      summary: `Restored title "${before.name}"`,
      before: { deletedAt: before.deletedAt?.toISOString() ?? null },
      after: { deletedAt: null },
    })
    return before
  })
  if (!restored) redirect('/people/titles')
  revalidatePath('/people/titles')
  redirect(`/people/titles/${id}`)
}

// ---------- title assignment --------------------------------------------

export async function unassignTitleFromPerson(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const titleId = String(formData.get('titleId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!titleId || !personId) return
  const removed = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), isNull(people.deletedAt)))
      .limit(1)
      .for('update')
    if (!person) throw new Error('Person not found')
    if (await getPersonSyncOrigin(tx, personId)) {
      throw new Error('Title assignments are managed by an external sync and are read-only')
    }
    const [assignment] = await tx
      .select({ id: personTitleAssignments.id })
      .from(personTitleAssignments)
      .where(
        and(
          eq(personTitleAssignments.titleId, titleId),
          eq(personTitleAssignments.personId, personId),
        ),
      )
      .limit(1)
      .for('update')
    if (!assignment) return false
    const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [titleId])
    await tx
      .update(personTitleAssignments)
      .set({ isManuallyMaintained: true, sourceConnectionId: null })
      .where(eq(personTitleAssignments.personId, personId))
    const [deleted] = await tx
      .delete(personTitleAssignments)
      .where(eq(personTitleAssignments.id, assignment.id))
      .returning({ id: personTitleAssignments.id })
    if (!deleted) return false
    await promotePrimaryTitleIfNeeded(tx, personId)
    await refreshPersonTitleCache(tx, ctx.tenantId, [personId])
    await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      entityId: personId,
      action: 'update',
      summary: 'Unassigned title',
      metadata: { titleId },
    })
    return true
  })
  if (!removed) return
  revalidatePath(`/people/${personId}`)
  revalidatePath(`/people/titles/${titleId}`)
}

// ---------- per-title task list -----------------------------------------

export async function addTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const titleId = String(formData.get('titleId') ?? '')
  const task = String(formData.get('task') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  if (!titleId || !task) return
  const row = await ctx.db(async (tx) => {
    const [title] = await tx
      .select({ id: personTitles.id })
      .from(personTitles)
      .where(and(eq(personTitles.id, titleId), isNull(personTitles.deletedAt)))
      .limit(1)
      .for('update')
    if (!title) throw new Error('Job title is no longer active')
    const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [titleId])
    const [max] = await tx
      .select({ m: sql<number>`COALESCE(MAX(entity_order), 0)` })
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.titleId, titleId), isNull(jobTitleTasks.deletedAt)))
    const [created] = await tx
      .insert(jobTitleTasks)
      .values({
        tenantId: ctx.tenantId,
        titleId,
        task,
        description,
        entityOrder: Number(max?.m ?? 0) + 1,
      })
      .returning()
    if (!created) throw new Error('Job-title task could not be created')
    await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'job_title_task',
      entityId: created.id,
      action: 'create',
      summary: `Added task "${task.slice(0, 60)}"`,
      after: { titleId, task, description },
    })
    return created
  })
  if (!row) return
  revalidatePath(`/people/titles/${titleId}/tasks`)
  revalidatePath(`/people/titles/${titleId}`)
}

export async function updateTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const task = String(formData.get('task') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  if (!task) return
  const result = await ctx.db(async (tx) => {
    const [before] = await tx
      .select()
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.id, id), isNull(jobTitleTasks.deletedAt)))
      .limit(1)
      .for('update')
    if (!before) return { before: null, blocked: false }
    if (before.task === task && before.description === description) {
      return { before, blocked: false }
    }
    const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [before.titleId])
    const [acknowledgment] = await tx
      .select({ id: jobTitleTaskAcknowledgments.id })
      .from(jobTitleTaskAcknowledgments)
      .where(eq(jobTitleTaskAcknowledgments.taskId, id))
      .limit(1)
    if (acknowledgment) return { before, blocked: true }
    await tx.update(jobTitleTasks).set({ task, description }).where(eq(jobTitleTasks.id, id))
    await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'job_title_task',
      entityId: id,
      action: 'update',
      summary: `Updated task "${task.slice(0, 60)}"`,
      before: before as unknown as Record<string, unknown>,
      after: { task, description },
    })
    return { before, blocked: false }
  })
  const before = result.before
  if (!before) return
  if (result.blocked) {
    redirect(
      `/people/titles/${before.titleId}/tasks?error=${encodeURIComponent(
        'This task has acknowledgements and cannot be rewritten. Archive it and add a replacement task.',
      )}`,
    )
  }
  if (before.task === task && before.description === description) return
  if (before?.titleId) {
    revalidatePath(`/people/titles/${before.titleId}/tasks`)
    revalidatePath(`/people/titles/${before.titleId}`)
  }
}

export async function archiveTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.id, id), isNull(jobTitleTasks.deletedAt)))
      .limit(1)
      .for('update')
    if (!row) return null
    const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [row.titleId])
    const archivedAt = new Date()
    await tx.update(jobTitleTasks).set({ deletedAt: archivedAt }).where(eq(jobTitleTasks.id, id))
    await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'job_title_task',
      entityId: id,
      action: 'archive',
      summary: `Archived task "${row.task.slice(0, 60)}"`,
      before: row as unknown as Record<string, unknown>,
      after: { deletedAt: archivedAt.toISOString() },
    })
    return row
  })
  if (!before) return
  if (before?.titleId) {
    revalidatePath(`/people/titles/${before.titleId}/tasks`)
    revalidatePath(`/people/titles/${before.titleId}`)
  }
}

export async function restoreTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const restored = await ctx.db(async (tx) => {
    const [task] = await tx
      .select({ row: jobTitleTasks, titleDeletedAt: personTitles.deletedAt })
      .from(jobTitleTasks)
      .innerJoin(personTitles, eq(personTitles.id, jobTitleTasks.titleId))
      .where(and(eq(jobTitleTasks.id, id), sql`${jobTitleTasks.deletedAt} is not null`))
      .limit(1)
      .for('update')
    if (!task) return null
    if (task.titleDeletedAt) throw new Error('Restore the job title before restoring its task')
    const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [task.row.titleId])
    await tx.update(jobTitleTasks).set({ deletedAt: null }).where(eq(jobTitleTasks.id, id))
    await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'job_title_task',
      entityId: id,
      action: 'update',
      summary: `Restored task "${task.row.task.slice(0, 60)}"`,
      before: { deletedAt: task.row.deletedAt?.toISOString() ?? null },
      after: { deletedAt: null },
    })
    return task.row
  })
  if (!restored) return
  revalidatePath(`/people/titles/${restored.titleId}/tasks`)
  revalidatePath(`/people/titles/${restored.titleId}`)
}

export async function reorderTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!id || (direction !== 'up' && direction !== 'down')) return
  const titleId = await ctx.db(async (tx) => {
    const [self] = await tx
      .select({ id: jobTitleTasks.id, titleId: jobTitleTasks.titleId })
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.id, id), isNull(jobTitleTasks.deletedAt)))
      .limit(1)
    if (!self) return null
    const [title] = await tx
      .select({ id: personTitles.id })
      .from(personTitles)
      .where(and(eq(personTitles.id, self.titleId), isNull(personTitles.deletedAt)))
      .limit(1)
      .for('update')
    if (!title) return null
    const ordered = await tx
      .select()
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.titleId, self.titleId), isNull(jobTitleTasks.deletedAt)))
      .orderBy(asc(jobTitleTasks.entityOrder), asc(jobTitleTasks.createdAt), asc(jobTitleTasks.id))
      .for('update')
    const currentIndex = ordered.findIndex((task) => task.id === id)
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return null
    const beforeOrder = ordered.map((task) => task.id)
    ;[ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[currentIndex]!]
    for (const [index, task] of ordered.entries()) {
      await tx
        .update(jobTitleTasks)
        .set({ entityOrder: index + 1 })
        .where(eq(jobTitleTasks.id, task.id))
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'job_title_task',
      entityId: id,
      action: 'update',
      summary: `Moved job-title task ${direction}`,
      before: { order: beforeOrder },
      after: { order: ordered.map((task) => task.id) },
    })
    return self.titleId
  })
  if (titleId) revalidatePath(`/people/titles/${titleId}/tasks`)
}

// ---------- per-person acknowledgements ---------------------------------

export async function acknowledgeTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const taskId = String(formData.get('taskId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  const signatureDataUrl = String(formData.get('signatureDataUrl') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!taskId || !personId) return
  // Acknowledgements are compliance sign-offs: only a people-module manager may
  // record one on someone else's behalf; everyone else can only sign for their
  // own linked person record.
  assertCanActOnPerson(ctx, personId)
  const task = await withStoredSignatureAttachment(
    ctx,
    signatureDataUrl,
    async (tx, attachmentId) => {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, personId), isNull(people.deletedAt)))
        .limit(1)
        .for('update')
      if (!person) throw new Error('Person not found')
      const [currentTask] = await tx
        .select()
        .from(jobTitleTasks)
        .where(and(eq(jobTitleTasks.id, taskId), isNull(jobTitleTasks.deletedAt)))
        .limit(1)
        .for('update')
      if (!currentTask) throw new Error('Task is no longer active')
      const [currentAssignment] = await tx
        .select({ id: personTitleAssignments.id })
        .from(personTitleAssignments)
        .where(
          and(
            eq(personTitleAssignments.titleId, currentTask.titleId),
            eq(personTitleAssignments.personId, personId),
          ),
        )
        .limit(1)
      if (!currentAssignment) throw new Error('Person no longer holds the title for this task')
      const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [
        currentTask.titleId,
      ])
      const [existing] = await tx
        .select({ id: jobTitleTaskAcknowledgments.id })
        .from(jobTitleTaskAcknowledgments)
        .where(
          and(
            eq(jobTitleTaskAcknowledgments.taskId, taskId),
            eq(jobTitleTaskAcknowledgments.personId, personId),
          ),
        )
        .limit(1)
      if (existing) {
        // Double submissions are idempotent. If this request uploaded a fresh
        // signature before discovering the existing evidence, delete its
        // attachment row so the durable storage-deletion worker removes the
        // unreferenced object after commit.
        if (attachmentId) {
          await tx
            .delete(attachments)
            .where(and(eq(attachments.id, attachmentId), eq(attachments.kind, 'signature')))
        }
        return currentTask
      }
      const [created] = await tx
        .insert(jobTitleTaskAcknowledgments)
        .values({
          tenantId: ctx.tenantId,
          taskId,
          personId,
          signatureAttachmentId: attachmentId,
          notes,
        })
        .returning({
          id: jobTitleTaskAcknowledgments.id,
        })
      if (!created) throw new Error('Task acknowledgment could not be saved')
      await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: personId,
        action: 'sign',
        summary: `Acknowledged task "${currentTask.task.slice(0, 60)}"`,
        metadata: { taskId, titleId: currentTask.titleId },
      })
      return currentTask
    },
  )
  revalidatePath(`/people/${personId}`)
  revalidatePath(`/people/titles/${task.titleId}/tasks`)
}

export async function revokeTitleTaskAck(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const taskId = String(formData.get('taskId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!taskId || !personId) return
  assertCanActOnPerson(ctx, personId)
  const task = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), isNull(people.deletedAt)))
      .limit(1)
      .for('update')
    if (!person) throw new Error('Person not found')
    const [currentTask] = await tx
      .select()
      .from(jobTitleTasks)
      .where(and(eq(jobTitleTasks.id, taskId), isNull(jobTitleTasks.deletedAt)))
      .limit(1)
      .for('update')
    if (!currentTask) throw new Error('Only active task acknowledgements can be revoked')
    const lockedObligations = await lockJobTitleObligations(tx, ctx.tenantId, [currentTask.titleId])
    const [acknowledgment] = await tx
      .select({
        id: jobTitleTaskAcknowledgments.id,
        signatureAttachmentId: jobTitleTaskAcknowledgments.signatureAttachmentId,
      })
      .from(jobTitleTaskAcknowledgments)
      .where(
        and(
          eq(jobTitleTaskAcknowledgments.taskId, taskId),
          eq(jobTitleTaskAcknowledgments.personId, personId),
        ),
      )
      .limit(1)
      .for('update')
    if (!acknowledgment) return null
    await tx
      .delete(jobTitleTaskAcknowledgments)
      .where(eq(jobTitleTaskAcknowledgments.id, acknowledgment.id))
    if (acknowledgment.signatureAttachmentId) {
      await tx
        .delete(attachments)
        .where(
          and(
            eq(attachments.id, acknowledgment.signatureAttachmentId),
            eq(attachments.kind, 'signature'),
          ),
        )
    }
    await materializeLockedJobTitleObligations(tx, ctx.tenantId, lockedObligations)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person',
      entityId: personId,
      action: 'update',
      summary: 'Revoked task acknowledgment',
      metadata: { taskId, titleId: currentTask.titleId },
    })
    return currentTask
  })
  if (!task) return
  revalidatePath(`/people/${personId}`)
  revalidatePath(`/people/titles/${task.titleId}/tasks`)
}

// ---------- cache refresh ------------------------------------------------

async function promotePrimaryTitleIfNeeded(tx: Database, personId: string): Promise<void> {
  const assignments = await tx
    .select({ id: personTitleAssignments.id, isPrimary: personTitleAssignments.isPrimary })
    .from(personTitleAssignments)
    .innerJoin(personTitles, eq(personTitles.id, personTitleAssignments.titleId))
    .where(eq(personTitleAssignments.personId, personId))
    .orderBy(asc(personTitles.name), asc(personTitleAssignments.titleId))
  if (
    assignments.length === 0 ||
    assignments.some((row: { isPrimary: boolean }) => row.isPrimary)
  ) {
    return
  }
  await tx
    .update(personTitleAssignments)
    .set({ isPrimary: true })
    .where(eq(personTitleAssignments.id, assignments[0]!.id))
}
