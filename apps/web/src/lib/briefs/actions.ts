'use server'

// Server actions for AI briefs: definitions (create from a template, autosave
// edits, archive), studio previews, and delivery schedules (save, pause,
// delete, run now). Every write checks `briefs.manage`, validates through
// @beaconhs/briefs, and is audited.

import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { activeTenantUsersWhere } from '@beaconhs/db'
import {
  briefRuns,
  briefs,
  briefSchedules,
  personGroups,
  tenantUsers,
  type BriefRunDelivery,
  type BriefSpec,
  type BriefWindowSpec,
} from '@beaconhs/db/schema'
import {
  BRIEF_LIMITS,
  BriefValidationError,
  blankBriefSpec,
  explicitBriefWindow,
  getBriefSource,
  getBriefTemplate,
  isValidTimeZone,
  nextBriefRunAt,
  normalizeEmail,
  normalizeSourceConfigs,
  parseBriefSpec,
  parseBriefWindow,
  resolveBriefRecipients,
  resolveBriefWindow,
} from '@beaconhs/briefs'
import { enqueueAiJob } from '@beaconhs/jobs'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { canManageBriefs } from './access'
import { generateBriefRunNow } from './generate'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof BriefValidationError) return { ok: false, error: error.message }
  if (error instanceof Error && error.message) return { ok: false, error: error.message }
  return { ok: false, error: fallback }
}

async function managerContext(): Promise<RequestContext> {
  const ctx = await requireRequestContext()
  if (!canManageBriefs(ctx)) throw new Error('You need permission to manage AI briefs.')
  return ctx
}

function memberId(ctx: RequestContext): string {
  const id = ctx.membership?.id
  if (!id || !isUuid(id)) {
    throw new Error('Briefs are owned by a workspace member. Join this workspace to manage them.')
  }
  return id
}

/** Every source the editor adds must be one they can read themselves. */
function assertSourcesReadable(ctx: RequestContext, spec: BriefSpec) {
  for (const config of spec.sources) {
    const source = getBriefSource(config.key)
    if (source && !source.canRead(ctx)) {
      throw new BriefValidationError(`You cannot read ${source.label}, so it cannot be added.`)
    }
  }
}

function validSpec(ctx: RequestContext, raw: unknown): BriefSpec {
  const spec = parseBriefSpec(raw)
  const normalized = { ...spec, sources: normalizeSourceConfigs(spec.sources) }
  assertSourcesReadable(ctx, normalized)
  return normalized
}

function revalidateBrief(id: string) {
  revalidatePath('/reports/briefs')
  revalidatePath(`/reports/briefs/${id}`)
}

// --- Definitions --------------------------------------------------------------------

export async function createBrief(input: {
  templateKey: string | null
}): Promise<Result<{ id: string }>> {
  try {
    const ctx = await managerContext()
    const owner = memberId(ctx)
    const template = input.templateKey ? getBriefTemplate(input.templateKey) : null
    if (input.templateKey && !template) throw new BriefValidationError('Template not found')
    const spec = validSpec(ctx, template?.spec ?? blankBriefSpec())
    const [created] = await ctx.db((tx) =>
      tx
        .insert(briefs)
        .values({
          tenantId: ctx.tenantId,
          templateKey: template?.key ?? null,
          name: template?.name ?? 'Untitled brief',
          description: template?.description ?? null,
          spec,
          createdByTenantUserId: owner,
          updatedByTenantUserId: owner,
        })
        .returning({ id: briefs.id }),
    )
    if (!created) throw new Error('The brief could not be created')
    await recordAudit(ctx, {
      entityType: 'brief',
      entityId: created.id,
      action: 'create',
      summary: template ? `Created AI brief from "${template.name}"` : 'Created AI brief',
      metadata: { templateKey: template?.key ?? null },
    })
    revalidatePath('/reports/briefs')
    return { ok: true, id: created.id }
  } catch (error) {
    return failure(error, 'Could not create the brief.')
  }
}

export async function saveBrief(input: {
  id: string
  name: string
  description: string
  spec: unknown
}): Promise<Result<{ specVersion: number }>> {
  try {
    const ctx = await managerContext()
    const owner = memberId(ctx)
    if (!isUuid(input.id)) throw new Error('Brief not found')
    const name = input.name.trim()
    if (!name) throw new BriefValidationError('Give the brief a name.')
    if (name.length > BRIEF_LIMITS.nameLength)
      throw new BriefValidationError('The name is too long.')
    const description = input.description.trim()
    if (description.length > BRIEF_LIMITS.descriptionLength) {
      throw new BriefValidationError('The description is too long.')
    }
    const spec = validSpec(ctx, input.spec)
    const saved = await ctx.db(async (tx) => {
      const [current] = await tx
        .select({ spec: briefs.spec, specVersion: briefs.specVersion })
        .from(briefs)
        .where(eq(briefs.id, input.id))
        .limit(1)
        .for('update')
      if (!current) throw new Error('Brief not found')
      const changed = JSON.stringify(current.spec) !== JSON.stringify(spec)
      const specVersion = changed ? current.specVersion + 1 : current.specVersion
      await tx
        .update(briefs)
        .set({
          name,
          description: description || null,
          spec,
          specVersion,
          updatedByTenantUserId: owner,
          updatedAt: new Date(),
        })
        .where(eq(briefs.id, input.id))
      return { specVersion, changed }
    })
    await recordAudit(ctx, {
      entityType: 'brief',
      entityId: input.id,
      action: 'update',
      summary: saved.changed
        ? `Updated AI brief (version ${saved.specVersion})`
        : 'Renamed AI brief',
      metadata: { specVersion: saved.specVersion },
    })
    revalidateBrief(input.id)
    return { ok: true, specVersion: saved.specVersion }
  } catch (error) {
    return failure(error, 'Could not save the brief.')
  }
}

export async function setBriefStatus(input: {
  id: string
  status: 'active' | 'archived'
}): Promise<Result> {
  try {
    const ctx = await managerContext()
    if (!isUuid(input.id)) throw new Error('Brief not found')
    await ctx.db(async (tx) => {
      const [updated] = await tx
        .update(briefs)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(briefs.id, input.id))
        .returning({ id: briefs.id })
      if (!updated) throw new Error('Brief not found')
      // An archived brief stops sending; its schedules stay for history.
      if (input.status === 'archived') {
        await tx
          .update(briefSchedules)
          .set({ active: false, nextRunAt: null, updatedAt: new Date() })
          .where(eq(briefSchedules.briefId, input.id))
      }
    })
    await recordAudit(ctx, {
      entityType: 'brief',
      entityId: input.id,
      action: 'update',
      summary: input.status === 'archived' ? 'Archived AI brief' : 'Restored AI brief',
    })
    revalidateBrief(input.id)
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not update the brief.')
  }
}

export async function previewBrief(input: {
  id: string
  firstDay: string
  lastDay: string
  departmentId: string | null
}): Promise<Result<{ runId: string; error: string | null }>> {
  try {
    const ctx = await managerContext()
    if (!isUuid(input.id)) throw new Error('Brief not found')
    if (input.departmentId && !isUuid(input.departmentId)) throw new Error('Department not found')
    const brief = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          id: briefs.id,
          name: briefs.name,
          spec: briefs.spec,
          specVersion: briefs.specVersion,
        })
        .from(briefs)
        .where(eq(briefs.id, input.id))
        .limit(1)
      return row ?? null
    })
    if (!brief) throw new Error('Brief not found')
    const window = explicitBriefWindow(input.firstDay, input.lastDay, ctx.timezone)
    const run = await generateBriefRunNow({
      ctx,
      brief,
      spec: validSpec(ctx, brief.spec),
      window,
      departmentId: input.departmentId,
      trigger: 'preview',
    })
    await recordAudit(ctx, {
      entityType: 'brief_run',
      entityId: run.runId,
      action: 'create',
      summary: `Previewed AI brief "${brief.name}" for ${window.label}`,
      metadata: { briefId: brief.id, status: run.status },
    })
    revalidatePath(`/reports/briefs/${brief.id}`)
    return { ok: true, runId: run.runId, error: run.error }
  } catch (error) {
    return failure(error, 'Could not generate the preview.')
  }
}

// --- Schedules ------------------------------------------------------------------------

export type BriefScheduleInput = {
  id: string | null
  briefId: string
  name: string
  cadence: 'daily' | 'weekly' | 'monthly'
  repeatEvery: number
  weekdaysOnly: boolean
  dayOfWeek: number | null
  dayOfMonth: number | null
  hour: number
  minute: number
  timezone: string
  window: BriefWindowSpec
  split: 'none' | 'department'
  recipientUserIds: string[]
  recipientGroupIds: string[]
  recipientEmails: string[]
  emailSubject: string
  active: boolean
}

function validateCadence(input: BriefScheduleInput) {
  if (!input.name.trim()) throw new BriefValidationError('Give the schedule a name.')
  if (input.name.trim().length > BRIEF_LIMITS.nameLength) {
    throw new BriefValidationError('The schedule name is too long.')
  }
  if (!['daily', 'weekly', 'monthly'].includes(input.cadence)) {
    throw new BriefValidationError('Choose daily, weekly, or monthly.')
  }
  if (!Number.isInteger(input.repeatEvery) || input.repeatEvery < 1 || input.repeatEvery > 52) {
    throw new BriefValidationError('Repeat every must be between 1 and 52.')
  }
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) {
    throw new BriefValidationError('Choose a valid hour.')
  }
  if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) {
    throw new BriefValidationError('Choose a valid minute.')
  }
  if (
    input.cadence === 'weekly' &&
    (input.dayOfWeek === null || input.dayOfWeek < 0 || input.dayOfWeek > 6)
  ) {
    throw new BriefValidationError('Choose the day of the week.')
  }
  if (
    input.cadence === 'monthly' &&
    (input.dayOfMonth === null || input.dayOfMonth < 1 || input.dayOfMonth > 28)
  ) {
    throw new BriefValidationError('Choose a day of the month between 1 and 28.')
  }
  if (!isValidTimeZone(input.timezone)) throw new BriefValidationError('Choose a valid timezone.')
  if (input.emailSubject.trim().length > 200) {
    throw new BriefValidationError('The email subject is too long.')
  }
}

export async function saveBriefSchedule(
  input: BriefScheduleInput,
): Promise<Result<{ id: string }>> {
  try {
    const ctx = await managerContext()
    const owner = memberId(ctx)
    if (!isUuid(input.briefId)) throw new Error('Brief not found')
    if (input.id && !isUuid(input.id)) throw new Error('Schedule not found')
    validateCadence(input)
    const window = parseBriefWindow(input.window)
    const emails = [...new Set(input.recipientEmails.map((e) => normalizeEmail(e)))]
    if (emails.some((e) => e === null))
      throw new BriefValidationError('One of the email addresses is not valid.')
    const userIds = [...new Set(input.recipientUserIds)]
    const groupIds = [...new Set(input.recipientGroupIds.filter(isUuid))]
    if (input.split === 'department' && emails.length > 0) {
      throw new BriefValidationError(
        'Department briefs go to people by their department — remove the plain email addresses or turn off the split.',
      )
    }
    if (userIds.length + groupIds.length + emails.length === 0) {
      throw new BriefValidationError('Add at least one recipient.')
    }
    if (userIds.length + emails.length > BRIEF_LIMITS.recipients) {
      throw new BriefValidationError(`Add at most ${BRIEF_LIMITS.recipients} recipients.`)
    }
    const timing = {
      cadence: input.cadence,
      repeatEvery: input.repeatEvery,
      dayOfWeek: input.cadence === 'weekly' ? input.dayOfWeek : null,
      dayOfMonth: input.cadence === 'monthly' ? input.dayOfMonth : null,
      weekOfMonth: null,
      hour: input.hour,
      minute: input.minute,
      timezone: input.timezone,
      startsOn: null,
      endsOn: null,
      weekdaysOnly: input.cadence === 'daily' && input.weekdaysOnly,
    }
    const nextRunAt = input.active ? nextBriefRunAt(timing) : null
    const id = await ctx.db(async (tx) => {
      const [brief] = await tx
        .select({ id: briefs.id, status: briefs.status })
        .from(briefs)
        .where(eq(briefs.id, input.briefId))
        .limit(1)
      if (!brief) throw new Error('Brief not found')
      if (brief.status !== 'active' && input.active) {
        throw new BriefValidationError('Restore the brief before scheduling it.')
      }
      if (userIds.length > 0) {
        const members = await tx
          .select({ userId: tenantUsers.userId })
          .from(tenantUsers)
          .where(and(activeTenantUsersWhere(), inArray(tenantUsers.userId, userIds)))
        if (members.length !== userIds.length) {
          throw new BriefValidationError(
            'Every recipient must be an active member of this workspace.',
          )
        }
      }
      if (groupIds.length > 0) {
        const groups = await tx
          .select({ id: personGroups.id })
          .from(personGroups)
          .where(inArray(personGroups.id, groupIds))
        if (groups.length !== groupIds.length)
          throw new BriefValidationError('A group was not found.')
      }
      const values = {
        name: input.name.trim(),
        ...timing,
        window,
        split: input.split,
        recipientUserIds: userIds,
        recipientGroupIds: groupIds,
        recipientEmails: emails as string[],
        emailSubject: input.emailSubject.trim() || null,
        runAsTenantUserId: owner,
        runAsRoleId: ctx.activeRoleId ?? null,
        active: input.active,
        nextRunAt,
        updatedAt: new Date(),
      }
      if (input.id) {
        const [updated] = await tx
          .update(briefSchedules)
          .set(values)
          .where(and(eq(briefSchedules.id, input.id), eq(briefSchedules.briefId, input.briefId)))
          .returning({ id: briefSchedules.id })
        if (!updated) throw new Error('Schedule not found')
        return updated.id
      }
      const [created] = await tx
        .insert(briefSchedules)
        .values({ tenantId: ctx.tenantId, briefId: input.briefId, ...values })
        .returning({ id: briefSchedules.id })
      if (!created) throw new Error('The schedule could not be saved')
      return created.id
    })
    await recordAudit(ctx, {
      entityType: 'brief_schedule',
      entityId: id,
      action: input.id ? 'update' : 'create',
      summary: input.id
        ? `Updated brief schedule "${input.name.trim()}"`
        : `Created brief schedule "${input.name.trim()}"`,
      metadata: {
        briefId: input.briefId,
        cadence: input.cadence,
        recipients: userIds.length + emails.length,
        groups: groupIds.length,
        split: input.split,
      },
    })
    revalidateBrief(input.briefId)
    return { ok: true, id }
  } catch (error) {
    return failure(error, 'Could not save the schedule.')
  }
}

export async function setBriefScheduleActive(input: {
  id: string
  active: boolean
}): Promise<Result> {
  try {
    const ctx = await managerContext()
    if (!isUuid(input.id)) throw new Error('Schedule not found')
    const briefId = await ctx.db(async (tx) => {
      const [schedule] = await tx
        .select()
        .from(briefSchedules)
        .where(eq(briefSchedules.id, input.id))
        .limit(1)
        .for('update')
      if (!schedule) throw new Error('Schedule not found')
      const nextRunAt = input.active ? nextBriefRunAt(schedule) : null
      await tx
        .update(briefSchedules)
        .set({ active: input.active, nextRunAt, updatedAt: new Date() })
        .where(eq(briefSchedules.id, input.id))
      return schedule.briefId
    })
    await recordAudit(ctx, {
      entityType: 'brief_schedule',
      entityId: input.id,
      action: 'update',
      summary: input.active ? 'Resumed brief schedule' : 'Paused brief schedule',
    })
    revalidateBrief(briefId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not update the schedule.')
  }
}

export async function deleteBriefSchedule(input: { id: string }): Promise<Result> {
  try {
    const ctx = await managerContext()
    if (!isUuid(input.id)) throw new Error('Schedule not found')
    const briefId = await ctx.db(async (tx) => {
      const [schedule] = await tx
        .select({ briefId: briefSchedules.briefId, name: briefSchedules.name })
        .from(briefSchedules)
        .where(eq(briefSchedules.id, input.id))
        .limit(1)
        .for('update')
      if (!schedule) throw new Error('Schedule not found')
      // Runs keep their history; they just stop pointing at the schedule.
      await tx
        .update(briefRuns)
        .set({ scheduleId: null, occurrenceKey: null })
        .where(eq(briefRuns.scheduleId, input.id))
      await tx.delete(briefSchedules).where(eq(briefSchedules.id, input.id))
      return schedule.briefId
    })
    await recordAudit(ctx, {
      entityType: 'brief_schedule',
      entityId: input.id,
      action: 'delete',
      summary: 'Deleted brief schedule',
    })
    revalidateBrief(briefId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not delete the schedule.')
  }
}

/** Generate and deliver a schedule's brief now, for the window it would cover today. */
export async function runBriefScheduleNow(input: {
  id: string
}): Promise<Result<{ runIds: string[] }>> {
  try {
    const ctx = await managerContext()
    const requester = memberId(ctx)
    if (!isUuid(input.id)) throw new Error('Schedule not found')
    const now = new Date()
    const runs = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({ schedule: briefSchedules, brief: briefs })
        .from(briefSchedules)
        .innerJoin(briefs, eq(briefs.id, briefSchedules.briefId))
        .where(eq(briefSchedules.id, input.id))
        .limit(1)
      if (!row) throw new Error('Schedule not found')
      const { schedule, brief } = row
      if (brief.status !== 'active')
        throw new BriefValidationError('Restore the brief before running it.')
      const window = resolveBriefWindow(schedule.window, now, schedule.timezone, schedule.lastRunAt)
      const delivery: BriefRunDelivery = {
        userIds: schedule.recipientUserIds,
        groupIds: schedule.recipientGroupIds,
        emails: schedule.recipientEmails,
        subject: schedule.emailSubject,
      }
      const base = {
        tenantId: ctx.tenantId,
        briefId: brief.id,
        scheduleId: schedule.id,
        trigger: 'manual' as const,
        status: 'queued' as const,
        briefName: brief.name,
        specVersion: brief.specVersion,
        specSnapshot: brief.spec,
        windowStart: window.start,
        windowEnd: window.end,
        windowLabel: window.label,
        timezone: window.timezone,
        runAsTenantUserId: schedule.runAsTenantUserId,
        runAsRoleId: schedule.runAsRoleId,
        requestedByTenantUserId: requester,
      }
      let values: Array<typeof base & { departmentId: string | null; delivery: BriefRunDelivery }>
      if (schedule.split === 'department') {
        const recipients = await resolveBriefRecipients(tx, ctx.tenantId, delivery)
        const byDept = new Map<string, typeof recipients>()
        for (const r of recipients) {
          if (!r.departmentId) continue
          byDept.set(r.departmentId, [...(byDept.get(r.departmentId) ?? []), r])
        }
        values = [...byDept].map(([departmentId, list]) => ({
          ...base,
          departmentId,
          delivery: {
            userIds: list.flatMap((r) => (r.userId ? [r.userId] : [])),
            groupIds: [],
            emails: list.flatMap((r) => (r.userId ? [] : [r.email])),
            subject: schedule.emailSubject,
          },
        }))
        if (values.length === 0) {
          throw new BriefValidationError('None of the recipients belong to a department.')
        }
      } else {
        values = [{ ...base, departmentId: null, delivery }]
      }
      return tx.insert(briefRuns).values(values).returning({ id: briefRuns.id })
    })
    for (const run of runs) {
      await enqueueAiJob({ kind: 'brief_run', tenantId: ctx.tenantId, runId: run.id })
    }
    await recordAudit(ctx, {
      entityType: 'brief_schedule',
      entityId: input.id,
      action: 'update',
      summary: `Ran brief schedule now (runs: ${runs.length})`,
      metadata: { runIds: runs.map((r) => r.id) },
    })
    revalidatePath('/reports/briefs')
    return { ok: true, runIds: runs.map((r) => r.id) }
  } catch (error) {
    return failure(error, 'Could not run the schedule.')
  }
}
