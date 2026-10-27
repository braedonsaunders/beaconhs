import { describe, expect, it } from 'vitest'
import {
  assertTrainingClassCapacity,
  assertTrainingClassSchedule,
  parseTrainingClassField,
  parseTrainingClassCompletionPage,
  parseTrainingClassSchedule,
  requireTrainingClassId,
} from './training-class-policy'

const ID = '10000000-0000-4000-8000-000000000001'

describe('training class mutation policy', () => {
  it('keeps reminders off by default and only accepts the offered lead times', () => {
    expect(parseTrainingClassField('reminderHours', '', 'America/Toronto')).toEqual({
      field: 'reminderHours',
      value: null,
    })
    for (const hours of ['24', '48', '168'])
      expect(parseTrainingClassField('reminderHours', hours, 'America/Toronto').value).toBe(
        Number(hours),
      )
    for (const invalid of ['0', '-24', '25', 'abc', null])
      expect(() => parseTrainingClassField('reminderHours', invalid, 'America/Toronto')).toThrow(
        'Choose a reminder time',
      )
  })
  it('parses bounded fields and viewer-local timestamps', () => {
    expect(parseTrainingClassField('courseId', ID, 'America/Toronto')).toEqual({
      field: 'courseId',
      value: ID,
    })
    expect(parseTrainingClassField('title', '  Lift training  ', 'America/Toronto')).toEqual({
      field: 'title',
      value: 'Lift training',
    })
    expect(
      parseTrainingClassField(
        'schedule',
        { startsAt: '2026-01-15T07:30', endsAt: '2026-01-15T12:00' },
        'America/Toronto',
      ),
    ).toEqual({
      field: 'schedule',
      value: {
        startsAt: new Date('2026-01-15T12:30:00.000Z'),
        endsAt: new Date('2026-01-15T17:00:00.000Z'),
      },
    })
    expect(parseTrainingClassField('capacity', '', 'America/Toronto')).toEqual({
      field: 'capacity',
      value: null,
    })
  })

  it('rejects malformed ids, values, and server-normalized dates', () => {
    expect(() => requireTrainingClassId('not-an-id')).toThrow(/invalid/)
    expect(() => parseTrainingClassField('unknown', 'x', 'America/Toronto')).toThrow(/invalid/)
    expect(() => parseTrainingClassField('title', 'x'.repeat(201), 'America/Toronto')).toThrow(
      /too long/,
    )
    expect(() => parseTrainingClassField('capacity', '12people', 'America/Toronto')).toThrow(
      /invalid/,
    )
    expect(() => parseTrainingClassField('capacity', '1001', 'America/Toronto')).toThrow(/range/)
    expect(() =>
      parseTrainingClassField(
        'schedule',
        { startsAt: '2026-02-30T09:00', endsAt: '2026-02-30T12:00' },
        'America/Toronto',
      ),
    ).toThrow(/invalid/)
  })

  it('edits the schedule as one wall-clock range', () => {
    expect(
      parseTrainingClassSchedule(
        { startsAt: '2026-07-13T09:00', endsAt: '2026-07-13T15:30' },
        'America/Vancouver',
      ),
    ).toEqual({
      startsAt: new Date('2026-07-13T16:00:00.000Z'),
      endsAt: new Date('2026-07-13T22:30:00.000Z'),
    })
    // Both times are required, and the old JSON-string form is gone.
    for (const invalid of [
      { startsAt: '2026-07-13T09:00', endsAt: '' },
      { startsAt: '', endsAt: '2026-07-13T15:30' },
      { startsAt: '2026-07-13T09:00' },
      JSON.stringify({ startsAt: '2026-07-13T09:00', endsAt: '2026-07-13T15:30' }),
      ['2026-07-13T09:00', '2026-07-13T15:30'],
      null,
    ])
      expect(() => parseTrainingClassSchedule(invalid, 'America/Vancouver')).toThrow(/invalid/)
    expect(() =>
      parseTrainingClassSchedule(
        { startsAt: '2026-07-13T15:30', endsAt: '2026-07-13T09:00' },
        'America/Vancouver',
      ),
    ).toThrow(/after its start/)
  })

  it('accepts and bounds a free-text class location', () => {
    expect(
      parseTrainingClassField('location', '  Shop classroom, 12 Main St  ', 'America/Toronto'),
    ).toEqual({ field: 'location', value: 'Shop classroom, 12 Main St' })
    expect(parseTrainingClassField('location', '', 'America/Toronto')).toEqual({
      field: 'location',
      value: null,
    })
    expect(() => parseTrainingClassField('location', 'x'.repeat(501), 'America/Toronto')).toThrow(
      /too long/,
    )
  })

  it('bounds class days and credited hours per day', () => {
    expect(parseTrainingClassField('lengthDays', '3', 'America/Toronto')).toEqual({
      field: 'lengthDays',
      value: 3,
    })
    expect(parseTrainingClassField('lengthDays', '', 'America/Toronto')).toEqual({
      field: 'lengthDays',
      value: null,
    })
    for (const invalid of ['0', '-1', '367', '2.5', 'many'])
      expect(() => parseTrainingClassField('lengthDays', invalid, 'America/Toronto')).toThrow()

    expect(parseTrainingClassField('hoursPerDay', '8', 'America/Toronto')).toEqual({
      field: 'hoursPerDay',
      value: '8',
    })
    expect(parseTrainingClassField('hoursPerDay', '7.50', 'America/Toronto')).toEqual({
      field: 'hoursPerDay',
      value: '7.5',
    })
    expect(parseTrainingClassField('hoursPerDay', '0.25', 'America/Toronto')).toEqual({
      field: 'hoursPerDay',
      value: '0.25',
    })
    expect(parseTrainingClassField('hoursPerDay', '', 'America/Toronto')).toEqual({
      field: 'hoursPerDay',
      value: null,
    })
    for (const invalid of ['0', '0.1', '8.3', '24.25', '-2', 'eight'])
      expect(() => parseTrainingClassField('hoursPerDay', invalid, 'America/Toronto')).toThrow()
  })

  it('parses the optional customer like other optional references', () => {
    expect(parseTrainingClassField('customerOrgUnitId', ID, 'America/Toronto')).toEqual({
      field: 'customerOrgUnitId',
      value: ID,
    })
    expect(parseTrainingClassField('customerOrgUnitId', '', 'America/Toronto')).toEqual({
      field: 'customerOrgUnitId',
      value: null,
    })
    expect(() => parseTrainingClassField('customerOrgUnitId', 'acme', 'America/Toronto')).toThrow(
      /invalid/,
    )
    // The retired Site field no longer exists.
    expect(() => parseTrainingClassField('siteOrgUnitId', ID, 'America/Toronto')).toThrow(/invalid/)
  })

  it('requires an ordered schedule', () => {
    const start = new Date('2026-07-13T13:00:00.000Z')
    expect(() => assertTrainingClassSchedule(start, start)).toThrow(/after/)
    expect(() => assertTrainingClassSchedule(start, new Date('2026-07-13T12:59:00.000Z'))).toThrow(
      /after/,
    )
    expect(() =>
      assertTrainingClassSchedule(start, new Date('2026-07-13T14:00:00.000Z')),
    ).not.toThrow()
  })

  it('enforces configured and absolute roster limits', () => {
    expect(() => assertTrainingClassCapacity(20, 19)).not.toThrow()
    expect(() => assertTrainingClassCapacity(20, 20)).toThrow(/capacity/)
    expect(() => assertTrainingClassCapacity(null, 1_000)).toThrow(/at most 1000/)
    expect(() => assertTrainingClassCapacity(null, -1)).toThrow(/invalid/)
  })

  it('parses one bounded completion page without partial numeric values', () => {
    const form = new FormData()
    form.append('attendeeId', ID)
    form.set(`attended__${ID}`, 'on')
    form.set(`passed__${ID}`, 'on')
    form.set(`grade__${ID}`, '87')
    form.set(`notes__${ID}`, '  Left early for a site call  ')
    expect(parseTrainingClassCompletionPage(form)).toEqual([
      {
        attendeeId: ID,
        attended: true,
        passed: true,
        grade: 87,
        notes: 'Left early for a site call',
      },
    ])

    form.set(`notes__${ID}`, '')
    expect(parseTrainingClassCompletionPage(form)[0]!.notes).toBeNull()
    form.set(`notes__${ID}`, 'x'.repeat(301))
    expect(() => parseTrainingClassCompletionPage(form)).toThrow(/too long/)
    form.delete(`notes__${ID}`)

    form.set(`grade__${ID}`, '87points')
    expect(() => parseTrainingClassCompletionPage(form)).toThrow(/invalid/)
  })

  it('rejects duplicate, oversized, and impossible completion decisions', () => {
    const duplicate = new FormData()
    duplicate.append('attendeeId', ID)
    duplicate.append('attendeeId', ID)
    expect(() => parseTrainingClassCompletionPage(duplicate)).toThrow(/invalid/)

    const noShowPass = new FormData()
    noShowPass.append('attendeeId', ID)
    noShowPass.set(`passed__${ID}`, 'on')
    expect(() => parseTrainingClassCompletionPage(noShowPass)).toThrow(/no-show/)

    const oversized = new FormData()
    for (let index = 0; index <= 100; index += 1) {
      oversized.append('attendeeId', `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    }
    expect(() => parseTrainingClassCompletionPage(oversized)).toThrow(/invalid/)
  })
})
