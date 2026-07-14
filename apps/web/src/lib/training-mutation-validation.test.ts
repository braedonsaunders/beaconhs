import { describe, expect, it } from 'vitest'
import {
  assertExactTrainingOrder,
  assertLessonCourse,
  assertTrainingEnrollmentOpen,
  MAX_TRAINING_DURATION_MINUTES,
  minimumTimeRemainingSeconds,
  optionalTrainingInteger,
  optionalTrainingUuid,
  parsePracticalCriteria,
  parsePracticalEvaluationResults,
  parseTrainingOrder,
  parseTrainingTags,
  requireTrainingEnum,
  TRAINING_LESSON_KINDS,
} from './training-mutation-validation'

const ID_A = '10000000-0000-4000-8000-000000000001'
const ID_B = '10000000-0000-4000-8000-000000000002'

describe('training mutation validation', () => {
  it('rejects forged enums, malformed identifiers, and lossy numeric coercion', () => {
    expect(() => requireTrainingEnum('admin', TRAINING_LESSON_KINDS, 'Lesson type')).toThrow(
      /invalid/,
    )
    expect(() => optionalTrainingUuid('not-a-uuid', 'Attachment')).toThrow(/invalid/)
    expect(optionalTrainingUuid('', 'Attachment')).toBeNull()
    for (const value of ['Infinity', '1.5', '-1', '1e3', 'NaN']) {
      expect(() =>
        optionalTrainingInteger(value, 'Duration', MAX_TRAINING_DURATION_MINUTES),
      ).toThrow(/whole number/)
    }
    expect(optionalTrainingInteger('15', 'Duration', MAX_TRAINING_DURATION_MINUTES)).toBe(15)
  })

  it('normalizes bounded tags and rejects malformed or duplicate practical criteria', () => {
    expect(parseTrainingTags(' induction, safety, induction ')).toEqual(['induction', 'safety'])
    expect(
      parsePracticalCriteria(
        JSON.stringify([
          { id: ID_A, text: 'Inspect the harness' },
          { id: 's_fallback', text: '  Confirm the anchor  ' },
        ]),
      ),
    ).toEqual([
      { id: ID_A, text: 'Inspect the harness' },
      { id: 's_fallback', text: 'Confirm the anchor' },
    ])
    expect(() => parsePracticalCriteria('{broken')).toThrow(/invalid/)
    expect(() =>
      parsePracticalCriteria(
        JSON.stringify([
          { id: ID_A, text: 'First' },
          { id: ID_A, text: 'Duplicate' },
        ]),
      ),
    ).toThrow(/unique/)
    expect(() =>
      parsePracticalCriteria(JSON.stringify([{ id: '__proto__', text: 'Unsafe' }])),
    ).toThrow(/valid id/)
  })

  it('normalizes only the configured practical criteria and enforces a real pass', () => {
    const criteria = [
      { id: 'harness', text: 'Inspect the harness' },
      { id: 'anchor', text: 'Confirm the anchor' },
    ]
    expect(parsePracticalEvaluationResults({ harness: true }, criteria, false)).toEqual({
      harness: true,
      anchor: false,
    })
    expect(() =>
      parsePracticalEvaluationResults({ harness: true, anchor: false }, criteria, true),
    ).toThrow(/Every practical criterion/)
    expect(() =>
      parsePracticalEvaluationResults(
        { harness: true, anchor: true, forged: true },
        criteria,
        true,
      ),
    ).toThrow(/invalid/)
    expect(
      parsePracticalEvaluationResults({ harness: true, anchor: true }, criteria, true),
    ).toEqual({ harness: true, anchor: true })
  })

  it('accepts only a complete, unique ordering of the expected parent records', () => {
    const ordered = parseTrainingOrder([ID_B, ID_A], 'Module')
    expect(ordered).toEqual([ID_B, ID_A])
    expect(() => parseTrainingOrder([ID_A, ID_A], 'Module')).toThrow(/duplicates/)
    expect(() => assertExactTrainingOrder([ID_A, ID_B], ordered, 'Module')).not.toThrow()
    expect(() => assertExactTrainingOrder([ID_A], ordered, 'Module')).toThrow(/stale/)
  })

  it('binds lessons to the enrollment course and computes a server-time minimum', () => {
    expect(() => assertLessonCourse(ID_A, ID_B)).toThrow(/Lesson not found/)
    expect(() => assertLessonCourse(ID_A, ID_A)).not.toThrow()
    const started = new Date('2026-07-13T12:00:00.000Z')
    expect(minimumTimeRemainingSeconds(started, 120, new Date('2026-07-13T12:00:45.900Z'))).toBe(75)
    expect(minimumTimeRemainingSeconds(started, 120, new Date('2026-07-13T12:02:00.000Z'))).toBe(0)
    expect(minimumTimeRemainingSeconds(null, 120)).toBe(120)
  })

  it('permits runtime writes only for an in-progress enrollment', () => {
    expect(() => assertTrainingEnrollmentOpen('in_progress')).not.toThrow()
    for (const status of ['not_started', 'completed', 'expired', 'withdrawn', null]) {
      expect(() => assertTrainingEnrollmentOpen(status)).toThrow(/not active/)
    }
  })
})
