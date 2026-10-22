import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => ctx }))
import { and, eq } from 'drizzle-orm'
import { createClient, withTenant, equipmentServiceDueSql } from '@beaconhs/db'
import {
  equipmentCategories,
  equipmentTypes,
  equipmentItems,
  equipmentMeters,
  equipmentServicePlans,
  equipmentInspectionTypes,
  equipmentInspectionRecords,
  equipmentInspectionCriteria,
  equipmentInspectionSchedules,
  equipmentLogEntries,
  auditLog,
  tenants,
  users,
} from '@beaconhs/db/schema'
import { evaluateServicePlan, type ServiceRule } from '@beaconhs/db/equipment-service'
import type { RequestContext } from '@beaconhs/tenant'
import { emptyEquipmentSetup, type EquipmentSetupInput } from '@/lib/equipment/setup'
import { createEquipmentFromSetup } from './_setup-actions'
import { startEquipmentInspection } from './inspections/_actions'
import { recordServiceCompletion, saveServicePlan, saveEquipmentMeter } from './_service-actions'
const url = process.env.DATABASE_URL,
  adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl])
  if (!value || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Equipment setup tests require an isolated localhost database')
const app = createClient({ url, max: 3 }),
  admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherId = randomUUID(),
  userId = randomUUID(),
  categoryId = randomUUID(),
  typeId = randomUUID(),
  checkId = randomUUID(),
  preUseId = randomUUID(),
  otherItem = randomUUID(),
  otherMeter = randomUUID()
let ctx: RequestContext = {
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
const original = ctx
beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Guided equipment tests' },
    { id: otherId, slug: otherId, name: 'Other equipment tenant' },
  ])
  await admin.db
    .insert(users)
    .values({ id: userId, email: userId + '@example.com', name: 'Equipment setup verifier' })
  await ctx.db(async (tx) => {
    await tx.insert(equipmentCategories).values({
      id: categoryId,
      tenantId,
      name: 'Machines',
      slug: 'machines',
      enabledFieldGroups: ['manufacture'],
    })
    await tx.insert(equipmentTypes).values({ id: typeId, tenantId, categoryId, name: 'Mixer' })
    await tx.insert(equipmentInspectionTypes).values([
      {
        id: checkId,
        tenantId,
        name: 'Quarterly inspection',
        appliesToTypeId: typeId,
        intervalValue: 3,
        intervalUnit: 'month',
        isPreUse: false,
      },
      {
        id: preUseId,
        tenantId,
        name: 'Pre-use walkaround',
        appliesToTypeId: typeId,
        isPreUse: true,
      },
    ])
  })
  await withTenant(app.db, otherId, async (tx) => {
    await tx.insert(equipmentItems).values({
      id: otherItem,
      tenantId: otherId,
      name: 'Other mixer',
      assetTag: 'OTHER',
      qrToken: randomUUID(),
    })
    await tx.insert(equipmentMeters).values({
      id: otherMeter,
      tenantId: otherId,
      equipmentItemId: otherItem,
      name: 'Other cycles',
      unit: 'cycles',
      currentValue: '25',
    })
  })
})
afterAll(async () => {
  ctx = original
  await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
  await admin.db.delete(tenants).where(eq(tenants.id, otherId))
  await admin.db.delete(users).where(eq(users.id, userId))
  await app.sql.end()
  await admin.sql.end()
})
function setup(): EquipmentSetupInput {
  return {
    ...emptyEquipmentSetup(randomUUID()),
    categoryId,
    typeId,
    name: 'Shop mixer',
    assetTag: 'M-' + randomUUID().slice(0, 8),
    fields: {
      manufacturer: 'Acme',
      model: 'M20',
      serialNumber: 'SN-' + randomUUID(),
      currentHours: '100',
    },
    preUseRequired: true,
    preUseTypeId: preUseId,
    scheduledInspectionsRequired: true,
    inspectionSchedules: [{ typeId: checkId, every: 3, unit: 'month', dueOn: '2027-01-01' }],
    maintenanceRequired: true,
    maintenance: [
      {
        name: 'Lubricate bearings',
        rules: [
          { kind: 'calendar', every: 1, unit: 'month', dueOn: '2027-01-01' },
          { kind: 'meter', meter: 'engine_hours', every: 250, dueAt: 350 },
        ],
        match: 'any',
        isActive: true,
      },
    ],
    reviewed: true,
  }
}
async function rowsFor(id: string) {
  return ctx.db(async (tx) => ({
    items: await tx.select().from(equipmentItems).where(eq(equipmentItems.id, id)),
    schedules: await tx
      .select()
      .from(equipmentInspectionSchedules)
      .where(eq(equipmentInspectionSchedules.equipmentItemId, id)),
    plans: await tx
      .select()
      .from(equipmentServicePlans)
      .where(eq(equipmentServicePlans.equipmentItemId, id)),
    logs: await tx
      .select()
      .from(equipmentLogEntries)
      .where(eq(equipmentLogEntries.equipmentItemId, id)),
    audits: await tx.select().from(auditLog).where(eq(auditLog.entityId, id)),
  }))
}
describe('atomic guided equipment setup and servicing', () => {
  it('creates one complete record and its schedules for concurrent retries, with one creation audit', async () => {
    const input = setup()
    const results = await Promise.all([
      createEquipmentFromSetup(input),
      createEquipmentFromSetup(input),
    ])
    expect(results).toEqual([
      { ok: true, id: input.requestId },
      { ok: true, id: input.requestId },
    ])
    const rows = await rowsFor(input.requestId)
    expect(rows.items).toHaveLength(1)
    expect(rows.items[0]).toMatchObject({
      name: input.name,
      isDraft: false,
      requiresPreUseInspection: true,
      preUseInspectionTypeId: preUseId,
    })
    expect(rows.schedules).toHaveLength(1)
    expect(rows.plans).toHaveLength(1)
    expect(rows.audits.filter((a) => a.action === 'create')).toHaveLength(1)
    const duplicate = await createEquipmentFromSetup({ ...input, requestId: randomUUID() })
    expect(duplicate).toMatchObject({ ok: false, error: expect.stringContaining('asset tag') })
  })
  it('rolls equipment, new types, and every child back if an inspection or maintenance condition fails', async () => {
    for (const input of [
      { ...setup(), typeId: '', newTypeName: 'Rollback ' + randomUUID() },
      {
        ...setup(),
        maintenance: [
          {
            name: 'Bad task',
            rules: [{ kind: 'meter', meter: 'engine_hours', every: 0, dueAt: 10 }] as ServiceRule[],
            match: 'any' as const,
            isActive: true,
          },
        ],
      },
    ]) {
      expect(await createEquipmentFromSetup(input)).toMatchObject({ ok: false })
      expect((await rowsFor(input.requestId)).items).toHaveLength(0)
      if (input.newTypeName)
        expect(
          await ctx.db((tx) =>
            tx.select().from(equipmentTypes).where(eq(equipmentTypes.name, input.newTypeName)),
          ),
        ).toHaveLength(0)
    }
  })
  it('enforces category details and intentional inspection/maintenance decisions on the server', async () => {
    const input = setup()
    for (const modified of [
      { ...input, fields: { serialNumber: 'SN' } },
      { ...input, preUseRequired: null },
      { ...input, maintenanceRequired: null },
      { ...input, reviewed: false },
    ]) {
      expect(await createEquipmentFromSetup(modified)).toMatchObject({ ok: false })
      expect((await rowsFor(input.requestId)).items).toHaveLength(0)
    }
    const justified = {
      ...input,
      fields: { serialNumber: 'SN', currentHours: '100' },
      sections: {
        manufacture: {
          unavailable: true,
          reason: 'Manufacturer label is unreadable; details requested.',
        },
      },
    }
    expect(await createEquipmentFromSetup(justified)).toEqual({ ok: true, id: justified.requestId })
  })
  it('rejects another tenant category, item, and counter without exposing SQL', async () => {
    const otherCategory = randomUUID()
    await withTenant(app.db, otherId, (tx) =>
      tx
        .insert(equipmentCategories)
        .values({ id: otherCategory, tenantId: otherId, name: 'Private', slug: 'private' }),
    )
    expect(await createEquipmentFromSetup({ ...setup(), categoryId: otherCategory })).toMatchObject(
      { ok: false },
    )
    expect(
      await saveServicePlan(otherItem, {
        name: 'Forged',
        rules: [{ kind: 'calendar', every: 1, unit: 'year', dueOn: '2027-01-01' }],
        match: 'any',
        isActive: true,
      }),
    ).toMatchObject({ ok: false, error: 'Equipment not found.' })
    const input = setup()
    expect(await createEquipmentFromSetup(input)).toMatchObject({ ok: true })
    expect(
      await saveServicePlan(input.requestId, {
        name: 'Wrong counter',
        rules: [{ kind: 'meter', meter: otherMeter, every: 100, dueAt: 100 }],
        match: 'any',
        isActive: true,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('belonging') })
    const forged = await saveEquipmentMeter({
      itemId: input.requestId,
      id: otherMeter,
      name: 'Overwrite',
      unit: 'cycles',
      value: 999,
    })
    expect(forged).toMatchObject({ ok: false })
    if (!forged.ok) expect(forged.error).not.toContain('insert into')
    const [meter] = await withTenant(app.db, otherId, (tx) =>
      tx.select().from(equipmentMeters).where(eq(equipmentMeters.id, otherMeter)),
    )
    expect(Number(meter?.currentValue)).toBe(25)
  })
  it('records engine hours for calendar-only maintenance without adding a usage condition', async () => {
    const input = setup()
    input.maintenance[0]!.rules = [
      { kind: 'calendar', every: 3, unit: 'month', dueOn: '2026-01-01' },
    ]
    await createEquipmentFromSetup(input)
    const plan = (await rowsFor(input.requestId)).plans[0]!
    const completion = {
      itemId: input.requestId,
      planId: plan.id,
      cycleId: plan.cycleId,
      completedOn: '2026-01-31',
      notes: 'Changed oil',
      readings: { engine_hours: 150.5 },
    }
    expect(await recordServiceCompletion(completion)).toMatchObject({ ok: true })
    const rows = await rowsFor(input.requestId)
    expect(rows.plans[0]!.rules).toEqual([
      { kind: 'calendar', every: 3, unit: 'month', dueOn: '2026-04-30' },
    ])
    expect(Number(rows.items[0]!.currentHours)).toBe(150.5)
    expect(rows.logs[0]!.metadata).toMatchObject({
      readings: { engine_hours: 150.5 },
      meterSnapshots: { engine_hours: { name: 'Engine hours', unit: 'hours', value: 150.5 } },
    })
    const next = rows.plans[0]!
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(
        await recordServiceCompletion({
          ...completion,
          cycleId: next.cycleId,
          readings: Object.fromEntries([[key, 1]]),
        }),
      ).toMatchObject({ ok: false })
    }
    expect((await rowsFor(input.requestId)).plans[0]!.cycleId).toBe(next.cycleId)
    expect((await rowsFor(input.requestId)).logs).toHaveLength(1)
    expect(
      await recordServiceCompletion({
        ...completion,
        cycleId: next.cycleId,
        readings: { [otherMeter]: 30 },
      }),
    ).toMatchObject({ ok: false })
    expect((await rowsFor(input.requestId)).logs).toHaveLength(1)
    expect(
      await recordServiceCompletion({
        ...completion,
        cycleId: next.cycleId,
        readings: { engine_hours: -1 },
      }),
    ).toMatchObject({ ok: false })
  })

  it('accepts an applicable daily checklist as the unit pre-use inspection', async () => {
    const dailyId = randomUUID()
    await ctx.db((tx) =>
      tx.insert(equipmentInspectionTypes).values({
        id: dailyId,
        tenantId,
        name: 'Daily welder check',
        appliesToTypeId: typeId,
        intervalValue: 1,
        intervalUnit: 'day',
        isPreUse: false,
      }),
    )
    const input = { ...setup(), preUseTypeId: dailyId }
    expect(await createEquipmentFromSetup(input)).toMatchObject({ ok: true })
    expect((await rowsFor(input.requestId)).items[0]!.preUseInspectionTypeId).toBe(dailyId)
    expect(await createEquipmentFromSetup({ ...setup(), preUseTypeId: checkId })).toMatchObject({
      ok: false,
    })
  })

  it('records daily inspections according to their actual pre-use or scheduled purpose', async () => {
    const dailyId = randomUUID()
    await ctx.db(async (tx) => {
      await tx.insert(equipmentInspectionTypes).values({
        id: dailyId,
        tenantId,
        name: 'Daily engine check',
        appliesToTypeId: typeId,
        intervalValue: 1,
        intervalUnit: 'day',
        isPreUse: false,
      })
      await tx.insert(equipmentInspectionCriteria).values({
        tenantId,
        inspectionTypeId: dailyId,
        sequence: 0,
        question: 'Engine safe to use?',
      })
    })
    const input = { ...setup(), preUseTypeId: dailyId }
    expect(await createEquipmentFromSetup(input)).toMatchObject({ ok: true })
    const start = async (rental = false) => {
      const form = new FormData()
      form.set('typeId', dailyId)
      form.set('targetMode', rental ? 'rental' : 'registered')
      form.set('equipmentItemId', input.requestId)
      form.set('rentalName', 'Unregistered rental QA')
      await expect(startEquipmentInspection(form)).rejects.toThrow('NEXT_REDIRECT')
    }
    await start()
    let records = await ctx.db((tx) =>
      tx
        .select()
        .from(equipmentInspectionRecords)
        .where(eq(equipmentInspectionRecords.equipmentItemId, input.requestId)),
    )
    expect(records.map((r) => r.isPreUse)).toEqual([true])
    await ctx.db(async (tx) => {
      await tx
        .update(equipmentItems)
        .set({ preUseInspectionTypeId: null, requiresPreUseInspection: false })
        .where(eq(equipmentItems.id, input.requestId))
      await tx.insert(equipmentInspectionSchedules).values({
        tenantId,
        equipmentItemId: input.requestId,
        inspectionTypeId: dailyId,
        label: 'Daily scheduled check',
        intervalValue: 1,
        intervalUnit: 'day',
        nextDueOn: '2026-10-22',
      })
    })
    await start()
    records = await ctx.db((tx) =>
      tx
        .select()
        .from(equipmentInspectionRecords)
        .where(eq(equipmentInspectionRecords.equipmentItemId, input.requestId)),
    )
    expect(records.filter((r) => r.isPreUse)).toHaveLength(1)
    expect(records.filter((r) => !r.isPreUse)).toHaveLength(1)
    await ctx.db((tx) =>
      tx
        .update(equipmentItems)
        .set({ ownership: 'rented' })
        .where(eq(equipmentItems.id, input.requestId)),
    )
    await start()
    records = await ctx.db((tx) =>
      tx
        .select()
        .from(equipmentInspectionRecords)
        .where(eq(equipmentInspectionRecords.equipmentItemId, input.requestId)),
    )
    expect(records.filter((r) => r.isPreUse)).toHaveLength(2)
    await start(true)
    const rental = await ctx.db((tx) =>
      tx
        .select()
        .from(equipmentInspectionRecords)
        .where(eq(equipmentInspectionRecords.equipmentNameSnapshot, 'Unregistered rental QA')),
    )
    expect(rental[0]).toMatchObject({ isPreUse: true, isRental: true, equipmentItemId: null })
  })

  it('advances from actual completion evidence once, clamps calendar months, and preserves later meter readings', async () => {
    const input = setup()
    await createEquipmentFromSetup(input)
    const plan = (await rowsFor(input.requestId)).plans[0]!
    const args = {
      itemId: input.requestId,
      planId: plan.id,
      cycleId: plan.cycleId,
      completedOn: '2026-01-31',
      notes: 'Greased bearings; work reference S-100.',
      readings: { engine_hours: 150 },
      amount: '24.99',
    }
    expect(await recordServiceCompletion(args)).toMatchObject({ ok: true })
    let rows = await rowsFor(input.requestId)
    expect(rows.plans[0]?.rules).toEqual([
      { kind: 'calendar', every: 1, unit: 'month', dueOn: '2026-02-28' },
      { kind: 'meter', meter: 'engine_hours', every: 250, dueAt: 400 },
    ])
    expect(rows.logs).toHaveLength(1)
    expect(rows.logs[0]?.metadata).toMatchObject({
      cycleId: plan.cycleId,
      readings: { engine_hours: 150 },
    })
    expect(rows.logs[0]?.amount).toBe('24.99')
    expect(await recordServiceCompletion(args)).toMatchObject({ ok: false })
    expect((await rowsFor(input.requestId)).logs).toHaveLength(1)
    await ctx.db((tx) =>
      tx
        .update(equipmentItems)
        .set({ currentHours: '1000' })
        .where(eq(equipmentItems.id, input.requestId)),
    )
    const next = rows.plans[0]!
    expect(
      await recordServiceCompletion({
        ...args,
        cycleId: next.cycleId,
        completedOn: '2026-02-28',
        readings: { engine_hours: 500 },
      }),
    ).toMatchObject({ ok: true })
    rows = await rowsFor(input.requestId)
    expect(Number(rows.items[0]?.currentHours)).toBe(1000)
    expect(rows.logs).toHaveLength(2)
  })
  it('does not rearm an alerted cycle when only its name or notes are edited', async () => {
    const input = setup()
    await createEquipmentFromSetup(input)
    const plan = (await rowsFor(input.requestId)).plans[0]!
    await ctx.db((tx) =>
      tx
        .update(equipmentServicePlans)
        .set({ notifiedCycleId: plan.cycleId })
        .where(eq(equipmentServicePlans.id, plan.id)),
    )
    expect(
      await saveServicePlan(input.requestId, { ...plan, notes: 'Updated instructions.' }),
    ).toMatchObject({ ok: true })
    const after = (await rowsFor(input.requestId)).plans[0]!
    expect(after.cycleId).toBe(plan.cycleId)
    expect(after.notifiedCycleId).toBe(plan.cycleId)
  })
  it('matches SQL due filtering to UI evaluation for any/all, custom counters, unknowns, and paused plans', async () => {
    const input = setup()
    await createEquipmentFromSetup(input)
    const counter = randomUUID()
    await saveEquipmentMeter({
      itemId: input.requestId,
      id: counter,
      name: 'Cycles',
      unit: 'cycles',
      value: 1000,
    })
    const cases: Array<{ rules: ServiceRule[]; match: 'any' | 'all'; isActive: boolean }> = [
      {
        rules: [
          { kind: 'calendar', every: 1, unit: 'month', dueOn: '2020-01-01' },
          { kind: 'meter', meter: 'engine_hours', every: 100, dueAt: 1000 },
        ],
        match: 'all',
        isActive: true,
      },
      {
        rules: [
          { kind: 'calendar', every: 1, unit: 'month', dueOn: '2020-01-01' },
          { kind: 'meter', meter: 'engine_hours', every: 100, dueAt: 1000 },
        ],
        match: 'any',
        isActive: true,
      },
      {
        rules: [{ kind: 'meter', meter: counter, every: 100, dueAt: 1000 }],
        match: 'any',
        isActive: true,
      },
      {
        rules: [{ kind: 'meter', meter: counter, every: 100, dueAt: 500 }],
        match: 'all',
        isActive: true,
      },
      {
        rules: [{ kind: 'calendar', every: null, unit: 'month', dueOn: '2020-01-01' }],
        match: 'any',
        isActive: true,
      },
      {
        rules: [{ kind: 'calendar', every: 1, unit: 'month', dueOn: null }],
        match: 'any',
        isActive: true,
      },
      {
        rules: [{ kind: 'meter', meter: 'engine_hours', every: 100, dueAt: 10 }],
        match: 'any',
        isActive: false,
      },
    ]
    for (const [index, p] of cases.entries())
      expect(await saveServicePlan(input.requestId, { ...p, name: 'Case ' + index })).toMatchObject(
        { ok: true },
      )
    const rows = (await rowsFor(input.requestId)).plans
    const readings = { engine_hours: 100, odometer: null, [counter]: 1000 }
    for (const strict of [false, true]) {
      const actual = await ctx.db((tx) =>
        tx
          .select({ id: equipmentServicePlans.id })
          .from(equipmentServicePlans)
          .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentServicePlans.equipmentItemId))
          .where(
            and(
              eq(equipmentItems.id, input.requestId),
              equipmentServiceDueSql('2026-10-21', strict),
            ),
          ),
      )
      const expected = rows
        .filter((p) => {
          const s = evaluateServicePlan(p, readings, '2026-10-21')
          return strict ? s.status === 'overdue' : s.due
        })
        .map((p) => p.id)
        .sort()
      expect(actual.map((p) => p.id).sort()).toEqual(expected)
    }
  })
  it('does not bypass missing permissions', async () => {
    ctx = { ...original, isSuperAdmin: false, permissions: new Set() }
    await expect(createEquipmentFromSetup(setup())).rejects.toThrow()
    ctx = original
  })
})
