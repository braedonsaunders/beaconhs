import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => ctx }))
import { and, eq, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  documents,
  documentVersions,
  documentAcknowledgments,
  trainingSkillTypes,
  trainingSkillAuthorities,
  trainingSkillAssignments,
  trainingExtraFields,
  personWorkDays,
  journalEntries,
  tenantNotificationPolicy,
  users,
  people,
  personGroups,
  personTitles,
  personTitleAssignments,
  jobTitleTasks,
  personGroupMemberships,
  complianceAudience,
  complianceObligations,
  complianceStatus,
  compliancePeriodSnapshots,
  auditLog,
  complianceDispatches,
  trainingCourses,
  trainingClasses,
  trainingClassAttendees,
  trainingRecords,
  trainingAssessmentTypes,
  trainingAssessments,
} from '@beaconhs/db/schema'
import {
  evaluateObligation,
  evaluateComplianceHistory,
  captureCompliancePeriod,
  discardOpenCompliancePeriods,
  loadAudience,
  materializeObligation,
  materializeIdentityAudienceObligations,
  resolveObligationAudience,
  lockComplianceTarget,
} from '@beaconhs/compliance'
import { upsertWorkDay, deleteWorkDay } from '@/lib/api/work-days'
import { obligationCompliance } from './_data'
import { obligationTargetOptions } from './_target-options'
import { isPickerOptionsResponse } from '@/lib/picker-options'
import { queryPersonCompliance } from '../_hub'
import { loadComplianceHistory } from './[id]/history/_data'
import type { RequestContext } from '@beaconhs/tenant'
import {
  addClassAttendee,
  removeClassAttendee,
  cancelClass,
  reopenClass,
} from '../../training/classes/_actions'
import { trainingClassRecordSaver } from '../../training/classes/_record-edits'
import { saveNotificationConfiguration } from '../../admin/notifications/_actions'

const url = process.env.DATABASE_URL,
  adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Compliance integration tests require an isolated localhost database')
}
const app = createClient({ url, max: 2 }),
  admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  userId = randomUUID()
const alex = randomUUID(),
  blair = randomUUID(),
  inactive = randomUUID(),
  outsider = randomUUID(),
  groupId = randomUUID()
const clock = { now: new Date('2026-10-20T16:00:00Z'), timezone: 'America/Toronto' }
const ctx: RequestContext = {
  tenantId,
  userId,
  membership: null,
  personId: null,
  isSuperAdmin: true,
  permissions: new Set(['*']),
  scopes: [],
  timezone: clock.timezone,
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, tenantId, run),
}

beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Compliance verification' },
    { id: otherTenant, slug: otherTenant, name: 'Other tenant' },
  ])
  await admin.db
    .insert(users)
    .values({ id: userId, name: 'Compliance administrator', email: `${userId}@example.com` })
  await ctx.db(async (tx) => {
    await tx.insert(people).values([
      { id: alex, tenantId, firstName: 'Alex', lastName: 'Worker' },
      { id: blair, tenantId, firstName: 'Blair', lastName: 'Worker' },
      { id: inactive, tenantId, firstName: 'Inactive', lastName: 'Worker', status: 'inactive' },
    ])
    await tx.insert(personGroups).values({ id: groupId, tenantId, name: 'Site group' })
    await tx
      .insert(personGroupMemberships)
      .values([alex, blair, inactive].map((personId) => ({ tenantId, groupId, personId })))
  })
  await withTenant(app.db, otherTenant, async (tx) => {
    await tx
      .insert(people)
      .values({ id: outsider, tenantId: otherTenant, firstName: 'Other', lastName: 'Tenant' })
  })
})
afterAll(async () => {
  try {
    await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
    await admin.db.delete(tenants).where(eq(tenants.id, otherTenant))
    await admin.db.delete(users).where(eq(users.id, userId))
  } finally {
    await app.sql.end()
    await admin.sql.end()
  }
})

it('subtracts exclusions after overlapping inclusions, scopes tenants, and removes stale status and alerts', async () => {
  await ctx.db(async (tx) => {
    const courseId = randomUUID(),
      id = randomUUID()
    await tx.insert(trainingCourses).values({
      id: courseId,
      tenantId,
      code: courseId,
      name: 'Audience course',
      deliveryType: 'classroom',
    })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        sourceModule: 'cert_requirement',
        subjectKind: 'per_person',
        title: 'Group minus person',
        recurrenceKind: 'expiry',
        recurrence: { kind: 'expiry' },
        targetRef: { courseId },
      })
      .returning()
    expect(ob).toBeDefined()
    await tx.insert(complianceAudience).values([
      { tenantId, obligationId: id, kind: 'person_group', entityKey: groupId },
      { tenantId, obligationId: id, kind: 'everyone', entityKey: '' },
    ])
    await tx.insert(trainingRecords).values(
      [alex, blair].map((personId) => ({
        tenantId,
        personId,
        courseId,
        source: 'external_upload' as const,
        completedOn: '2020-01-01',
        expiresOn: '2021-01-01',
      })),
    )
    await materializeObligation(tx, tenantId, ob!, clock)
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: alex, excluded: true })
    const audience = await loadAudience(tx, tenantId, id)
    expect(
      (await resolveObligationAudience(tx, tenantId, audience)).map((row) => row.personId),
    ).toEqual([blair])
    await materializeObligation(tx, tenantId, ob!, clock)
    expect(
      (await tx.select().from(complianceStatus).where(eq(complianceStatus.obligationId, id))).map(
        (row) => row.personId,
      ),
    ).toEqual([blair])
    const queued = await tx
      .select()
      .from(complianceDispatches)
      .where(
        and(eq(complianceDispatches.obligationId, id), eq(complianceDispatches.status, 'queued')),
      )
    expect(queued.length).toBeGreaterThan(0)
    expect(
      queued
        .flatMap((dispatch) => dispatch.alertPayload?.transitions ?? [])
        .some((transition) => transition.personId === alex),
    ).toBe(false)
    // Explicit include never overrides an exclusion. A foreign tenant's person cannot enter.
    expect(
      await resolveObligationAudience(tx, tenantId, [
        { kind: 'person', entityKey: alex },
        { kind: 'person', entityKey: alex, excluded: true },
        { kind: 'person', entityKey: outsider },
      ]),
    ).toEqual([])
    expect(
      await resolveObligationAudience(tx, tenantId, [
        { kind: 'person', entityKey: blair, excluded: true },
      ]),
    ).toEqual([])
    // Removing the exclusion restores applicability on the next reconciliation.
    await tx
      .delete(complianceAudience)
      .where(and(eq(complianceAudience.obligationId, id), eq(complianceAudience.excluded, true)))
    await materializeIdentityAudienceObligations(tx, tenantId, [alex])
    expect(
      (await tx.select().from(complianceStatus).where(eq(complianceStatus.obligationId, id)))
        .length,
    ).toBe(2)
  })
})

it('counts historical successful quizzes by type within rolling validity and expires on the person’s anniversary', async () => {
  await ctx.db(async (tx) => {
    const typeId = randomUUID(),
      id = randomUUID()
    await tx.insert(trainingAssessmentTypes).values({ id: typeId, tenantId, name: 'Annual quiz' })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        sourceModule: 'training',
        subjectKind: 'per_person',
        title: 'Rolling annual quiz',
        recurrenceKind: 'frequency',
        recurrence: { kind: 'frequency', frequency: 'year', evidenceWindow: 'rolling' },
        targetRef: { trainingItemKind: 'assessment_type', assessmentTypeId: typeId },
      })
      .returning()
    await tx.insert(trainingAssessments).values([
      {
        tenantId,
        typeId,
        personId: alex,
        passingScore: 80,
        passed: true,
        status: 'submitted',
        completedAt: new Date('2025-11-20T17:00:00Z'),
      },
      {
        tenantId,
        typeId,
        personId: blair,
        passingScore: 80,
        passed: true,
        status: 'submitted',
        completedAt: new Date('2025-10-19T17:00:00Z'),
      },
      {
        tenantId,
        typeId,
        personId: blair,
        passingScore: 80,
        passed: false,
        status: 'submitted',
        completedAt: new Date('2026-10-19T17:00:00Z'),
      },
      {
        tenantId,
        typeId,
        personId: blair,
        passingScore: 80,
        passed: true,
        status: 'submitted',
        completedAt: new Date('2026-10-21T17:00:00Z'),
      },
    ])
    const audience = [{ kind: 'everyone' as const, entityKey: '' }]
    const result = await evaluateObligation(tx, tenantId, ob!, audience, clock)
    expect(result.rows.find((row) => row.personId === alex)).toMatchObject({
      status: 'completed',
      completedOn: '2025-11-20',
      dueOn: '2026-11-20',
    })
    expect(result.rows.find((row) => row.personId === blair)).toMatchObject({
      status: 'overdue',
      dueOn: '2026-10-19',
    })
    expect(result.percent).toBe(50)
    const anniversary = await evaluateObligation(tx, tenantId, ob!, audience, {
      ...clock,
      now: new Date('2026-11-20T17:00:00Z'),
    })
    expect(anniversary.rows.find((row) => row.personId === alex)?.status).toBe('completed')
    const expired = await evaluateObligation(tx, tenantId, ob!, audience, {
      ...clock,
      now: new Date('2026-11-21T17:00:00Z'),
    })
    expect(expired.rows.find((row) => row.personId === alex)?.status).toBe('overdue')
  })
})

it('updates booked certificate status immediately across roster, cancellation, course and schedule changes', async () => {
  const courseId = randomUUID(),
    classId = randomUUID(),
    id = randomUUID(),
    otherCourse = randomUUID()
  const future = new Date(Date.now() + 14 * 86400000)
  await ctx.db(async (tx) => {
    await tx.insert(trainingCourses).values(
      [courseId, otherCourse].map((cid) => ({
        id: cid,
        tenantId,
        code: cid,
        name: cid,
        deliveryType: 'classroom' as const,
      })),
    )
    await tx.insert(trainingClasses).values({
      id: classId,
      tenantId,
      courseId,
      title: 'Renewal',
      startsAt: future,
      endsAt: new Date(future.getTime() + 3600000),
    })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        sourceModule: 'cert_requirement',
        subjectKind: 'per_person',
        title: 'Renewal certificate',
        recurrenceKind: 'expiry',
        recurrence: { kind: 'expiry' },
        targetRef: { courseId },
      })
      .returning()
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: alex })
    await tx.insert(trainingRecords).values({
      tenantId,
      personId: alex,
      courseId,
      source: 'external_upload',
      completedOn: '2020-01-01',
      expiresOn: '2021-01-01',
    })
    await materializeObligation(tx, tenantId, ob!)
  })
  const status = async () =>
    ctx.db(
      async (tx) =>
        (await tx.select().from(complianceStatus).where(eq(complianceStatus.obligationId, id)))[0],
    )
  expect((await status())?.status).toBe('overdue')
  const form = new FormData()
  form.set('classId', classId)
  form.set('personId', alex)
  await addClassAttendee(form)
  expect(await status()).toMatchObject({ status: 'booked', percent: 0 })
  const validTicket = randomUUID()
  await ctx.db(async (tx) => {
    await tx.insert(trainingRecords).values({
      id: validTicket,
      tenantId,
      personId: alex,
      courseId,
      source: 'external_upload',
      completedOn: new Date().toISOString().slice(0, 10),
      expiresOn: new Date(Date.now() + 3 * 365 * 86400000).toISOString().slice(0, 10),
    })
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, id))
    const result = await materializeObligation(tx, tenantId, ob!)
    expect(result.result.percent).toBe(100)
  })
  expect(await status()).toMatchObject({ status: 'completed', percent: 100 })
  await ctx.db(async (tx) => {
    await tx
      .update(trainingRecords)
      .set({ deletedAt: new Date() })
      .where(eq(trainingRecords.id, validTicket))
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, id))
    await materializeObligation(tx, tenantId, ob!)
  })
  expect(await status()).toMatchObject({ status: 'booked', percent: 0 })

  await cancelClass(classId, new FormData())
  expect((await status())?.status).toBe('overdue')
  await reopenClass(classId, new FormData())
  expect((await status())?.status).toBe('booked')
  const saved = await trainingClassRecordSaver(ctx, classId, [
    { fieldId: 'courseId', base: courseId, value: otherCourse },
  ])
  expect(saved.ok).toBe(true)
  expect((await status())?.status).toBe('overdue')
  await trainingClassRecordSaver(ctx, classId, [
    { fieldId: 'courseId', base: otherCourse, value: courseId },
  ])
  expect((await status())?.status).toBe('booked')
  await removeClassAttendee(form)
  expect((await status())?.status).toBe('overdue')
  await addClassAttendee(form)
  await ctx.db(async (tx) => {
    await tx
      .update(trainingClassAttendees)
      .set({ status: 'cancelled' })
      .where(eq(trainingClassAttendees.classId, classId))
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, id))
    const evaluated = await evaluateObligation(
      tx,
      tenantId,
      ob!,
      await loadAudience(tx, tenantId, id),
    )
    expect(evaluated.rows[0]?.status).toBe('overdue')
    const view = await tx.execute(
      sql`select booked_starts_at from report_training_matrix where tenant_id=${tenantId} and person_id=${alex} and course_id=${courseId}`,
    )
    expect((view as unknown as { booked_starts_at: Date | null }[])[0]?.booked_starts_at).toBeNull()
  })
})

it('keeps statuses current while reminders are paused and never replays paused transitions', async () => {
  await ctx.db(async (tx) => {
    const courseId = randomUUID(),
      id = randomUUID(),
      recordId = randomUUID()
    await tx.insert(trainingCourses).values({
      id: courseId,
      tenantId,
      code: courseId,
      name: 'Independent reminder course',
      deliveryType: 'classroom',
    })
    await tx.insert(tenantNotificationPolicy).values({
      tenantId,
      remindersEnabled: true,
      reminderCron: '0 8 * * *',
      scanTimezone: clock.timezone,
    })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        title: 'Independent refresh',
        sourceModule: 'cert_requirement',
        subjectKind: 'per_person',
        targetRef: { courseId },
        recurrence: { kind: 'one_time', dueOn: '2026-10-01' },
        recurrenceKind: 'one_time',
        status: 'active',
      })
      .returning()
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: alex })
    const initial = await materializeObligation(tx, tenantId, ob!, clock)
    expect(initial.result.rows[0]?.status).toBe('overdue')
    expect(initial.dispatchId).not.toBeNull()
    const [queued] = await tx
      .select()
      .from(complianceDispatches)
      .where(eq(complianceDispatches.id, initial.dispatchId!))
    expect(queued?.publishAvailableAt.toISOString()).toBe('2026-10-21T12:00:00.000Z')
    await tx
      .update(tenantNotificationPolicy)
      .set({ remindersEnabled: false })
      .where(eq(tenantNotificationPolicy.tenantId, tenantId))
    await tx.insert(trainingRecords).values({
      id: recordId,
      tenantId,
      personId: alex,
      courseId,
      completedOn: '2026-10-20',
      source: 'external_upload',
    })
    const completed = await materializeObligation(tx, tenantId, ob!, clock)
    expect(completed.result.rows[0]?.status).toBe('completed')
    expect(completed.dispatchId).toBeNull()
    const [cancelled] = await tx
      .select()
      .from(complianceDispatches)
      .where(eq(complianceDispatches.id, initial.dispatchId!))
    expect(cancelled?.status).toBe('skipped')
    await tx.delete(trainingRecords).where(eq(trainingRecords.id, recordId))
    const paused = await materializeObligation(tx, tenantId, ob!, clock)
    expect(paused.result.rows[0]?.status).toBe('overdue')
    expect(paused.dispatchId).toBeNull()
    await tx
      .update(tenantNotificationPolicy)
      .set({ remindersEnabled: true })
      .where(eq(tenantNotificationPolicy.tenantId, tenantId))
    const resumed = await materializeObligation(tx, tenantId, ob!, clock)
    expect(resumed.result.rows[0]?.status).toBe('overdue')
    expect(resumed.dispatchId).toBeNull()
  })
})

it('reschedules waiting reminders and cancels them through the saved admin policy', async () => {
  const dispatchId = await ctx.db(async (tx) => {
    const courseId = randomUUID(),
      id = randomUUID()
    await tx
      .update(tenantNotificationPolicy)
      .set({ remindersEnabled: true, reminderCron: '0 8 * * *' })
      .where(eq(tenantNotificationPolicy.tenantId, tenantId))
    await tx.insert(trainingCourses).values({
      id: courseId,
      tenantId,
      code: courseId,
      name: 'Reminder settings course',
      deliveryType: 'classroom',
    })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        title: 'Saved reminder controls',
        sourceModule: 'cert_requirement',
        subjectKind: 'per_person',
        targetRef: { courseId },
        recurrence: { kind: 'one_time', dueOn: '2026-10-01' },
        recurrenceKind: 'one_time',
      })
      .returning()
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: alex })
    return (await materializeObligation(tx, tenantId, ob!, clock)).dispatchId!
  })
  expect(dispatchId).toBeTruthy()
  const policy = {
    remindersEnabled: true,
    reminderCron: '0 9 * * *',
    scanTimezone: clock.timezone,
    digestMode: 'off' as const,
    digestHourUtc: 7,
    quietHours: null,
  }
  await saveNotificationConfiguration([], policy)
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(complianceDispatches)
      .where(eq(complianceDispatches.id, dispatchId))
    expect(row?.status).toBe('queued')
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: clock.timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(row!.publishAvailableAt),
    ).toBe('09:00')
    expect(row!.publishAvailableAt.getTime()).toBeGreaterThan(Date.now())
  })
  await saveNotificationConfiguration([], { ...policy, remindersEnabled: false })
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(complianceDispatches)
      .where(eq(complianceDispatches.id, dispatchId))
    expect(row?.status).toBe('skipped')
    expect(row?.publishLeaseId).toBeNull()
    expect(row?.error).toBe('Compliance reminders are paused')
  })
})

it('shows journal progress for the whole week, excludes drafts, and reviews the previous period separately', async () => {
  await ctx.db(async (tx) => {
    const id = randomUUID()
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        title: 'Site team — Weekly journals',
        sourceModule: 'journal',
        subjectKind: 'per_person',
        recurrenceKind: 'frequency',
        recurrence: {
          kind: 'frequency',
          frequency: 'week',
          quantity: 5,
          compliantPercentage: 80,
          evidenceWindow: 'calendar',
          deadline: { weekday: 7, time: '23:59' },
        },
        createdAt: new Date('2026-01-01'),
      })
      .returning()
    await tx.insert(complianceAudience).values(
      [alex, blair].map((personId) => ({
        tenantId,
        obligationId: id,
        kind: 'person' as const,
        entityKey: personId,
      })),
    )
    await tx.insert(journalEntries).values(
      [
        { personId: alex, entryDate: '2026-10-19', status: 'submitted' as const },
        { personId: alex, entryDate: '2026-10-20', status: 'archived' as const },
        { personId: alex, entryDate: '2026-10-20', status: 'draft' as const },
        {
          personId: alex,
          entryDate: '2026-10-20',
          status: 'submitted' as const,
          deletedAt: new Date(),
        },
        { personId: alex, entryDate: '2026-10-12', status: 'submitted' as const },
        { personId: alex, entryDate: '2026-10-14', status: 'submitted' as const },
        { personId: alex, entryDate: '2026-10-16', status: 'submitted' as const },
      ].map((row) => ({ ...row, tenantId, reference: randomUUID() })),
    )
    const current = await materializeObligation(tx, tenantId, ob!, clock)
    expect(current.result.rows.find((row) => row.personId === alex)).toMatchObject({
      status: 'in_progress',
      count: 2,
      expected: 5,
      percent: 40,
      dueOn: '2026-10-25',
      periodStart: '2026-10-19',
      periodEnd: '2026-10-25',
      subjectRef: { lastActivityOn: '2026-10-20' },
    })
    expect(current.result.rows.find((row) => row.personId === blair)).toMatchObject({
      status: 'pending',
      count: 0,
    })
    const previous = await evaluateObligation(
      tx,
      tenantId,
      ob!,
      await loadAudience(tx, tenantId, id),
      { ...clock, periodAt: new Date('2026-10-18T12:00:00Z') },
    )
    expect(previous.rows.find((row) => row.personId === alex)).toMatchObject({
      status: 'overdue',
      count: 3,
      expected: 5,
      dueOn: '2026-10-18',
      periodStart: '2026-10-12',
      periodEnd: '2026-10-18',
    })
    const [stored] = await tx
      .select()
      .from(complianceStatus)
      .where(and(eq(complianceStatus.obligationId, id), eq(complianceStatus.personId, alex)))
    expect(stored?.count).toBe(2)
    expect(stored?.periodStart).toBe('2026-10-19')
    await tx.insert(journalEntries).values(
      [1, 2].map(() => ({
        tenantId,
        personId: alex,
        reference: randomUUID(),
        entryDate: '2026-10-20',
        status: 'submitted' as const,
      })),
    )
    const met = await materializeObligation(tx, tenantId, ob!, clock)
    expect(met.result.rows.find((row) => row.personId === alex)).toMatchObject({
      status: 'completed',
      count: 4,
      expected: 5,
      percent: 80,
    })
    const early = await evaluateObligation(
      tx,
      tenantId,
      { ...ob!, createdAt: new Date('2026-10-19T12:00:00Z') },
      await loadAudience(tx, tenantId, id),
      { ...clock, periodAt: new Date('2026-10-18T12:00:00Z') },
    )
    expect(early.rows).toEqual([])
  })
})

it('preserves ended-period targets and people while reconstructing older periods and allowing evidence corrections', async () => {
  const id = randomUUID()
  await ctx.db(async (tx) => {
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        title: 'Weekly safety journals',
        sourceModule: 'journal',
        subjectKind: 'per_person',
        recurrenceKind: 'frequency',
        createdAt: new Date('2026-01-01'),
        recurrence: {
          kind: 'frequency',
          frequency: 'week',
          quantity: 5,
          compliantPercentage: 80,
          evidenceWindow: 'calendar',
          deadline: { weekday: 7, time: '23:59' },
        },
      })
      .returning()
    await tx.insert(complianceAudience).values(
      [alex, blair].map((entityKey) => ({
        tenantId,
        obligationId: id,
        kind: 'person' as const,
        entityKey,
      })),
    )
    await tx.insert(journalEntries).values(
      [12, 13, 14, 15].map((day) => ({
        tenantId,
        personId: alex,
        reference: randomUUID(),
        entryDate: `2026-10-${day}`,
        status: 'submitted' as const,
      })),
    )
    await materializeObligation(tx, tenantId, ob!, {
      ...clock,
      now: new Date('2026-10-16T18:00:00Z'),
    })
    const [updated] = await tx
      .update(complianceObligations)
      .set({ recurrence: { ...ob!.recurrence, quantity: 10, compliantPercentage: 100 } })
      .where(eq(complianceObligations.id, id))
      .returning()
    await tx.delete(complianceAudience).where(eq(complianceAudience.obligationId, id))
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: blair })
    await tx.update(people).set({ status: 'inactive', userId }).where(eq(people.id, alex))
    await materializeObligation(tx, tenantId, updated!, clock)
    const history = await evaluateComplianceHistory(
      tx,
      tenantId,
      updated!,
      [{ personId: blair, userId: null }],
      clock,
      3,
    )
    expect(
      history.find((row) => row.personId === alex && row.periodStart === '2026-10-12'),
    ).toMatchObject({ recorded: true, expected: 5, status: 'completed' })
    expect(
      history.find((row) => row.personId === blair && row.periodStart === '2026-10-05'),
    ).toMatchObject({ recorded: false, expected: 10, status: 'overdue' })
    expect(history.some((row) => row.personId === alex && row.periodStart === '2026-10-05')).toBe(
      false,
    )
    const snapshots = await tx
      .select()
      .from(compliancePeriodSnapshots)
      .where(eq(compliancePeriodSnapshots.obligationId, id))
    expect(snapshots).toHaveLength(2)
    const old = snapshots.find((row) => row.periodStart === '2026-10-12')!
    expect(old.rule.recurrence.quantity).toBe(5)
    await captureCompliancePeriod(
      tx,
      tenantId,
      updated!,
      { ...clock, periodAt: new Date('2026-10-13T16:00:00Z') },
      [{ personId: blair, userId: null }],
      [],
    )
    expect(
      (
        await tx
          .select()
          .from(compliancePeriodSnapshots)
          .where(eq(compliancePeriodSnapshots.id, old.id))
      )[0]?.rule,
    ).toEqual(old.rule)
    // Backfilled evidence updates the result, while the recorded target stays fixed.
    await tx.insert(journalEntries).values({
      tenantId,
      personId: blair,
      reference: randomUUID(),
      entryDate: '2026-10-12',
      status: 'submitted',
    })
    const corrected = await evaluateComplianceHistory(tx, tenantId, updated!, [], clock, 3)
    expect(
      corrected.find((row) => row.personId === blair && row.periodStart === '2026-10-12')?.count,
    ).toBe(1)
    expect(
      (
        await tx
          .select()
          .from(compliancePeriodSnapshots)
          .where(eq(compliancePeriodSnapshots.obligationId, id))
      ).find((row) => row.id === old.id)?.rule,
    ).toEqual(old.rule)
    const current = await tx
      .select()
      .from(complianceStatus)
      .where(eq(complianceStatus.obligationId, id))
    expect(current).toHaveLength(1)
    expect(current[0]?.expected).toBe(10)
    expect(current[0]?.periodStart).toBe('2026-10-19')
  })
  const self = await loadComplianceHistory(
    { ...ctx, isSuperAdmin: false, permissions: new Set() },
    id,
    3,
    blair,
  )
  expect(self?.personId).toBe(alex)
  expect(self?.history.length).toBeGreaterThan(0)
  expect(self?.history.every((row) => row.personId === alex)).toBe(true)
  await withTenant(app.db, otherTenant, async (tx) => {
    expect(
      await tx
        .select()
        .from(compliancePeriodSnapshots)
        .where(eq(compliancePeriodSnapshots.obligationId, id)),
    ).toEqual([])
  })
  await ctx.db((tx) => tx.update(people).set({ status: 'active' }).where(eq(people.id, alex)))
})

it('reviews monthly journal periods without treating missing pre-activation months as failures', async () => {
  await ctx.db(async (tx) => {
    const id = randomUUID()
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        title: 'Monthly journals',
        sourceModule: 'journal',
        subjectKind: 'per_person',
        recurrenceKind: 'frequency',
        createdAt: new Date('2026-08-15T12:00:00Z'),
        recurrence: {
          kind: 'frequency',
          frequency: 'month',
          quantity: 2,
          evidenceWindow: 'calendar',
          deadline: { day: 31, time: '23:59' },
        },
      })
      .returning()
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: alex })
    await tx.insert(journalEntries).values(
      [1, 2].map((day) => ({
        tenantId,
        personId: alex,
        reference: randomUUID(),
        entryDate: `2026-09-0${day}`,
        status: 'submitted' as const,
      })),
    )
    await materializeObligation(tx, tenantId, ob!, {
      ...clock,
      now: new Date('2026-09-20T12:00:00Z'),
    })
    const history = await evaluateComplianceHistory(
      tx,
      tenantId,
      ob!,
      [{ personId: alex, userId }],
      clock,
      12,
    )
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      count: 2,
      expected: 2,
      status: 'completed',
      recorded: true,
    })
    expect(history[1]).toMatchObject({
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      status: 'overdue',
      recorded: false,
    })
    await expect(evaluateComplianceHistory(tx, tenantId, ob!, [], clock, 25)).rejects.toThrow(
      '24 periods',
    )
    await tx.insert(auditLog).values([
      {
        tenantId,
        entityType: 'compliance_obligation',
        entityId: id,
        action: 'update',
        occurredAt: new Date('2026-09-10T12:00:00Z'),
        before: { status: 'active' },
        after: { status: 'paused' },
      },
      {
        tenantId,
        entityType: 'compliance_obligation',
        entityId: id,
        action: 'update',
        occurredAt: new Date('2026-10-01T12:00:00Z'),
        before: { status: 'paused' },
        after: { status: 'active' },
      },
    ])
    const activeOnly = await evaluateComplianceHistory(
      tx,
      tenantId,
      ob!,
      [{ personId: alex, userId }],
      clock,
      12,
    )
    expect(activeOnly).toHaveLength(1)
    expect(activeOnly[0]?.periodStart).toBe('2026-08-01')
    const deleted = await evaluateComplianceHistory(
      tx,
      tenantId,
      { ...ob!, status: 'archived', deletedAt: new Date('2026-08-20T12:00:00Z') },
      [{ personId: alex, userId }],
      clock,
      12,
    )
    expect(deleted).toEqual([])
  })
})

it('uses the recorded training target for a prior calendar period after the assigned assessment changes', async () => {
  const id = randomUUID()
  await ctx.db(async (tx) => {
    const oldType = randomUUID(),
      newType = randomUUID()
    await tx.insert(trainingAssessmentTypes).values([
      { id: oldType, tenantId, name: 'Original monthly quiz' },
      { id: newType, tenantId, name: 'Replacement monthly quiz' },
    ])
    await tx.insert(trainingAssessments).values({
      tenantId,
      typeId: oldType,
      personId: alex,
      status: 'submitted',
      passed: true,
      passingScore: 80,
      completedAt: new Date('2026-09-15T12:00:00Z'),
    })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        id,
        tenantId,
        title: 'Monthly safety quiz',
        sourceModule: 'training',
        subjectKind: 'per_person',
        recurrenceKind: 'frequency',
        createdAt: new Date('2026-01-01'),
        targetRef: { assessmentTypeId: oldType, trainingItemKind: 'assessment_type' },
        recurrence: {
          kind: 'frequency',
          frequency: 'month',
          evidenceWindow: 'calendar',
          deadline: { day: 31, time: '23:59' },
        },
      })
      .returning()
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId: id, kind: 'person', entityKey: alex })
    await materializeObligation(tx, tenantId, ob!, {
      ...clock,
      now: new Date('2026-09-20T12:00:00Z'),
    })
    const [updated] = await tx
      .update(complianceObligations)
      .set({ targetRef: { assessmentTypeId: newType, trainingItemKind: 'assessment_type' } })
      .where(eq(complianceObligations.id, id))
      .returning()
    const history = await evaluateComplianceHistory(
      tx,
      tenantId,
      updated!,
      [{ personId: alex, userId }],
      clock,
      3,
    )
    expect(history[0]).toMatchObject({
      periodStart: '2026-09-01',
      status: 'completed',
      recorded: true,
      count: 1,
      expected: 1,
    })
    expect(history[1]).toMatchObject({
      periodStart: '2026-08-01',
      status: 'overdue',
      recorded: false,
    })
    await materializeObligation(tx, tenantId, updated!, clock)
    const [rolling] = await tx
      .update(complianceObligations)
      .set({ recurrence: { kind: 'frequency', frequency: 'month', evidenceWindow: 'rolling' } })
      .where(eq(complianceObligations.id, id))
      .returning()
    await discardOpenCompliancePeriods(tx, tenantId, id, clock.now)
    await materializeObligation(tx, tenantId, rolling!, clock)
    expect(
      await tx
        .select()
        .from(compliancePeriodSnapshots)
        .where(eq(compliancePeriodSnapshots.obligationId, id)),
    ).toHaveLength(1)
    const retained = await evaluateComplianceHistory(
      tx,
      tenantId,
      rolling!,
      [{ personId: alex, userId }],
      clock,
      3,
    )
    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({
      periodStart: '2026-09-01',
      status: 'completed',
      recorded: true,
    })
    expect(
      (await queryPersonCompliance(tx, tenantId, alex)).find((row) => row.obligationId === id)
        ?.hasHistory,
    ).toBe(true)
  })
  const view = await loadComplianceHistory(ctx, id, 3, alex)
  expect(view?.supported).toBe(true)
  expect(view?.history).toHaveLength(1)
  expect((await obligationCompliance(ctx, id))?.hasHistory).toBe(true)
})

it('applies worker types to groups and individuals, retires old alerts, and keeps saved period rosters', async () => {
  const employee = randomUUID(),
    contractor = randomUUID(),
    unclassified = randomUUID(),
    mixedGroup = randomUUID()
  await ctx.db(async (tx) => {
    await tx.insert(people).values([
      {
        id: employee,
        tenantId,
        firstName: 'Employee',
        lastName: 'Worker type',
        metadata: { personType: 'employee' },
      },
      {
        id: contractor,
        tenantId,
        firstName: 'Contractor',
        lastName: 'Worker type',
        metadata: { personType: 'contractor' },
      },
      { id: unclassified, tenantId, firstName: 'Unclassified', lastName: 'Worker type' },
    ])
    await tx.insert(personGroups).values({ id: mixedGroup, tenantId, name: 'Mixed worker types' })
    await tx.insert(personGroupMemberships).values(
      [employee, contractor, unclassified].map((personId) => ({
        tenantId,
        groupId: mixedGroup,
        personId,
      })),
    )
    const audience = [{ kind: 'person_group' as const, entityKey: mixedGroup }]
    for (const [workerType, expected] of [
      ['employee', [employee]],
      ['contractor', [contractor]],
      ['all', [employee, contractor, unclassified]],
    ] as const) {
      const members = await resolveObligationAudience(tx, tenantId, audience, workerType)
      expect(members.map((member) => member.personId).sort()).toEqual([...expected].sort())
    }
    expect(
      await resolveObligationAudience(
        tx,
        tenantId,
        [
          ...audience,
          { kind: 'person', entityKey: contractor },
          { kind: 'person', entityKey: employee, excluded: true },
        ],
        'employee',
      ),
    ).toEqual([])
    const everyone = await resolveObligationAudience(
      tx,
      tenantId,
      [{ kind: 'everyone', entityKey: '' }],
      'employee',
    )
    expect(everyone.map((member) => member.personId)).toContain(employee)
    for (const id of [contractor, unclassified, inactive, outsider])
      expect(everyone.map((member) => member.personId)).not.toContain(id)
    await tx
      .insert(tenantNotificationPolicy)
      .values({ tenantId, remindersEnabled: false, scanTimezone: clock.timezone })
      .onConflictDoUpdate({
        target: tenantNotificationPolicy.tenantId,
        set: { remindersEnabled: false, scanTimezone: clock.timezone },
      })
  })
  const { createObligation, updateObligation } = await import('./_actions')
  const input = {
    kind: 'journal' as const,
    title: 'Employee journal worker type verification',
    audience: [{ type: 'person_group' as const, entityKey: mixedGroup }],
    recurrence: {
      kind: 'frequency' as const,
      frequency: 'week' as const,
      evidenceWindow: 'calendar' as const,
      quantity: 5,
    },
  }
  const created = await createObligation(input)
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error(created.error)
  const id = created.id
  let endedPeriodId = ''
  await ctx.db(async (tx) => {
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, id))
    expect(ob?.workerType).toBe('employee')
    expect(
      (await tx.select().from(complianceStatus).where(eq(complianceStatus.obligationId, id))).map(
        (row) => row.personId,
      ),
    ).toEqual([employee])
    const [snapshot] = await tx
      .select()
      .from(compliancePeriodSnapshots)
      .where(eq(compliancePeriodSnapshots.obligationId, id))
    expect(snapshot?.rule.workerType).toBe('employee')
    expect(snapshot?.rule.members.map((member) => member.personId)).toEqual([employee])
    // A closed snapshot must survive a subsequent worker-type edit.
    const [ended] = await tx
      .insert(compliancePeriodSnapshots)
      .values({
        tenantId,
        obligationId: id,
        periodStart: '2026-01-05',
        periodEnd: '2026-01-11',
        periodStartAt: new Date('2026-01-05T05:00:00Z'),
        periodEndAt: new Date('2026-01-12T05:00:00Z'),
        dueAt: new Date('2026-01-12T04:59:00Z'),
        timezone: clock.timezone,
        rule: snapshot!.rule,
      })
      .returning({ id: compliancePeriodSnapshots.id })
    endedPeriodId = ended!.id
    await tx
      .insert(complianceDispatches)
      .values({ tenantId, obligationId: id, status: 'queued', audienceSnapshot: [employee] })
  })
  expect((await updateObligation(id, { ...input, workerType: 'contractor' })).ok).toBe(true)
  await ctx.db(async (tx) => {
    expect(
      (await tx.select().from(complianceStatus).where(eq(complianceStatus.obligationId, id))).map(
        (row) => row.personId,
      ),
    ).toEqual([contractor])
    const [ended] = await tx
      .select()
      .from(compliancePeriodSnapshots)
      .where(eq(compliancePeriodSnapshots.id, endedPeriodId))
    expect(ended?.rule.workerType).toBe('employee')
    expect(ended?.rule.members.map((member) => member.personId)).toEqual([employee])
    expect(
      (
        await tx
          .select()
          .from(complianceDispatches)
          .where(eq(complianceDispatches.obligationId, id))
      ).every((row) => row.status === 'skipped'),
    ).toBe(true)
    const audits = await tx.select().from(auditLog).where(eq(auditLog.entityId, id))
    expect(
      audits.some((row) => (row.after as { workerType?: string })?.workerType === 'contractor'),
    ).toBe(true)
    // Changing a person's saved classification also refreshes the canonical scoreboard.
    await tx
      .update(people)
      .set({ metadata: { personType: 'employee' } })
      .where(eq(people.id, contractor))
    await materializeIdentityAudienceObligations(tx, tenantId, [contractor])
    expect(
      await tx.select().from(complianceStatus).where(eq(complianceStatus.obligationId, id)),
    ).toEqual([])
    const titleId = randomUUID()
    await tx
      .insert(personTitles)
      .values({ id: titleId, tenantId, name: 'Worker-type title verification' })
    await tx.insert(jobTitleTasks).values({ tenantId, titleId, task: 'Read the job description' })
    await tx
      .insert(personTitleAssignments)
      .values([employee, contractor].map((personId) => ({ tenantId, titleId, personId })))
    const [titleOb] = await tx
      .insert(complianceObligations)
      .values({
        tenantId,
        title: 'Employee title sign-offs',
        sourceModule: 'job_title_signoff',
        subjectKind: 'per_task',
        workerType: 'employee',
        targetRef: { jobTitleId: titleId },
        recurrenceKind: 'one_time',
        recurrence: { kind: 'one_time' },
      })
      .returning()
    await materializeObligation(tx, tenantId, titleOb!)
    const holders = async () =>
      (
        await tx
          .select()
          .from(complianceStatus)
          .where(eq(complianceStatus.obligationId, titleOb!.id))
      )
        .map((row) => row.personId)
        .sort()
    expect(await holders()).toEqual([employee, contractor].sort())
    await tx
      .update(people)
      .set({ metadata: { personType: 'contractor' } })
      .where(eq(people.id, contractor))
    await materializeIdentityAudienceObligations(tx, tenantId, [contractor])
    expect(await holders()).toEqual([employee])
    await tx
      .update(people)
      .set({ metadata: { personType: 'employee' } })
      .where(eq(people.id, contractor))
    await materializeIdentityAudienceObligations(tx, tenantId, [contractor])
    expect(await holders()).toEqual([employee, contractor].sort())
  })
})

it('keeps document campaigns on their assigned immutable edition and rejects cross-document versions', async () => {
  await ctx.db(async (tx) => {
    const doc = randomUUID(),
      otherDoc = randomUUID(),
      old = randomUUID(),
      latest = randomUUID()
    await tx.insert(documents).values([
      { id: doc, tenantId, key: doc, title: 'Versioned talk', status: 'published' },
      { id: otherDoc, tenantId, key: otherDoc, title: 'Other talk', status: 'published' },
    ])
    await tx.insert(documentVersions).values([
      { id: old, tenantId, documentId: doc, version: 1.1, publishedAt: new Date('2025-01-01') },
      { id: latest, tenantId, documentId: doc, version: 1.2, publishedAt: new Date('2026-01-01') },
    ])
    await tx
      .insert(documentAcknowledgments)
      .values({ tenantId, documentId: doc, versionId: old, personId: alex })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        tenantId,
        title: 'Old edition',
        sourceModule: 'document',
        subjectKind: 'per_person',
        targetRef: { documentId: doc, documentVersionId: old },
        recurrence: { kind: 'one_time', dueOn: '2025-01-31' },
        recurrenceKind: 'one_time',
      })
      .returning()
    const audience = [{ kind: 'person' as const, entityKey: alex }]
    const oldResult = await evaluateObligation(tx, tenantId, ob!, audience)
    const latestResult = await evaluateObligation(
      tx,
      tenantId,
      { ...ob!, targetRef: { documentId: doc, documentVersionId: latest } },
      audience,
    )
    expect(oldResult.rows[0]?.status).toBe('completed')
    expect(latestResult.rows[0]?.status).toBe('overdue')
    await expect(
      lockComplianceTarget(tx, tenantId, 'document', {
        documentId: otherDoc,
        documentVersionId: old,
      }),
    ).rejects.toThrow('published document version')
  })
})

it('filters skill evidence by both required positions on the same valid ticket', async () => {
  await ctx.db(async (tx) => {
    const authorityId = randomUUID(),
      type = randomUUID(),
      field = randomUUID(),
      ticket = randomUUID()
    await tx
      .insert(trainingSkillAuthorities)
      .values({ id: authorityId, tenantId, name: authorityId })
    await tx
      .insert(trainingSkillTypes)
      .values({ id: type, tenantId, authorityId, name: 'Positional qualification' })
    await tx
      .insert(trainingExtraFields)
      .values({ id: field, tenantId, authorityId, fieldKey: 'Position', valueMode: 'record' })
    await tx.insert(trainingSkillAssignments).values({
      id: ticket,
      tenantId,
      skillTypeId: type,
      personId: alex,
      grantedOn: '2026-01-01',
      expiresOn: '2027-01-01',
      status: 'complete',
    })
    const [answer] = await tx
      .insert(trainingExtraFields)
      .values({ tenantId, skillAssignmentId: ticket, fieldKey: 'Position', fieldValue: 'F' })
      .returning()
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        tenantId,
        title: 'Both F and H',
        sourceModule: 'skill_requirement',
        subjectKind: 'per_person',
        targetRef: {
          skillTypeId: type,
          skillConditions: [{ fieldId: field, operator: 'contains_all', values: ['F', 'H'] }],
        },
        recurrence: { kind: 'expiry' },
        recurrenceKind: 'expiry',
      })
      .returning()
    const audience = [{ kind: 'person' as const, entityKey: alex }]
    await lockComplianceTarget(tx, tenantId, 'skill_requirement', ob!.targetRef)
    expect((await evaluateObligation(tx, tenantId, ob!, audience, clock)).rows[0]?.status).toBe(
      'pending',
    )
    await tx
      .update(trainingExtraFields)
      .set({ fieldValue: 'F,H,V,O' })
      .where(eq(trainingExtraFields.id, answer!.id))
    expect((await evaluateObligation(tx, tenantId, ob!, audience, clock)).rows[0]?.status).toBe(
      'completed',
    )
  })
})

it('uses per-date journals and tenant-scoped optional work decisions instead of duplicate weekly totals', async () => {
  await ctx.db(async (tx) => {
    const dailyPerson = randomUUID()
    await tx
      .insert(people)
      .values({ id: dailyPerson, tenantId, firstName: 'Daily', lastName: 'Worker' })
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        tenantId,
        title: 'Required journal days',
        sourceModule: 'journal',
        subjectKind: 'per_person',
        createdAt: new Date('2026-10-01'),
        recurrence: {
          kind: 'frequency',
          frequency: 'week',
          evidenceWindow: 'calendar',
          deadline: { weekday: 7, time: '23:59' },
          journalDays: 'weekdays',
        },
        recurrenceKind: 'frequency',
      })
      .returning()
    await tx.insert(journalEntries).values(
      [0, 1].map(() => ({
        tenantId,
        personId: dailyPerson,
        reference: randomUUID(),
        entryDate: '2026-10-20',
        status: 'submitted' as const,
      })),
    )
    const audience = [{ kind: 'person' as const, entityKey: dailyPerson }]
    const current = await evaluateObligation(tx, tenantId, ob!, audience, clock)
    expect(current.rows[0]).toMatchObject({
      expected: 5,
      count: 1,
      status: 'overdue',
      dueOn: '2026-10-19',
    })
    await tx.insert(personWorkDays).values({
      tenantId,
      personId: dailyPerson,
      workDate: '2026-10-19',
      worked: false,
      source: 'neutral-test-provider',
    })
    const worked = await evaluateObligation(
      tx,
      tenantId,
      { ...ob!, recurrence: { ...ob!.recurrence, journalDays: 'worked_days' } },
      audience,
      clock,
    )
    expect(worked.rows[0]).toMatchObject({
      expected: 4,
      count: 1,
      status: 'in_progress',
      dueOn: '2026-10-21',
    })
    expect(
      (await tx.select().from(personWorkDays).where(eq(personWorkDays.personId, outsider))).length,
    ).toBe(0)
    await tx.update(people).set({ hireDate: '2026-10-20' }).where(eq(people.id, dailyPerson))
    expect((await evaluateObligation(tx, tenantId, ob!, audience, clock)).rows[0]).toMatchObject({
      expected: 4,
      count: 1,
      status: 'in_progress',
      dueOn: '2026-10-21',
    })
  })
})

it('upserts optional work days idempotently, validates dates and tenant identities, and audits corrections', async () => {
  const personId = await ctx.db(async (tx) => {
    const [person] = await tx
      .insert(people)
      .values({ tenantId, firstName: 'API', lastName: 'Worker' })
      .returning()
    return person!.id
  })
  const input = { personId, workDate: '2026-10-19', worked: true, source: 'neutral-time-system' }
  const first = await upsertWorkDay(ctx, input)
  const second = await upsertWorkDay(ctx, { ...input, worked: false })
  expect(first.id).toBe(second.id)
  expect(second.worked).toBe(false)
  await expect(upsertWorkDay(ctx, { ...input, workDate: '2026-02-30' })).rejects.toThrow(
    'valid workDate',
  )
  await expect(upsertWorkDay(ctx, { ...input, personId: outsider })).rejects.toThrow(
    'Person not found',
  )
  await deleteWorkDay(ctx, first.id)
  await ctx.db(async (tx) => {
    expect(
      await tx.select().from(personWorkDays).where(eq(personWorkDays.id, first.id)),
    ).toHaveLength(0)
    expect(await tx.select().from(auditLog).where(eq(auditLog.entityId, first.id))).toHaveLength(3)
  })
})

it('returns the shared remote-picker contract for published editions and inherited skill fields', async () => {
  const docId = randomUUID(),
    versionId = randomUUID(),
    draftId = randomUUID(),
    authorityId = randomUUID(),
    typeId = randomUUID(),
    fieldId = randomUUID()
  await ctx.db(async (tx) => {
    await tx
      .insert(documents)
      .values({ id: docId, tenantId, key: docId, title: 'Edition picker', status: 'published' })
    await tx.insert(documentVersions).values([
      { id: versionId, tenantId, documentId: docId, version: 1.1, publishedAt: clock.now },
      { id: draftId, tenantId, documentId: docId, version: 1.2 },
    ])
    await tx
      .insert(trainingSkillAuthorities)
      .values({ id: authorityId, tenantId, name: 'Picker authority' })
    await tx
      .insert(trainingSkillTypes)
      .values({ id: typeId, tenantId, authorityId, name: 'Picker skill' })
    await tx
      .insert(trainingExtraFields)
      .values({ id: fieldId, tenantId, authorityId, fieldKey: 'Position', valueMode: 'record' })
  })
  const editions = await obligationTargetOptions({
    kind: 'version',
    contextId: docId,
    query: '',
    selected: versionId,
  })
  expect(isPickerOptionsResponse(editions)).toBe(true)
  expect(editions.options).toEqual([{ value: versionId, label: 'v1.1' }])
  const fields = await obligationTargetOptions({
    kind: 'skill_field',
    contextId: typeId,
    query: '',
    selected: fieldId,
  })
  expect(isPickerOptionsResponse(fields)).toBe(true)
  expect(fields.options).toEqual([{ value: fieldId, label: 'Position' }])
  expect(
    (
      await obligationTargetOptions({
        kind: 'version',
        contextId: randomUUID(),
        query: '',
        selected: versionId,
      })
    ).options,
  ).toEqual([])
})
