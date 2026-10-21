import { describe, expect, it } from 'vitest'
import { journalDayProgress } from './journal-days'
const base = {
  start: '2026-10-19',
  end: '2026-10-25',
  today: '2026-10-21',
  completedDates: [] as string[],
  workDays: new Map<string, boolean>(),
}
describe('journals by required date', () => {
  it('counts each weekday once, ignores future entries, and never trades extra entries for missing days', () => {
    const progress = journalDayProgress({
      ...base,
      mode: 'weekdays',
      completedDates: ['2026-10-20', '2026-10-20', '2026-10-22'],
    })
    expect(progress).toMatchObject({
      count: 1,
      expected: 5,
      status: 'overdue',
      dueOn: '2026-10-19',
    })
  })
  it('requires weekends only in calendar mode', () => {
    expect(journalDayProgress({ ...base, mode: 'calendar' }).expected).toBe(7)
    expect(journalDayProgress({ ...base, mode: 'weekdays' }).expected).toBe(5)
  })
  it('uses explicit time off and weekend work, while unknown data falls back to weekdays', () => {
    const progress = journalDayProgress({
      ...base,
      mode: 'worked_days',
      workDays: new Map([
        ['2026-10-19', false],
        ['2026-10-24', true],
      ]),
      completedDates: ['2026-10-20'],
    })
    expect(progress).toMatchObject({
      count: 1,
      expected: 5,
      status: 'in_progress',
      dueOn: '2026-10-21',
      fallbackDays: 2,
    })
  })
  it('does not mark today overdue before the next local date', () => {
    expect(
      journalDayProgress({
        ...base,
        mode: 'weekdays',
        completedDates: ['2026-10-19', '2026-10-20'],
      }),
    ).toMatchObject({ status: 'in_progress', dueOn: '2026-10-21' })
  })
  it('has a complete zero-day target for a wholly excused period', () => {
    expect(
      journalDayProgress({
        ...base,
        mode: 'worked_days',
        start: '2026-10-19',
        end: '2026-10-19',
        workDays: new Map([['2026-10-19', false]]),
      }),
    ).toMatchObject({ count: 0, expected: 0, percent: 100, status: 'completed', dueOn: null })
  })
})
