import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => ctx }))
import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  users,
  people,
  complianceObligations,
  complianceStatus,
  equipmentItems,
  equipmentInspectionSchedules,
  equipmentServicePlans,
  equipmentWorkOrders,
  equipmentReminders,
  tenantNotificationPolicy,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { listDueObligations } from './_due'
import { listDueSignals } from '@/lib/operational-due'
import { listEquipmentInspectionStatus } from '@/lib/equipment/inspection-status'
import { saveEquipmentReminderSettings } from '../equipment/maintenance/settings/_actions'
const url = process.env.DATABASE_URL,
  adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl])
  if (!value || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(value).hostname))
    throw Error('Boundary integration tests require an isolated localhost database')
const app = createClient({ url, max: 2 }),
  admin = createClient({ url: adminUrl, max: 2 }),
  tenantId = randomUUID(),
  other = randomUUID(),
  employee = randomUUID(),
  contractor = randomUUID(),
  inactive = randomUUID(),
  userId = randomUUID()
const ctx: RequestContext = {
  tenantId,
  userId,
  membership: null,
  personId: null,
  isSuperAdmin: true,
  permissions: new Set(['*']),
  scopes: [],
  timezone: 'America/Toronto',
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, tenantId, run),
}
const assets = {
  unscheduled: randomUUID(),
  unknown: randomUUID(),
  overdue: randomUUID(),
  current: randomUUID(),
  draft: randomUUID(),
  retired: randomUUID(),
  deleted: randomUUID(),
}
const requirement = randomUUID()
beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Equipment boundary verification' },
    { id: other, slug: other, name: 'Other boundary tenant' },
  ])
  await admin.db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, name: 'Boundary verifier' })
  await ctx.db(async (tx) => {
    await tx.insert(people).values([
      {
        id: employee,
        tenantId,
        firstName: 'Em',
        lastName: 'Employee',
        metadata: { personType: 'employee' },
      },
      {
        id: contractor,
        tenantId,
        firstName: 'Con',
        lastName: 'Contractor',
        metadata: { personType: 'contractor' },
      },
      {
        id: inactive,
        tenantId,
        firstName: 'In',
        lastName: 'Inactive',
        status: 'inactive',
        metadata: { personType: 'employee' },
      },
    ])
    await tx.insert(tenantNotificationPolicy).values({
      tenantId,
      remindersEnabled: false,
      reminderCron: '0 8 * * *',
      equipmentRemindersEnabled: false,
      equipmentReminderCron: '0 9 * * *',
      scanTimezone: 'America/Toronto',
    })
    await tx.insert(complianceObligations).values({
      id: requirement,
      tenantId,
      title: 'Employee journal requirement',
      sourceModule: 'journal',
      subjectKind: 'per_person',
      workerType: 'employee',
      recurrence: { kind: 'frequency', frequency: 'week', quantity: 5 },
      recurrenceKind: 'frequency',
    })
    await tx.insert(complianceStatus).values(
      [employee, contractor, inactive].map((personId) => ({
        tenantId,
        obligationId: requirement,
        personId,
        subjectKey: `person:${personId}`,
        status: 'overdue' as const,
        dueOn: '2020-01-01',
        count: 2,
        expected: 5,
      })),
    )
    for (const [kind, id] of Object.entries(assets))
      await tx.insert(equipmentItems).values({
        id,
        tenantId,
        name: kind,
        assetTag: kind,
        qrToken: randomUUID(),
        isDraft: kind === 'draft',
        status: kind === 'retired' ? 'retired' : 'in_service',
        deletedAt: kind === 'deleted' ? new Date() : null,
        currentHolderPersonId: kind === 'current' ? employee : null,
      })
    for (const kind of ['current', 'overdue', 'unknown', 'draft', 'retired', 'deleted'] as const)
      await tx.insert(equipmentServicePlans).values({
        tenantId,
        equipmentItemId: assets[kind],
        name: 'Engine oil change',
        category: 'oil_change',
        isActive: kind !== 'overdue',
        rules: [
          {
            kind: 'calendar',
            every: kind === 'unknown' ? null : 3,
            unit: 'month',
            dueOn: kind === 'unknown' ? null : '2020-01-01',
          },
        ],
      })
    await tx.insert(equipmentInspectionSchedules).values([
      {
        tenantId,
        equipmentItemId: assets.unknown,
        label: 'Required external inspection',
        intervalValue: 1,
        intervalUnit: 'year',
        nextDueOn: null,
      },
      {
        tenantId,
        equipmentItemId: assets.overdue,
        label: 'Annual safety',
        intervalValue: 1,
        intervalUnit: 'year',
        nextDueOn: '2020-01-01',
      },
      {
        tenantId,
        equipmentItemId: assets.current,
        label: 'Annual safety',
        intervalValue: 1,
        intervalUnit: 'year',
        nextDueOn: '2099-01-01',
      },
      {
        tenantId,
        equipmentItemId: assets.current,
        label: 'Disabled schedule',
        intervalValue: 1,
        intervalUnit: 'year',
        nextDueOn: '2020-01-01',
        isActive: false,
      },
    ])
  })
  await withTenant(app.db, other, async (tx) => {
    const [ob] = await tx
      .insert(complianceObligations)
      .values({
        tenantId: other,
        title: 'Other tenant requirement',
        sourceModule: 'corrective_action',
        subjectKind: 'per_record',
        recurrence: { kind: 'expiry' },
        recurrenceKind: 'expiry',
      })
      .returning()
    await tx.insert(complianceStatus).values({
      tenantId: other,
      obligationId: ob!.id,
      subjectKey: 'record:other',
      status: 'overdue',
    })
  })
})
afterAll(async () => {
  try {
    await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
    await admin.db.delete(tenants).where(eq(tenants.id, other))
    await admin.db.delete(users).where(eq(users.id, userId))
  } finally {
    await app.sql.end()
    await admin.sql.end()
  }
})
it('uses configured employee obligations, excludes raw equipment dates, inactive people and other tenants', async () => {
  const data = await listDueObligations(ctx, { page: 1, perPage: 25 })
  expect(data.total).toBe(1)
  expect(data.counts).toEqual({ overdue: 1, expiring: 0, due_soon: 0, booked: 0 })
  expect(data.rows[0]).toMatchObject({
    module: 'journal',
    personName: 'Employee, Em',
    count: 2,
    expected: 5,
    href: `/compliance/obligations/${requirement}`,
  })
  expect((await listDueObligations(ctx, { q: 'not found', page: 1, perPage: 25 })).rows).toEqual([])
  await ctx.db((tx) =>
    tx
      .update(complianceObligations)
      .set({ status: 'paused' })
      .where(eq(complianceObligations.id, requirement)),
  )
  expect((await listDueObligations(ctx, { page: 1, perPage: 25 })).total).toBe(0)
})
it('distinguishes current, overdue and unconfigured equipment and honors visibility', async () => {
  const data = await listEquipmentInspectionStatus(ctx, { page: 1, perPage: 25 })
  expect(data.total).toBe(4)
  expect(data.counts).toEqual({ overdue: 1, due_soon: 0, current: 1, not_configured: 2 })
  expect(data.rows.find((row) => row.id === assets.unscheduled)?.status).toBe('not_configured')
  expect(data.rows.find((row) => row.id === assets.unknown)).toMatchObject({
    status: 'not_configured',
    schedules: 1,
    next_due_on: null,
  })
  const own = {
    ...ctx,
    isSuperAdmin: false,
    personId: employee,
    permissions: new Set(['equipment.read.self']),
  }
  expect(
    (await listEquipmentInspectionStatus(own, { page: 1, perPage: 25 })).rows.map((row) => row.id),
  ).toEqual([assets.current])
})
it('only lists due active configured service plans on available records', async () => {
  const data = await listDueSignals(ctx, {
    module: 'equipment',
    family: 'Periodic maintenance',
    perPage: 25,
  })
  expect(data.total).toBe(1)
  expect(data.rows[0]?.subject).toContain('current')
  expect(data.rows[0]?.href).toContain('?tab=inspections&itab=maintenance')
})
it('saves equipment reminder controls without changing compliance delivery', async () => {
  expect(await saveEquipmentReminderSettings({ enabled: true, cron: '0 10 * * *' })).toEqual({
    ok: true,
  })
  const [policy] = await ctx.db((tx) =>
    tx
      .select()
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, tenantId)),
  )
  expect(policy).toMatchObject({
    equipmentRemindersEnabled: true,
    equipmentReminderCron: '0 10 * * *',
    remindersEnabled: false,
    reminderCron: '0 8 * * *',
  })
  expect((await saveEquipmentReminderSettings({ enabled: true, cron: 'invalid' })).ok).toBe(false)
})

it('equipment agenda excludes unavailable assets across every signal family including work orders', async () => {
  const marker = 'Agenda-' + randomUUID()
  await ctx.db(async (tx) => {
    for (const status of [
      'in_service',
      'in_repair',
      'out_of_service',
      'retired',
      'lost',
    ] as const) {
      const id = randomUUID()
      await tx.insert(equipmentItems).values({
        id,
        tenantId,
        name: marker + status,
        assetTag: marker + status,
        qrToken: randomUUID(),
        status,
        warrantyExpiresOn: '2000-01-01',
      })
      await tx.insert(equipmentInspectionSchedules).values({
        tenantId,
        equipmentItemId: id,
        label: 'Annual',
        nextDueOn: '2000-01-01',
        intervalValue: 1,
        intervalUnit: 'year',
      })
      await tx.insert(equipmentServicePlans).values({
        tenantId,
        equipmentItemId: id,
        name: 'Oil',
        rules: [{ kind: 'calendar', every: 3, unit: 'month', dueOn: '2000-01-01' }],
        match: 'any',
      })
      await tx
        .insert(equipmentReminders)
        .values({ tenantId, equipmentItemId: id, title: 'Check', dueOn: '2000-01-01' })
      await tx.insert(equipmentWorkOrders).values({
        tenantId,
        itemId: id,
        reference: marker + status,
        summary: 'Repair',
        status: 'open',
      })
    }
  })
  const result = await listDueSignals(ctx, { module: 'equipment', q: marker, perPage: 100 })
  expect(result.total).toBe(10)
  for (const row of result.rows) expect(row.subject).not.toMatch(/out_of_service|retired|lost/)
  expect(new Set(result.rows.map((row) => row.family))).toEqual(
    new Set(['Inspection', 'Periodic maintenance', 'Reminder', 'Warranty', 'Work order']),
  )
})
