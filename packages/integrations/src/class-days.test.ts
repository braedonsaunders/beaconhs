import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarDateInTimeZone,
  deriveClassLengthDays,
  expandClassDays,
  resolveClassCredit,
} from './class-days'

const TZ = 'America/Toronto'
// 2026-10-16 is a Friday; 2026-10-19 a Monday (EDT, UTC-4).
const fri = new Date('2026-10-16T12:30:00.000Z') // Fri 8:30 AM Toronto
const friEnd = new Date('2026-10-16T20:30:00.000Z') // Fri 4:30 PM Toronto

test('calendarDateInTimeZone resolves the tenant calendar day, not UTC', () => {
  // Sunday 10:30 PM Toronto is already Monday in UTC.
  const sundayEvening = new Date('2026-10-19T02:30:00.000Z')
  assert.equal(calendarDateInTimeZone(sundayEvening, TZ).toISOString().slice(0, 10), '2026-10-18')
  assert.equal(
    calendarDateInTimeZone(sundayEvening, 'UTC').toISOString().slice(0, 10),
    '2026-10-19',
  )
  assert.equal(
    calendarDateInTimeZone(sundayEvening, 'Not/AZone').toISOString().slice(0, 10),
    '2026-10-19',
  )
})

test('explicit lengthDays expands across weekdays only, skipping the weekend', () => {
  assert.deepEqual(
    expandClassDays({ startsAt: fri, endsAt: friEnd, lengthDays: 3, timeZone: TZ }),
    [
      '2026-10-16', // Fri
      '2026-10-19', // Mon
      '2026-10-20', // Tue
    ],
  )
})

test('a weekend start with an explicit length rolls forward to Monday', () => {
  const sat = new Date('2026-10-17T13:00:00.000Z') // Sat 9 AM Toronto
  assert.deepEqual(expandClassDays({ startsAt: sat, endsAt: sat, lengthDays: 2, timeZone: TZ }), [
    '2026-10-19',
    '2026-10-20',
  ])
})

test('without lengthDays the weekdays inside the span are the class days', () => {
  const wedEnd = new Date('2026-10-21T20:30:00.000Z') // Wed 4:30 PM Toronto
  assert.deepEqual(
    expandClassDays({ startsAt: fri, endsAt: wedEnd, lengthDays: null, timeZone: TZ }),
    ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'],
  )
  assert.equal(deriveClassLengthDays(fri, wedEnd, TZ), 4)
})

test('a weekend-only class entered by start/end still counts once', () => {
  const sat = new Date('2026-10-17T13:00:00.000Z')
  const satEnd = new Date('2026-10-17T21:00:00.000Z')
  assert.deepEqual(
    expandClassDays({ startsAt: sat, endsAt: satEnd, lengthDays: null, timeZone: TZ }),
    ['2026-10-17'],
  )
  assert.equal(deriveClassLengthDays(sat, satEnd, TZ), 1)
})

test('deriveClassLengthDays never returns less than one', () => {
  assert.equal(deriveClassLengthDays(friEnd, fri, TZ), 1) // end before start
  assert.equal(deriveClassLengthDays(fri, friEnd, TZ), 1)
  assert.equal(
    deriveClassLengthDays(
      new Date('2026-09-30T12:00:00.000Z'),
      new Date('2026-10-02T20:00:00.000Z'),
      TZ,
    ),
    3, // Wed Sep 30, Thu Oct 1, Fri Oct 2 — month boundary
  )
})

test('resolveClassCredit defaults to 8 paid hours per day, not the clock span', () => {
  // 8.5 clock hours Fri (lunch included) must still credit the paid default.
  const credit = resolveClassCredit({
    startsAt: fri,
    endsAt: new Date('2026-10-16T21:00:00.000Z'),
    lengthDays: null,
    hoursPerDay: null,
    timeZone: TZ,
  })
  assert.deepEqual(credit, { days: ['2026-10-16'], lengthDays: 1, hoursPerDay: 8, totalHours: 8 })
})

test('resolveClassCredit honours explicit days and hours', () => {
  const credit = resolveClassCredit({
    startsAt: fri,
    endsAt: friEnd,
    lengthDays: 3,
    hoursPerDay: 7.5,
    timeZone: TZ,
  })
  assert.equal(credit.lengthDays, 3)
  assert.equal(credit.hoursPerDay, 7.5)
  assert.equal(credit.totalHours, 22.5)
  assert.deepEqual(credit.days, ['2026-10-16', '2026-10-19', '2026-10-20'])
})

test('invalid explicit values fall back instead of producing nonsense', () => {
  const credit = resolveClassCredit({
    startsAt: fri,
    endsAt: friEnd,
    lengthDays: 0,
    hoursPerDay: 0,
    timeZone: TZ,
  })
  assert.equal(credit.lengthDays, 1)
  assert.equal(credit.hoursPerDay, 8)
})
