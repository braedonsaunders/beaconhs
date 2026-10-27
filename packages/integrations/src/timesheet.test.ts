import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWeekRows, weeklySubItems } from './destinations/sql'
import { trainingClassCompletedEvent, type TrainingAttendeeFact } from './triggers/emit'

function fact(over: Partial<TrainingAttendeeFact>): TrainingAttendeeFact {
  return {
    personId: 'p1',
    externalEmployeeId: 'E-1',
    firstName: 'Sam',
    lastName: 'Rivera',
    departmentName: 'Field Ops',
    attended: true,
    hours: 8,
    ...over,
  }
}

const base = {
  classId: 'class-1',
  course: { code: 'WHMIS', name: 'WHMIS 2015' },
  startsAt: '2026-10-19T11:30:00.000Z', // Mon 7:30 AM America/Toronto (EDT)
  endsAt: '2026-10-19T19:30:00.000Z',
  hoursPerDay: 8,
  lengthDays: 1,
  timeZone: 'America/Toronto',
}

test('training class completed event credits attended attendees only', () => {
  const event = trainingClassCompletedEvent('tenant-1', {
    ...base,
    attendees: [
      fact({ personId: 'attended' }),
      fact({ personId: 'no-show', attended: false, hours: 0 }),
    ],
  })
  assert.equal(event.items.length, 1)
  assert.equal(event.items[0]?.personId, 'attended')
  assert.equal(event.items[0]?.role, 'attendee')
  assert.equal(event.items[0]?.timeZone, 'America/Toronto')
})

test('training class completed event also credits the internal instructor once', () => {
  const event = trainingClassCompletedEvent('tenant-1', {
    ...base,
    attendees: [fact({ personId: 'attended' })],
    instructor: fact({ personId: 'trainer', externalEmployeeId: 'E-9' }),
  })
  assert.deepEqual(
    event.items.map((i) => [i.personId, i.role]),
    [
      ['attended', 'attendee'],
      ['trainer', 'instructor'],
    ],
  )
})

test('instructor is skipped without an employee id or when already an attended attendee', () => {
  const noId = trainingClassCompletedEvent('tenant-1', {
    ...base,
    attendees: [fact({ personId: 'attended' })],
    instructor: fact({ personId: 'trainer', externalEmployeeId: null }),
  })
  assert.equal(noId.items.length, 1)

  const duplicate = trainingClassCompletedEvent('tenant-1', {
    ...base,
    attendees: [fact({ personId: 'trainer' })],
    instructor: fact({ personId: 'trainer' }),
  })
  assert.equal(duplicate.items.length, 1)
  assert.equal(duplicate.items[0]?.role, 'instructor')
})

test('weekly sub-items never credit a no-show from a legacy payload', () => {
  assert.deepEqual(
    weeklySubItems({
      startsAt: base.startsAt,
      hoursPerDay: 8,
      lengthDays: 1,
      attended: false,
    }),
    [],
  )
})

test('buildWeekRows uses tenant-timezone calendar days, not UTC', () => {
  // Sunday 2026-10-18 10:30 PM in Toronto is already Monday 2026-10-19 in UTC.
  const sundayEveningToronto = '2026-10-19T02:30:00.000Z'
  const toronto = buildWeekRows(sundayEveningToronto, 8, 1, 'America/Toronto')
  assert.equal(toronto.length, 1)
  assert.equal(toronto[0]?.dateStart, '2026-10-18') // week starts Sunday Oct 18
  assert.deepEqual(toronto[0]?.dayHours, [8, 0, 0, 0, 0, 0, 0]) // credited Sunday

  // The same instant read in UTC lands on Monday — the old (buggy) placement.
  const utc = buildWeekRows(sundayEveningToronto, 8, 1, 'UTC')
  assert.deepEqual(utc[0]?.dayHours, [0, 8, 0, 0, 0, 0, 0])
})

test('buildWeekRows spans weeks and falls back to UTC for an unknown zone', () => {
  const rows = buildWeekRows('2026-10-16T12:00:00.000Z', 8, 4, 'America/Toronto')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0]?.dayHours, [0, 0, 0, 0, 0, 8, 8]) // Fri+Sat of week 1
  assert.deepEqual(rows[1]?.dayHours, [8, 8, 0, 0, 0, 0, 0]) // Sun+Mon of week 2

  const fallback = buildWeekRows('2026-10-16T12:00:00.000Z', 8, 1, 'Not/AZone')
  assert.equal(fallback[0]?.dateStart, '2026-10-11')
})

test('weekly sub-items carry tenant-timezone week boundaries through', () => {
  const [row] = weeklySubItems({
    startsAt: '2026-10-19T02:30:00.000Z',
    hoursPerDay: 8,
    lengthDays: 1,
    timeZone: 'America/Toronto',
    attended: true,
  })
  assert.equal(row?.dateStart, '2026-10-18')
  assert.equal(row?.dateEnd, '2026-10-24')
  assert.equal(row?.day1Hours, 8)
  assert.equal(row?.weekHours, 8)
})
