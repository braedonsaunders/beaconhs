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
  // Friday 2026-10-16 11:30 PM in Toronto is already Saturday in UTC.
  const fridayLateToronto = '2026-10-17T03:30:00.000Z'
  const toronto = buildWeekRows(fridayLateToronto, 8, 1, 'America/Toronto')
  assert.equal(toronto.length, 1)
  assert.equal(toronto[0]?.dateStart, '2026-10-11') // week starts Sunday Oct 11
  assert.deepEqual(toronto[0]?.dayHours, [0, 0, 0, 0, 0, 8, 0]) // credited Friday

  // The same instant read in UTC lands on Saturday, which is not a class day,
  // so it rolls forward to Monday of the next week.
  const utc = buildWeekRows(fridayLateToronto, 8, 1, 'UTC')
  assert.equal(utc[0]?.dateStart, '2026-10-18')
  assert.deepEqual(utc[0]?.dayHours, [0, 8, 0, 0, 0, 0, 0])
})

test('buildWeekRows credits weekdays only across a weekend', () => {
  // A 4-day class starting Friday runs Fri, Mon, Tue, Wed — never Sat/Sun.
  const rows = buildWeekRows('2026-10-16T12:00:00.000Z', 8, 4, 'America/Toronto')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0]?.dayHours, [0, 0, 0, 0, 0, 8, 0]) // Fri of week 1
  assert.deepEqual(rows[1]?.dayHours, [0, 8, 8, 8, 0, 0, 0]) // Mon–Wed of week 2

  const fallback = buildWeekRows('2026-10-16T12:00:00.000Z', 8, 1, 'Not/AZone')
  assert.equal(fallback[0]?.dateStart, '2026-10-11')
})

test('weekly sub-items carry tenant-timezone week boundaries through', () => {
  const [row] = weeklySubItems({
    startsAt: '2026-10-19T11:30:00.000Z', // Monday 7:30 AM Toronto
    hoursPerDay: 8,
    lengthDays: 1,
    timeZone: 'America/Toronto',
    attended: true,
  })
  assert.equal(row?.dateStart, '2026-10-18')
  assert.equal(row?.dateEnd, '2026-10-24')
  assert.equal(row?.day1Hours, 0) // Sunday is never a class day
  assert.equal(row?.day2Hours, 8) // Monday
  assert.equal(row?.weekHours, 8)
})
