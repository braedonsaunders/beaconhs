import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => ctx }))
import { and, eq, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  users,
  people,
  personGroups,
  personGroupMemberships,
  complianceAudience,
  complianceObligations,
  complianceStatus,
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
  loadAudience,
  materializeObligation,
  materializeIdentityAudienceObligations,
  resolveObligationAudience,
} from '@beaconhs/compliance'
import type { RequestContext } from '@beaconhs/tenant'
import {
  addClassAttendee,
  removeClassAttendee,
  cancelClass,
  reopenClass,
} from '../../training/classes/_actions'
import { trainingClassRecordSaver } from '../../training/classes/_record-edits'

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
