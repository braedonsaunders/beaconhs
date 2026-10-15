import { describe, expect, it } from 'vitest'
import { optionalDateInput, requiredDateInput } from '@/lib/mutation-input'
import { assertTrainingRecordDateOrder } from '../records/_mutation-input'
import { settledPartnerDate, type PartnerDate } from './record-date-order'

const parseExpiry = (wire: unknown) => optionalDateInput(wire, 'Expiry date')
const parseCompleted = (wire: unknown) => requiredDateInput(wire, 'Completed date')

function expiryPartner(
  current: string | null,
  patch?: { value: unknown; base: unknown },
): PartnerDate {
  return {
    current,
    parse: parseExpiry,
    patch: patch ? { fieldId: 'expiresOn', ...patch } : undefined,
  }
}

describe('settledPartnerDate', () => {
  it('is the stored value when the partner date is not in the batch', () => {
    expect(settledPartnerDate(expiryPartner('2026-06-01'))).toBe('2026-06-01')
  })

  it('is the queued value when that edit will apply', () => {
    expect(
      settledPartnerDate(expiryPartner('2026-06-01', { value: '2027-07-01', base: '2026-06-01' })),
    ).toBe('2027-07-01')
    // Clearing the expiry (no expiry) applies too.
    expect(
      settledPartnerDate(expiryPartner('2026-06-01', { value: '', base: '2026-06-01' })),
    ).toBeNull()
    // A base that only differs in form still matches the stored value.
    expect(
      settledPartnerDate(
        expiryPartner('2026-06-01', { value: '2027-07-01', base: ' 2026-06-01 ' }),
      ),
    ).toBe('2027-07-01')
  })

  it('is the stored value when the partner edit conflicts or is invalid', () => {
    // Someone else changed the expiry since this device saw it.
    expect(
      settledPartnerDate(expiryPartner('2026-08-01', { value: '2027-07-01', base: '2026-06-01' })),
    ).toBe('2026-08-01')
    expect(
      settledPartnerDate(expiryPartner('2026-06-01', { value: '2027-02-30', base: '2026-06-01' })),
    ).toBe('2026-06-01')
    expect(settledPartnerDate(expiryPartner('2026-06-01', { value: 42, base: '2026-06-01' }))).toBe(
      '2026-06-01',
    )
  })

  it('is the stored value once the partner edit has been written earlier in the batch', () => {
    expect(
      settledPartnerDate(expiryPartner('2027-07-01', { value: '2027-07-01', base: '2026-06-01' })),
    ).toBe('2027-07-01')
  })
})

describe('moving both dates of a certificate in one batch', () => {
  // Stored: completed 2026-05-01, expires 2026-06-01. The worker moves the
  // completion to July and the expiry to next July while offline.
  const completedPatch = { fieldId: 'completedOn', value: '2026-07-01', base: '2026-05-01' }
  const expiryPatch = { fieldId: 'expiresOn', value: '2027-07-01', base: '2026-06-01' }

  function validateCompleted(stored: { completedOn: string; expiresOn: string | null }) {
    const expiry = settledPartnerDate({
      patch: expiryPatch,
      current: stored.expiresOn,
      parse: parseExpiry,
    })
    assertTrainingRecordDateOrder(completedPatch.value, expiry)
  }
  function validateExpiry(stored: { completedOn: string; expiresOn: string | null }) {
    const completed =
      settledPartnerDate({
        patch: completedPatch,
        current: stored.completedOn,
        parse: parseCompleted,
      }) ?? stored.completedOn
    assertTrainingRecordDateOrder(completed, expiryPatch.value)
  }

  it('accepts the pair in either order, although July is after the old expiry', () => {
    // Completion first, against the stored row; then expiry after that write.
    expect(() =>
      validateCompleted({ completedOn: '2026-05-01', expiresOn: '2026-06-01' }),
    ).not.toThrow()
    expect(() =>
      validateExpiry({ completedOn: '2026-07-01', expiresOn: '2026-06-01' }),
    ).not.toThrow()
    // Expiry first, then completion after that write.
    expect(() =>
      validateExpiry({ completedOn: '2026-05-01', expiresOn: '2026-06-01' }),
    ).not.toThrow()
    expect(() =>
      validateCompleted({ completedOn: '2026-05-01', expiresOn: '2027-07-01' }),
    ).not.toThrow()
  })

  it('still refuses a completion after the stored expiry when the expiry edit conflicts', () => {
    const conflictingExpiry = { ...expiryPatch, base: '2026-05-20' }
    expect(() =>
      assertTrainingRecordDateOrder(
        completedPatch.value,
        settledPartnerDate({
          patch: conflictingExpiry,
          current: '2026-06-01',
          parse: parseExpiry,
        }),
      ),
    ).toThrow('Expiry date cannot be before the completed date.')
  })

  it('refuses both dates when the new pair is itself out of order', () => {
    const badExpiry = { ...expiryPatch, value: '2026-06-15' }
    const expiry = settledPartnerDate({
      patch: badExpiry,
      current: '2026-06-01',
      parse: parseExpiry,
    })
    expect(() => assertTrainingRecordDateOrder(completedPatch.value, expiry)).toThrow()
    const completed = settledPartnerDate({
      patch: completedPatch,
      current: '2026-05-01',
      parse: parseCompleted,
    })
    expect(() =>
      assertTrainingRecordDateOrder(completed ?? '2026-05-01', badExpiry.value),
    ).toThrow()
  })
})
