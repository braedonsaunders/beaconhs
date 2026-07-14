import { describe, expect, it } from 'vitest'
import {
  assertTrainingClassCapacity,
  assertTrainingClassSchedule,
  parseTrainingClassField,
  parseTrainingClassCompletionPage,
  requireTrainingClassId,
} from './training-class-policy'

const ID = '10000000-0000-4000-8000-000000000001'

describe('training class mutation policy', () => {
  it('parses bounded fields and viewer-local timestamps', () => {
    expect(parseTrainingClassField('courseId', ID, 'America/Toronto')).toEqual({
      field: 'courseId',
      value: ID,
    })
    expect(parseTrainingClassField('title', '  Lift training  ', 'America/Toronto')).toEqual({
      field: 'title',
      value: 'Lift training',
    })
    expect(parseTrainingClassField('startsAt', '2026-01-15T14:30', 'America/Toronto')).toEqual({
      field: 'startsAt',
      value: new Date('2026-01-15T19:30:00.000Z'),
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
    expect(() => parseTrainingClassField('endsAt', '2026-02-30T09:00', 'America/Toronto')).toThrow(
      /invalid/,
    )
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
    expect(parseTrainingClassCompletionPage(form)).toEqual([
      { attendeeId: ID, attended: true, passed: true, grade: 87 },
    ])

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
