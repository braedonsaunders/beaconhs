/** Client-safe rules for recurring servicing. Inspections and one-off reminders remain distinct. */
type ServiceCalendarRule = {
  kind: 'calendar'
  every: number | null
  unit: 'day' | 'week' | 'month' | 'year'
  dueOn: string | null
}
type ServiceMeterRule = { kind: 'meter'; meter: string; every: number; dueAt: number | null }
export type ServiceRule = ServiceCalendarRule | ServiceMeterRule
type ServiceReadings = Record<string, number | null | undefined>
type ServicePlan = { rules: ServiceRule[]; match: 'any' | 'all'; isActive: boolean }
export type ServiceState = {
  status: 'paused' | 'needs_setup' | 'upcoming' | 'due' | 'overdue'
  dueOn: string | null
  due: boolean
}
const DATE = /^\d{4}-\d{2}-\d{2}$/
const METER =
  /^(engine_hours|odometer|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
export function validateServiceRules(value: unknown): ServiceRule[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12)
    throw new Error('Add between one and twelve maintenance conditions.')
  const seen = new Set<string>()
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid maintenance condition.')
    const r = raw as Record<string, unknown>
    if (
      !(r.kind === 'calendar' && r.every === null) &&
      (typeof r.every !== 'number' ||
        !Number.isFinite(r.every) ||
        r.every <= 0 ||
        r.every > 999999999)
    )
      throw new Error('Enter a positive maintenance interval.')
    const key = r.kind === 'calendar' ? 'calendar' : String(r.meter)
    if (seen.has(key)) throw new Error('Use each maintenance condition only once.')
    seen.add(key)
    if (r.kind === 'calendar') {
      if (
        (r.every !== null && (!Number.isInteger(r.every) || (r.every as number) > 1200)) ||
        !['day', 'week', 'month', 'year'].includes(String(r.unit))
      )
        throw new Error('Enter a valid calendar interval.')
      if (
        r.dueOn !== null &&
        (typeof r.dueOn !== 'string' ||
          !DATE.test(r.dueOn) ||
          r.dueOn < '1902-01-01' ||
          new Date(r.dueOn + 'T00:00:00Z').toISOString().slice(0, 10) !== r.dueOn)
      )
        throw new Error('Enter a valid next due date.')
      return {
        kind: 'calendar',
        every: r.every as number | null,
        unit: r.unit as ServiceCalendarRule['unit'],
        dueOn: r.dueOn as string | null,
      }
    }
    if (
      r.kind !== 'meter' ||
      typeof r.meter !== 'string' ||
      !METER.test(r.meter) ||
      (r.dueAt !== null &&
        (typeof r.dueAt !== 'number' ||
          !Number.isFinite(r.dueAt) ||
          r.dueAt < 0 ||
          r.dueAt > 999999999999))
    )
      throw new Error('Enter a valid usage condition and next due reading.')
    return {
      kind: 'meter',
      every: r.every as number,
      meter: r.meter.toLowerCase(),
      dueAt: r.dueAt as number | null,
    }
  })
}
export function evaluateServicePlan(
  plan: ServicePlan,
  readings: ServiceReadings,
  today: string,
): ServiceState {
  const dates = plan.rules
    .flatMap((r) => (r.kind === 'calendar' && r.dueOn ? [r.dueOn] : []))
    .sort()
  const dueOn = dates[0] ?? null
  if (!plan.isActive) return { status: 'paused', dueOn, due: false }
  const states = plan.rules.map((r) => {
    if (r.kind === 'calendar')
      return r.every === null || r.dueOn === null
        ? 'unknown'
        : r.dueOn < today
          ? 'overdue'
          : r.dueOn === today
            ? 'due'
            : 'upcoming'
    const current = readings[r.meter]
    return r.dueAt === null || current == null
      ? 'unknown'
      : current > r.dueAt
        ? 'overdue'
        : current === r.dueAt
          ? 'due'
          : 'upcoming'
  })
  const due =
    plan.match === 'all'
      ? states.every((s) => s === 'due' || s === 'overdue')
      : states.some((s) => s === 'due' || s === 'overdue')
  const overdue =
    plan.match === 'all'
      ? states.every((s) => s === 'overdue')
      : states.some((s) => s === 'overdue')
  return {
    dueOn,
    due,
    status: due
      ? overdue
        ? 'overdue'
        : 'due'
      : states.includes('unknown')
        ? 'needs_setup'
        : 'upcoming',
  }
}
