'use server'

// Server actions for /people/titles admin pages — CRUD + per-title task list
// + per-person task acknowledgements. Mirrors the legacy
// `PeopleJobTitleApiController` (postData, postTasks, getTasks, saveTasks,
// generatePDF) but breaks ownership cleanly between titles and tasks.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  personTitleAssignments,
  personTitles,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { storeSignatureValue } from '@/lib/signature-storage'
import { assertCanActOnPerson } from '../_lib/person-access'

// ---------- title CRUD --------------------------------------------------

export async function createTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const responsibilities = String(formData.get('responsibilities') ?? '').trim() || null
  const education = String(formData.get('education') ?? '').trim() || null
  const experience = String(formData.get('experience') ?? '').trim() || null
  if (!name) return
  const [row] = await ctx.db((tx) =>
    tx
      .insert(personTitles)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        responsibilities,
        education,
        experience,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'person_title',
      entityId: row.id,
      action: 'create',
      summary: `Added title "${name}"`,
      after: { name, description, responsibilities, education, experience },
    })
  }
  revalidatePath('/people/titles')
  if (row) redirect(`/people/titles/${row.id}`)
}

export async function updateTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const responsibilities = String(formData.get('responsibilities') ?? '').trim() || null
  const education = String(formData.get('education') ?? '').trim() || null
  const experience = String(formData.get('experience') ?? '').trim() || null
  if (!name) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(personTitles).where(eq(personTitles.id, id)).limit(1)
    return r
  })
  await ctx.db((tx) =>
    tx
      .update(personTitles)
      .set({ name, description, responsibilities, education, experience })
      .where(eq(personTitles.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'person_title',
    entityId: id,
    action: 'update',
    summary: `Updated title "${name}"`,
    before: before as unknown as Record<string, unknown>,
    after: { name, description, responsibilities, education, experience },
  })
  revalidatePath(`/people/titles/${id}`)
  revalidatePath('/people/titles')
}

export async function deleteTitle(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(personTitles).where(eq(personTitles.id, id)).limit(1)
    const assigned = await tx
      .select({ personId: personTitleAssignments.personId })
      .from(personTitleAssignments)
      .where(eq(personTitleAssignments.titleId, id))
    return { row: r, assigned: assigned.map((a) => a.personId) }
  })
  await ctx.db(async (tx) => {
    await tx.delete(personTitles).where(eq(personTitles.id, id))
    if (before.assigned.length > 0) {
      await refreshTitleCache(tx, ctx.tenantId, before.assigned)
    }
  })
  await recordAudit(ctx, {
    entityType: 'person_title',
    entityId: id,
    action: 'delete',
    summary: `Deleted title${before.row ? ` "${before.row.name}"` : ''}`,
    before: before.row as unknown as Record<string, unknown>,
  })
  revalidatePath('/people/titles')
  redirect('/people/titles')
}

// ---------- title assignment --------------------------------------------

/**
 * Set a person's full set of held titles in one shot — the write half of the
 * inline "Titles" multi-select on the person overview. Diffs against current
 * assignments, adds/removes the delta, and guarantees exactly one primary
 * survives whenever the person still holds at least one title.
 */
export async function setPersonTitles(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const personId = String(formData.get('id') ?? '')
  if (!personId) return
  const titleIds = Array.from(new Set(formData.getAll('value').map(String).filter(Boolean)))

  await ctx.db(async (tx) => {
    const existing = await tx
      .select()
      .from(personTitleAssignments)
      .where(eq(personTitleAssignments.personId, personId))
    const existingIds = existing.map((r) => r.titleId)
    const toRemove = existingIds.filter((t) => !titleIds.includes(t))
    const toAdd = titleIds.filter((t) => !existingIds.includes(t))
    if (toRemove.length > 0) {
      await tx
        .delete(personTitleAssignments)
        .where(
          and(
            eq(personTitleAssignments.personId, personId),
            inArray(personTitleAssignments.titleId, toRemove),
          ),
        )
    }
    if (toAdd.length > 0) {
      await tx
        .insert(personTitleAssignments)
        .values(toAdd.map((titleId) => ({ tenantId: ctx.tenantId, titleId, personId })))
        .onConflictDoNothing()
    }
    // Keep the primary invariant: if nothing is flagged primary but titles remain
    // (e.g. the primary was just removed), promote the first survivor.
    const remaining = await tx
      .select()
      .from(personTitleAssignments)
      .where(eq(personTitleAssignments.personId, personId))
      .orderBy(asc(personTitleAssignments.createdAt))
    if (remaining.length > 0 && !remaining.some((r) => r.isPrimary)) {
      await tx
        .update(personTitleAssignments)
        .set({ isPrimary: true })
        .where(
          and(
            eq(personTitleAssignments.personId, personId),
            eq(personTitleAssignments.titleId, remaining[0]!.titleId),
          ),
        )
    }
    await refreshTitleCache(tx, ctx.tenantId, [personId])
  })
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: 'Updated title assignments',
    after: { titleIds },
  })
  revalidatePath(`/people/${personId}`)
}

export async function unassignTitleFromPerson(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const titleId = String(formData.get('titleId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!titleId || !personId) return
  await ctx.db(async (tx) => {
    await tx
      .delete(personTitleAssignments)
      .where(
        and(
          eq(personTitleAssignments.titleId, titleId),
          eq(personTitleAssignments.personId, personId),
        ),
      )
    await refreshTitleCache(tx, ctx.tenantId, [personId])
  })
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: 'Unassigned title',
    metadata: { titleId },
  })
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
  // append at the end
  const next = await ctx.db(async (tx) => {
    const [max] = await tx
      .select({ m: sql<number>`COALESCE(MAX(entity_order), 0)` })
      .from(jobTitleTasks)
      .where(eq(jobTitleTasks.titleId, titleId))
    return Number(max?.m ?? 0) + 1
  })
  const [row] = await ctx.db((tx) =>
    tx
      .insert(jobTitleTasks)
      .values({
        tenantId: ctx.tenantId,
        titleId,
        task,
        description,
        entityOrder: next,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'job_title_task',
      entityId: row.id,
      action: 'create',
      summary: `Added task "${task.slice(0, 60)}"`,
      after: { titleId, task, description },
    })
  }
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
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobTitleTasks).where(eq(jobTitleTasks.id, id)).limit(1)
    return r
  })
  await ctx.db((tx) =>
    tx.update(jobTitleTasks).set({ task, description }).where(eq(jobTitleTasks.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'job_title_task',
    entityId: id,
    action: 'update',
    summary: `Updated task "${task.slice(0, 60)}"`,
    before: before as unknown as Record<string, unknown>,
    after: { task, description },
  })
  if (before?.titleId) {
    revalidatePath(`/people/titles/${before.titleId}/tasks`)
    revalidatePath(`/people/titles/${before.titleId}`)
  }
}

export async function deleteTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobTitleTasks).where(eq(jobTitleTasks.id, id)).limit(1)
    return r
  })
  await ctx.db((tx) => tx.delete(jobTitleTasks).where(eq(jobTitleTasks.id, id)))
  await recordAudit(ctx, {
    entityType: 'job_title_task',
    entityId: id,
    action: 'delete',
    summary: `Deleted task${before?.task ? ` "${before.task.slice(0, 60)}"` : ''}`,
    before: before as unknown as Record<string, unknown>,
  })
  if (before?.titleId) {
    revalidatePath(`/people/titles/${before.titleId}/tasks`)
    revalidatePath(`/people/titles/${before.titleId}`)
  }
}

export async function reorderTitleTask(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!id || (direction !== 'up' && direction !== 'down')) return
  await ctx.db(async (tx) => {
    const [self] = await tx.select().from(jobTitleTasks).where(eq(jobTitleTasks.id, id)).limit(1)
    if (!self) return
    const siblings = await tx
      .select()
      .from(jobTitleTasks)
      .where(eq(jobTitleTasks.titleId, self.titleId))
      .orderBy(asc(jobTitleTasks.entityOrder), asc(jobTitleTasks.createdAt))
    const idx = siblings.findIndex((s) => s.id === id)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return
    const a = siblings[idx]
    const b = siblings[swapIdx]
    if (!a || !b) return
    await tx
      .update(jobTitleTasks)
      .set({ entityOrder: b.entityOrder })
      .where(eq(jobTitleTasks.id, a.id))
    await tx
      .update(jobTitleTasks)
      .set({ entityOrder: a.entityOrder })
      .where(eq(jobTitleTasks.id, b.id))
    revalidatePath(`/people/titles/${self.titleId}/tasks`)
  })
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
  const { task, holdsTitle } = await ctx.db(async (tx) => {
    const [t] = await tx.select().from(jobTitleTasks).where(eq(jobTitleTasks.id, taskId)).limit(1)
    if (!t) return { task: null, holdsTitle: false }
    const [a] = await tx
      .select({ id: personTitleAssignments.id })
      .from(personTitleAssignments)
      .where(
        and(
          eq(personTitleAssignments.titleId, t.titleId),
          eq(personTitleAssignments.personId, personId),
        ),
      )
      .limit(1)
    return { task: t, holdsTitle: Boolean(a) }
  })
  if (!task) throw new Error('Task not found')
  if (!holdsTitle) throw new Error('Person does not hold the title for this task')
  const storedSignature = await storeSignatureValue(ctx.tenantId, signatureDataUrl)
  await ctx.db((tx) =>
    tx
      .insert(jobTitleTaskAcknowledgments)
      .values({
        tenantId: ctx.tenantId,
        taskId,
        personId,
        signatureDataUrl: storedSignature,
        notes,
      })
      .onConflictDoUpdate({
        target: [jobTitleTaskAcknowledgments.taskId, jobTitleTaskAcknowledgments.personId],
        set: {
          acknowledgedAt: new Date(),
          signatureDataUrl: storedSignature,
          notes,
        },
      }),
  )
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'sign',
    summary: `Acknowledged task "${task?.task?.slice(0, 60) ?? ''}"`,
    metadata: { taskId, titleId: task?.titleId },
  })
  revalidatePath(`/people/${personId}`)
  if (task?.titleId) revalidatePath(`/people/titles/${task.titleId}/tasks`)
}

export async function revokeTitleTaskAck(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const taskId = String(formData.get('taskId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!taskId || !personId) return
  assertCanActOnPerson(ctx, personId)
  const task = await ctx.db(async (tx) => {
    const [t] = await tx.select().from(jobTitleTasks).where(eq(jobTitleTasks.id, taskId)).limit(1)
    return t
  })
  await ctx.db((tx) =>
    tx
      .delete(jobTitleTaskAcknowledgments)
      .where(
        and(
          eq(jobTitleTaskAcknowledgments.taskId, taskId),
          eq(jobTitleTaskAcknowledgments.personId, personId),
        ),
      ),
  )
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: 'Revoked task acknowledgment',
    metadata: { taskId, titleId: task?.titleId },
  })
  revalidatePath(`/people/${personId}`)
  if (task?.titleId) revalidatePath(`/people/titles/${task.titleId}/tasks`)
}

// ---------- cache refresh ------------------------------------------------

async function refreshTitleCache(tx: any, tenantId: string, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return
  await tx.execute(sql`
    UPDATE people
    SET title_ids = COALESCE((
      SELECT jsonb_agg(title_id ORDER BY title_id)
      FROM person_title_assignments
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb)
    WHERE id IN (${sql.join(
      personIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND tenant_id = ${tenantId}
  `)
}
