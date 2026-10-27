import assert from 'node:assert/strict'
import test from 'node:test'
import { eventBodyFor, methodFor, parseMethodMap, responseWarnings } from './destinations/http'
import {
  trainingClassScheduleChangedEvent,
  type TrainingClassScheduleAttendeeFact,
} from './triggers/emit'
import { getTrigger, sampleItem } from './triggers/registry'

function attendee(
  over: Partial<TrainingClassScheduleAttendeeFact>,
): TrainingClassScheduleAttendeeFact {
  return {
    personId: 'p1',
    externalEmployeeId: 'E-1',
    firstName: 'Sam',
    lastName: 'Rivera',
    departmentName: 'Field Ops',
    status: 'registered',
    ...over,
  }
}

const base = {
  classId: 'class-1',
  status: 'scheduled' as const,
  course: { code: 'WHMIS', name: 'WHMIS 2015' },
  title: 'WHMIS — June cohort',
  startsAt: '2026-06-01T11:30:00.000Z',
  endsAt: '2026-06-01T19:30:00.000Z',
  classDays: ['2026-06-01', '2026-06-02'],
  hoursPerDay: 8,
  lengthDays: 2,
  timeZone: 'America/Toronto',
}

test('schedule snapshot carries one item per active attendee with the full class state', () => {
  const event = trainingClassScheduleChangedEvent('tenant-1', {
    ...base,
    attendees: [
      attendee({}),
      attendee({ personId: 'p2', status: 'attended', externalEmployeeId: null }),
      attendee({ personId: 'p3', status: 'no_show' }),
      attendee({ personId: 'p4', status: 'cancelled' }),
    ],
  })
  assert.equal(event.type, 'training.class.schedule_changed')
  assert.equal(event.subjectId, 'class-1')
  assert.equal(event.items.length, 2)
  const first = event.items[0]!
  assert.equal(first.status, 'scheduled')
  assert.equal(first['course.code'], 'WHMIS')
  assert.equal(first.classDays, '2026-06-01,2026-06-02')
  assert.equal(first.classDayCount, 2)
  assert.equal(first.attendeeCount, 2)
  assert.equal(first.externalEmployeeId, 'E-1')
  // An attendee without an employee id stays in the snapshot (destinations
  // skip + warn); the event itself never drops them silently.
  assert.equal(event.items[1]!.externalEmployeeId, null)
})

test('an empty roster still emits one class-only item so removals land', () => {
  const event = trainingClassScheduleChangedEvent('tenant-1', {
    ...base,
    status: 'cancelled',
    attendees: [],
  })
  assert.equal(event.items.length, 1)
  assert.equal(event.items[0]!.status, 'cancelled')
  assert.equal(event.items[0]!.attendeeCount, 0)
  assert.equal(event.items[0]!.personId, null)
})

test('the trigger is registered for the builder with a sample item', () => {
  const trigger = getTrigger('training.class.schedule_changed')
  assert.ok(trigger)
  assert.equal(trigger.itemScope, 'collection')
  const sample = sampleItem(trigger)
  assert.equal(sample.status, 'scheduled')
  assert.equal(sample.classDays, '2026-06-01,2026-06-02')
})

test('method overrides parse value=METHOD pairs and ignore junk', () => {
  assert.deepEqual(parseMethodMap('cancelled=DELETE, deleted = delete, bogus, x=FLY'), {
    cancelled: 'DELETE',
    deleted: 'DELETE',
  })
  assert.deepEqual(parseMethodMap(''), {})
  assert.deepEqual(parseMethodMap(undefined), {})
})

test('methodFor falls back to the configured method', () => {
  const cfg = {
    method: 'PUT' as const,
    url: 'https://example.com',
    contentType: 'application/json',
    authHeaderName: 'Authorization',
    methodField: 'status',
    methodMap: parseMethodMap('cancelled=DELETE,deleted=DELETE'),
  }
  assert.equal(methodFor(cfg, { status: 'scheduled' }), 'PUT')
  assert.equal(methodFor(cfg, { status: 'cancelled' }), 'DELETE')
  assert.equal(methodFor(cfg, { status: 'deleted' }), 'DELETE')
  assert.equal(methodFor(cfg, {}), 'PUT')
  assert.equal(methodFor({ ...cfg, methodField: '' }, { status: 'cancelled' }), 'PUT')
})

test('whole-event body defaults to the raw envelope and supports {{items}} templates', () => {
  const ctx = {
    triggerKey: 'training.class.schedule_changed',
    subjectId: 'class-1',
    items: [{ classId: 'class-1', status: 'scheduled' }],
  }
  assert.deepEqual(JSON.parse(eventBodyFor({}, ctx)), {
    trigger: 'training.class.schedule_changed',
    subjectId: 'class-1',
    items: [{ classId: 'class-1', status: 'scheduled' }],
  })
  const templated = eventBodyFor(
    { body: '{"id":"{{subjectId}}","status":"{{status}}","attendees":{{items}}}' },
    ctx,
  )
  assert.deepEqual(JSON.parse(templated), {
    id: 'class-1',
    status: 'scheduled',
    attendees: [{ classId: 'class-1', status: 'scheduled' }],
  })
  // No items at all still produces a sendable body.
  assert.deepEqual(JSON.parse(eventBodyFor({}, { ...ctx, items: [] })).items, [])
})

test('response warnings read warnings and skipped entries from JSON', () => {
  assert.deepEqual(responseWarnings(''), [])
  assert.deepEqual(responseWarnings('not json'), [])
  assert.deepEqual(responseWarnings('{"ok":true}'), [])
  assert.deepEqual(
    responseWarnings(
      JSON.stringify({
        warnings: [
          'Row held back',
          { message: 'Protected booking kept', fullName: 'Sam Rivera', date: '2026-06-01' },
        ],
        skipped: [{ reason: 'no employee ID', externalEmployeeId: 'E-9' }, { nope: true }],
      }),
    ),
    ['Row held back', 'Sam Rivera · 2026-06-01: Protected booking kept', 'E-9: no employee ID'],
  )
})
