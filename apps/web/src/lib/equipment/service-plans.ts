import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentMeters,
  equipmentServicePlans,
  equipmentLogEntries,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { validateServiceRules, type ServiceRule } from '@beaconhs/db/equipment-service'
import {
  optionalTextInput,
  requiredTextInput,
  requireUuidInput,
  requiredDateInput,
} from '@/lib/mutation-input'
import { addIntervalToDate } from './intervals'
import { recordAuditInTransaction } from '@/lib/audit'

type Transaction = Parameters<Parameters<RequestContext['db']>[0]>[0]
export type ServicePlanInput = {
  id?: string
  category?: 'oil_change' | null
  name: string
  notes?: string | null
  rules: ServiceRule[]
  match: 'any' | 'all'
  isActive: boolean
  resetReadings?: boolean
  resetReason?: string
  meters?: Array<{ id: string; name: string; unit: string; value: number | null }>
}
export function parseServicePlan(input: ServicePlanInput) {
  const rules = validateServiceRules(input.rules)
  const resetReason = input.resetReadings
    ? requiredTextInput(input.resetReason, 'Meter reset explanation', 1000)
    : null
  if (input.resetReadings && (!input.id || !resetReason || resetReason.length < 10))
    throw new Error(
      'Explain the meter replacement or reset before clearing its completion baseline.',
    )
  if (input.category !== undefined && input.category !== null && input.category !== 'oil_change')
    throw new Error('Choose a valid maintenance type.')
  if (input.match !== 'any' && input.match !== 'all')
    throw new Error('Choose how maintenance conditions combine.')
  if (typeof input.isActive !== 'boolean') throw new Error('Choose whether maintenance is active.')
  const meters = input.meters ?? []
  if (meters.length > 12) throw new Error('Add no more than twelve counters at once.')
  return {
    resetReadings: input.resetReadings === true,
    resetReason,
    category: input.category ?? null,
    id: input.id ? requireUuidInput(input.id, 'Maintenance') : undefined,
    name: requiredTextInput(input.name, 'Maintenance name', 240),
    notes: optionalTextInput(input.notes, 'Notes', 5000),
    rules,
    match: input.match,
    isActive: input.isActive,
    meters: meters.map((m) => ({
      id: requireUuidInput(m.id, 'Counter'),
      name: requiredTextInput(m.name, 'Counter name', 120),
      unit: requiredTextInput(m.unit, 'Counter unit', 40),
      currentValue: m.value === null ? null : validReading(m.value).toString(),
    })),
  }
}
function validReading(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 999999999999 ||
    Math.abs(value * 1000 - Math.round(value * 1000)) > 0.0001
  )
    throw new Error('Enter a non-negative counter reading with at most three decimal places.')
  return value
}
export async function lockServiceItem(tx: Transaction, ctx: RequestContext, itemId: string) {
  const [item] = await tx
    .select()
    .from(equipmentItems)
    .where(and(eq(equipmentItems.id, itemId), isNull(equipmentItems.deletedAt)))
    .limit(1)
    .for('update')
  if (
    !item ||
    !(await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: item.currentSiteOrgUnitId,
      personId: item.currentHolderPersonId,
    }))
  )
    throw new Error('Equipment not found.')
  return item
}
export async function persistServicePlan(
  tx: Transaction,
  ctx: RequestContext,
  itemId: string,
  input: ServicePlanInput,
) {
  const parsed = parseServicePlan(input)
  await persistServiceMeters(tx, ctx, itemId, parsed.meters)
  for (const rule of parsed.rules)
    if (rule.kind === 'meter' && !['engine_hours', 'odometer'].includes(rule.meter)) {
      const [meter] = await tx
        .select({ id: equipmentMeters.id })
        .from(equipmentMeters)
        .where(and(eq(equipmentMeters.id, rule.meter), eq(equipmentMeters.equipmentItemId, itemId)))
        .limit(1)
      if (!meter) throw new Error('Select a counter belonging to this equipment.')
    }
  const [previousPlan] = parsed.id
    ? await tx
        .select()
        .from(equipmentServicePlans)
        .where(
          and(
            eq(equipmentServicePlans.id, parsed.id),
            eq(equipmentServicePlans.equipmentItemId, itemId),
          ),
        )
        .limit(1)
        .for('update')
    : []
  if (parsed.id && !previousPlan) throw new Error('Maintenance was not found.')
  const sameCycle =
    !parsed.resetReadings &&
    previousPlan &&
    JSON.stringify(validateServiceRules(previousPlan.rules)) === JSON.stringify(parsed.rules) &&
    previousPlan.match === parsed.match &&
    previousPlan.isActive === parsed.isActive
  const values = {
    category: parsed.category,
    lastReadings: parsed.resetReadings ? {} : (previousPlan?.lastReadings ?? {}),
    name: parsed.name,
    notes: parsed.notes,
    rules: parsed.rules,
    match: parsed.match,
    isActive: parsed.isActive,
    cycleId: sameCycle ? previousPlan.cycleId : randomUUID(),
    notifiedCycleId: sameCycle ? previousPlan.notifiedCycleId : null,
    updatedAt: new Date(),
  }
  let plan
  if (parsed.id) {
    ;[plan] = await tx
      .update(equipmentServicePlans)
      .set(values)
      .where(
        and(
          eq(equipmentServicePlans.id, parsed.id),
          eq(equipmentServicePlans.equipmentItemId, itemId),
        ),
      )
      .returning()
  } else {
    ;[plan] = await tx
      .insert(equipmentServicePlans)
      .values({ ...values, tenantId: ctx.tenantId, equipmentItemId: itemId })
      .returning()
  }
  if (!plan) throw new Error('Maintenance was not found.')
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'equipment',
    entityId: itemId,
    action: 'update',
    summary: `${parsed.id ? 'Updated' : 'Added'} periodic maintenance: ${plan.name}`,
    before: previousPlan
      ? {
          servicePlanId: previousPlan.id,
          rules: previousPlan.rules,
          lastReadings: previousPlan.lastReadings,
        }
      : null,
    after: {
      resetReason: parsed.resetReason,
      servicePlanId: plan.id,
      rules: plan.rules,
      match: plan.match,
      isActive: plan.isActive,
    },
  })
  return plan
}
export async function completeServicePlan(
  tx: Transaction,
  ctx: RequestContext,
  input: {
    itemId: string
    planId: string
    cycleId: string
    completedOn: string
    notes: string
    readings: Record<string, number>
    amount?: string
  },
) {
  const item = await lockServiceItem(tx, ctx, requireUuidInput(input.itemId, 'Equipment'))
  const [plan] = await tx
    .select()
    .from(equipmentServicePlans)
    .where(
      and(
        eq(equipmentServicePlans.id, requireUuidInput(input.planId, 'Maintenance')),
        eq(equipmentServicePlans.equipmentItemId, item.id),
      ),
    )
    .limit(1)
    .for('update')
  if (!plan || !plan.isActive) throw new Error('Active maintenance was not found.')
  if (plan.cycleId !== input.cycleId)
    throw new Error(
      'This maintenance has changed or was already completed. Reload it before continuing.',
    )
  const completedOn = requiredDateInput(input.completedOn, 'Completion date')
  if (completedOn < '1902-01-01' || (plan.lastCompletedOn && completedOn < plan.lastCompletedOn))
    throw new Error('Completion cannot precede the previous completion.')
  const notes = optionalTextInput(input.notes, 'Completion notes', 5000)
  const completionReadings: Record<string, number> = {}
  const meterSnapshots: Record<string, { name: string; unit: string; value: number }> = {}
  const rules = validateServiceRules(plan.rules).map((rule) => {
    if (rule.kind === 'calendar') {
      if (rule.every === null)
        throw new Error('Set the maintenance interval before recording completion.')
      return { ...rule, dueOn: addIntervalToDate(completedOn, rule.every, rule.unit) }
    }
    const reading = input.readings[rule.meter]
    if (reading === undefined)
      throw new Error('Enter a completion reading for every usage condition.')
    completionReadings[rule.meter] = validReading(reading)
    return { ...rule, dueAt: completionReadings[rule.meter]! + rule.every }
  })
  validateServiceRules(rules)
  const current = {
    engine_hours: item.currentHours === null ? null : Number(item.currentHours),
    odometer: item.currentOdometer,
  }
  for (const rule of rules)
    if (rule.kind === 'meter') {
      const reading = validReading(input.readings[rule.meter])
      if (rule.meter === 'engine_hours' || rule.meter === 'odometer') {
        meterSnapshots[rule.meter] = {
          name: rule.meter === 'engine_hours' ? 'Engine hours' : 'Odometer',
          unit: rule.meter === 'engine_hours' ? 'hours' : 'km',
          value: reading,
        }
        const previous = current[rule.meter]
        if (plan.lastReadings[rule.meter] !== undefined && reading < plan.lastReadings[rule.meter]!)
          throw new Error('Completion readings cannot be below the previous completion reading.')
        if (rule.meter === 'odometer' && (!Number.isInteger(reading) || reading > 2147483647))
          throw new Error('Enter a valid whole-number odometer reading.')
        if (
          rule.meter === 'engine_hours' &&
          (Math.round(reading * 10) !== reading * 10 || reading > 999999999.9)
        )
          throw new Error('Enter valid engine hours with at most one decimal place.')
        if (previous === null || reading > previous)
          await tx
            .update(equipmentItems)
            .set(
              rule.meter === 'engine_hours'
                ? { currentHours: String(reading), metersUpdatedAt: new Date() }
                : { currentOdometer: reading, metersUpdatedAt: new Date() },
            )
            .where(eq(equipmentItems.id, item.id))
      } else {
        const [meter] = await tx
          .select()
          .from(equipmentMeters)
          .where(
            and(eq(equipmentMeters.id, rule.meter), eq(equipmentMeters.equipmentItemId, item.id)),
          )
          .limit(1)
          .for('update')
        if (!meter) throw new Error('Usage counter was not found.')
        meterSnapshots[rule.meter] = { name: meter.name, unit: meter.unit, value: reading }
        if (plan.lastReadings[rule.meter] !== undefined && reading < plan.lastReadings[rule.meter]!)
          throw new Error('Completion readings cannot be below the previous completion reading.')
        if (meter.currentValue === null || reading > Number(meter.currentValue))
          await tx
            .update(equipmentMeters)
            .set({ currentValue: String(reading), readOn: completedOn, updatedAt: new Date() })
            .where(eq(equipmentMeters.id, meter.id))
      }
    }
  let amount: string | null = null
  if (input.amount?.trim()) {
    if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(input.amount.trim()))
      throw new Error('Enter a valid maintenance cost.')
    amount = input.amount.trim()
  }
  await tx
    .update(equipmentServicePlans)
    .set({
      rules,
      lastReadings: completionReadings,
      lastCompletedOn: completedOn,
      cycleId: randomUUID(),
      notifiedCycleId: null,
      updatedAt: new Date(),
    })
    .where(eq(equipmentServicePlans.id, plan.id))
  await tx.insert(equipmentLogEntries).values({
    tenantId: ctx.tenantId,
    equipmentItemId: item.id,
    kind: 'maintenance',
    entryDate: completedOn,
    title: `${plan.name} completed`,
    details: [
      notes ?? plan.name + ' completed.',
      ...Object.values(meterSnapshots).map((m) => m.name + ': ' + m.value + ' ' + m.unit),
    ].join('\n'),
    amount,
    metadata: {
      servicePlanId: plan.id,
      cycleId: plan.cycleId,
      readings: completionReadings,
      meterSnapshots,
      rulesBefore: plan.rules,
      rulesAfter: rules,
    },
    createdByTenantUserId: ctx.membership?.id ?? null,
  })
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'equipment',
    entityId: item.id,
    action: 'update',
    summary: `Completed periodic maintenance: ${plan.name}`,
    before: { servicePlanId: plan.id, rules: plan.rules, lastCompletedOn: plan.lastCompletedOn },
    after: { completedOn, rules, readings: completionReadings, meterSnapshots, amount },
  })
}

export async function persistServiceMeters(
  tx: Transaction,
  ctx: RequestContext,
  itemId: string,
  meters: ReturnType<typeof parseServicePlan>['meters'],
) {
  for (const meter of meters) {
    const [existing] = await tx
      .select()
      .from(equipmentMeters)
      .where(eq(equipmentMeters.id, meter.id))
      .limit(1)
    if (existing) {
      if (
        existing.equipmentItemId !== itemId ||
        existing.name !== meter.name ||
        existing.unit !== meter.unit ||
        (existing.currentValue === null ? null : Number(existing.currentValue)) !==
          (meter.currentValue === null ? null : Number(meter.currentValue))
      )
        throw new Error('This counter already exists. Select it from the list.')
      continue
    }
    await tx
      .insert(equipmentMeters)
      .values({ ...meter, tenantId: ctx.tenantId, equipmentItemId: itemId })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: itemId,
      action: 'update',
      summary: `Added usage counter: ${meter.name}`,
      after: { counterId: meter.id, name: meter.name, unit: meter.unit, value: meter.currentValue },
    })
  }
}
