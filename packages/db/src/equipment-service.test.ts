import { describe, expect, it } from 'vitest'
import { evaluateServicePlan, validateServiceRules, type ServiceRule } from './equipment-service'
const today = '2026-10-21'
const calendar: ServiceRule = { kind: 'calendar', every: 3, unit: 'month', dueOn: '2026-11-01' }
const hours: ServiceRule = { kind: 'meter', meter: 'engine_hours', every: 250, dueAt: 1250 }
const custom = '8e3357e0-9640-4fd2-82ba-d6ab8024b341'
const plan = (rules: ServiceRule[], match: 'any' | 'all' = 'any') => ({
  rules,
  match,
  isActive: true,
})
describe('periodic equipment servicing', () => {
  it('becomes due by hours before its calendar date, then overdue only past the reading', () => {
    expect(
      evaluateServicePlan(plan([calendar, hours]), { engine_hours: 1250 }, today),
    ).toMatchObject({ due: true, status: 'due' })
    expect(
      evaluateServicePlan(plan([calendar, hours]), { engine_hours: 1250.1 }, today),
    ).toMatchObject({ due: true, status: 'overdue' })
  })
  it('waits for every condition in all mode, including unknown meters', () => {
    const rules = [{ ...calendar, dueOn: '2026-10-01' }, hours]
    expect(evaluateServicePlan(plan(rules, 'all'), { engine_hours: 1200 }, today)).toMatchObject({
      due: false,
      status: 'upcoming',
    })
    expect(evaluateServicePlan(plan(rules, 'all'), {}, today)).toMatchObject({
      due: false,
      status: 'needs_setup',
    })
    expect(evaluateServicePlan(plan(rules, 'all'), { engine_hours: 1250 }, today)).toMatchObject({
      due: true,
      status: 'due',
    })
  })
  it('supports custom cumulative counters and paused tasks', () => {
    const rules: ServiceRule[] = [{ kind: 'meter', meter: custom, every: 10000, dueAt: 25000 }]
    expect(evaluateServicePlan(plan(rules), { [custom]: 25001 }, today)).toMatchObject({
      due: true,
      status: 'overdue',
      dueOn: null,
    })
    expect(
      evaluateServicePlan({ ...plan(rules), isActive: false }, { [custom]: 25001 }, today),
    ).toMatchObject({ due: false, status: 'paused' })
  })
  it('preserves unknown imported dates, intervals, and readings rather than inventing compliance', () => {
    for (const rule of [
      { ...calendar, dueOn: null },
      { ...calendar, every: null },
      { ...hours, dueAt: null },
    ])
      expect(evaluateServicePlan(plan([rule]), { engine_hours: 99999 }, today)).toMatchObject({
        due: false,
        status: 'needs_setup',
      })
    expect(evaluateServicePlan(plan([calendar, hours]), {}, today)).toMatchObject({
      due: false,
      status: 'needs_setup',
    })
  })
  it.each(
    [
      [],
      [{ kind: 'meter', meter: 'engine_hours', every: 0, dueAt: 10 }],
      [{ kind: 'meter', meter: 'another-tenant-counter', every: 1, dueAt: 10 }],
      [{ ...calendar, dueOn: '2026-02-30' }],
      [calendar, calendar],
      [{ ...hours, dueAt: Infinity }],
      [{ ...calendar, every: 1.5 }],
    ].map((rules) => ({ rules })),
  )('rejects malformed or ambiguous conditions: %j', ({ rules }) =>
    expect(() => validateServiceRules(rules)).toThrow(),
  )
  it('accepts an explicit unknown calendar interval for imported maintenance setup', () =>
    expect(validateServiceRules([{ ...calendar, every: null, dueOn: null }])).toEqual([
      { ...calendar, every: null, dueOn: null },
    ]))
})
