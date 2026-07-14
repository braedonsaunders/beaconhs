import { describe, expect, it } from 'vitest'
import {
  assertTrainingRecordDateOrder,
  parseTrainingRecordFieldUpdate,
  parseTrainingRecordRevocationReason,
} from './_mutation-input'

const ID = '10000000-0000-4000-8000-000000000001'

describe('training record mutation input', () => {
  it('validates identifiers and source values without coercion', () => {
    expect(parseTrainingRecordFieldUpdate('personId', ID)).toEqual({
      field: 'personId',
      value: ID,
    })
    expect(parseTrainingRecordFieldUpdate('source', 'external_upload')).toEqual({
      field: 'source',
      value: 'external_upload',
    })
    expect(() => parseTrainingRecordFieldUpdate('personId', 'invalid')).toThrow(/Person is invalid/)
    expect(() => parseTrainingRecordFieldUpdate('source', 'manual')).toThrow(
      /Record source is invalid/,
    )
  })

  it('rejects partial numbers and out-of-range grades instead of clamping them', () => {
    expect(parseTrainingRecordFieldUpdate('grade', '87')).toEqual({ field: 'grade', value: 87 })
    expect(parseTrainingRecordFieldUpdate('grade', '')).toEqual({ field: 'grade', value: null })
    for (const value of ['87%', '1.5', '-1', '101']) {
      expect(() => parseTrainingRecordFieldUpdate('grade', value)).toThrow()
    }
  })

  it('accepts only real date-only values and consistent date ranges', () => {
    expect(parseTrainingRecordFieldUpdate('completedOn', '2028-02-29')).toEqual({
      field: 'completedOn',
      value: '2028-02-29',
    })
    expect(() => parseTrainingRecordFieldUpdate('completedOn', '2027-02-29')).toThrow()
    expect(() => parseTrainingRecordFieldUpdate('expiresOn', '2027-01-01T12:00:00Z')).toThrow()
    expect(() => assertTrainingRecordDateOrder('2027-05-01', '2027-04-30')).toThrow(
      /cannot be before/,
    )
    expect(() => assertTrainingRecordDateOrder('2027-05-01', '2027-05-01')).not.toThrow()
  })

  it('rejects missing/non-string payloads and unrecognized fields', () => {
    expect(() => parseTrainingRecordFieldUpdate('notes', null)).toThrow(/value is invalid/)
    expect(() => parseTrainingRecordFieldUpdate('deletedAt', '')).toThrow(/field is invalid/)
  })

  it('normalizes and bounds optional revocation reasons', () => {
    expect(parseTrainingRecordRevocationReason(null)).toBeNull()
    expect(parseTrainingRecordRevocationReason('  replaced  ')).toBe('replaced')
    expect(() => parseTrainingRecordRevocationReason('x'.repeat(1_001))).toThrow(/too long/)
  })
})
