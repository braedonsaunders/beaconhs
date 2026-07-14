import { describe, expect, it } from 'vitest'
import { REPORT_SCHEDULE_LIMITS } from '@beaconhs/reports/schedule-policy'
import { parseScheduleForm } from './_parse'

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData()
  const values = {
    name: 'Weekly incidents',
    cadence: 'weekly',
    dayOfWeek: '1',
    hour: '7',
    minute: '30',
    timezone: 'America/Toronto',
    recipientUserIds: 'user_1,user_1,user_2',
    recipientEmails: ' HSE@Example.com, hse@example.com ',
    filters: '{"days":30}',
    ...overrides,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('report schedule form parser', () => {
  it('normalizes one shared create/edit field contract', () => {
    expect(parseScheduleForm(form())).toEqual({
      name: 'Weekly incidents',
      cadence: 'weekly',
      dayOfWeek: 1,
      dayOfMonth: null,
      hour: 7,
      minute: 30,
      timezone: 'America/Toronto',
      recipientUserIds: ['user_1', 'user_2'],
      recipientEmails: ['hse@example.com'],
      filters: { days: 30 },
    })
  })

  it('rejects malformed cadence fields and timezone names', () => {
    expect(() => parseScheduleForm(form({ hour: '0x10' }))).toThrow(/Hour/)
    expect(() => parseScheduleForm(form({ dayOfWeek: '7' }))).toThrow(/Day of week/)
    expect(() => parseScheduleForm(form({ timezone: 'Moon/Base' }))).toThrow(/Unknown timezone/)
    expect(() => parseScheduleForm(form({ cadence: 'quarterly' }))).toThrow(/cadence/)
  })

  it('rejects invalid recipients and unbounded filters', () => {
    expect(() => parseScheduleForm(form({ recipientEmails: 'not-an-email' }))).toThrow(/Invalid/)
    expect(() =>
      parseScheduleForm(
        form({
          recipientUserIds: 'u'.repeat(REPORT_SCHEDULE_LIMITS.recipientUserIdChars + 1),
        }),
      ),
    ).toThrow(/identifier/)
    expect(() =>
      parseScheduleForm(
        form({
          recipientEmails: Array.from(
            { length: REPORT_SCHEDULE_LIMITS.recipientCount + 1 },
            (_, i) => `person${i}@example.com`,
          ).join(','),
          recipientUserIds: '',
        }),
      ),
    ).toThrow(/at most/)
    expect(() => parseScheduleForm(form({ filters: '{"__proto__":true}' }))).toThrow(/invalid key/)
    expect(() => parseScheduleForm(form({ filters: `{"value":"${'x'.repeat(70_000)}"}` }))).toThrow(
      /too large/,
    )
  })
})
