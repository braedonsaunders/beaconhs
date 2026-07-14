import { describe, expect, it } from 'vitest'
import {
  assertVehicleLogImportPayload,
  collectVehicleLogOrgUnitCandidates,
  normalizeVehicleLogImportUrl,
  prepareVehicleLogImportDays,
  validateVehicleLogImportEndpoint,
  VEHICLE_LOG_IMPORT_LIMITS,
} from './vehicle-log-import-policy'

describe('vehicle log import endpoint policy', () => {
  it('requires an HTTPS URL without embedded credentials', () => {
    expect(normalizeVehicleLogImportUrl('https://8.8.8.8/monthly')).toBe('https://8.8.8.8/monthly')
    expect(() => normalizeVehicleLogImportUrl('http://8.8.8.8/monthly')).toThrow(/must use HTTPS/)
    expect(() => normalizeVehicleLogImportUrl('https://user:pass@8.8.8.8/monthly')).toThrow(
      /must not include credentials/,
    )
  })

  it('rejects private endpoints before a bearer token is decrypted', async () => {
    await expect(validateVehicleLogImportEndpoint('https://127.0.0.1/monthly')).rejects.toThrow(
      /blocked non-public/,
    )
    await expect(validateVehicleLogImportEndpoint('https://localhost/monthly')).rejects.toThrow(
      /reserved for local or private use/,
    )
  })

  it('fails closed on missing, malformed, or oversized provider entries', () => {
    expect(() => assertVehicleLogImportPayload({})).toThrow(/entries array/)
    expect(() => assertVehicleLogImportPayload({ entries: [null] })).toThrow(/entry 1/)
    expect(() =>
      assertVehicleLogImportPayload({
        entries: Array.from({ length: VEHICLE_LOG_IMPORT_LIMITS.entries + 1 }, () => ({})),
      }),
    ).toThrow(/more than 1,000 entries/)
    expect(() =>
      assertVehicleLogImportPayload({
        entries: [{ sourceExternalId: 'x'.repeat(256) }],
      }),
    ).toThrow(/sourceExternalId/)
  })

  it('bounds nested raw data and numeric provider statistics', () => {
    expect(() =>
      assertVehicleLogImportPayload({
        entries: [{ raw: { value: 'x'.repeat(VEHICLE_LOG_IMPORT_LIMITS.rawEntryBytes) } }],
      }),
    ).toThrow(/raw exceeds/)
    expect(() => assertVehicleLogImportPayload({ entries: [], stats: { pulled: -1 } })).toThrow(
      /non-negative whole number/,
    )
    expect(() => assertVehicleLogImportPayload({ entries: [], stats: { resolved: 1.5 } })).toThrow(
      /non-negative whole number/,
    )
  })

  it('accepts a bounded provider response', () => {
    const payload: unknown = {
      entries: [
        {
          sourceExternalId: 'trip-1',
          date: '2026-07-01',
          customerCode: 'C2-10',
          businessKm: 42.5,
          raw: { route: 'A' },
        },
      ],
      source: { provider: 'approved-test-provider' },
      stats: { pulled: 1, resolved: 1 },
    }
    expect(() => assertVehicleLogImportPayload(payload)).not.toThrow()
  })

  it('deduplicates identical days and rejects order-dependent conflicting days', () => {
    const entry = {
      date: '2026-07-03',
      sourceExternalId: 'trip-3',
      businessKm: 12,
      skipReason: null,
      raw: { route: { end: 'B', start: 'A' } },
    }
    const duplicateWithDifferentObjectKeyOrder = {
      ...entry,
      raw: { route: { start: 'A', end: 'B' } },
    }
    expect(
      prepareVehicleLogImportDays(
        [entry, duplicateWithDifferentObjectKeyOrder],
        '2026-07-01',
        '2026-08-01',
      ),
    ).toMatchObject({ entries: [entry], skipped: 1 })
    expect(() =>
      prepareVehicleLogImportDays(
        [entry, { ...entry, businessKm: 13 }],
        '2026-07-01',
        '2026-08-01',
      ),
    ).toThrow(/conflicting entries for 2026-07-03/)
  })

  it('rejects invalid dates and returns only exact bounded org-unit lookup keys', () => {
    expect(
      prepareVehicleLogImportDays(
        [
          {
            date: '2026-02-30',
            sourceExternalId: 'trip-invalid',
            businessKm: 10,
            skipReason: null,
          },
        ],
        '2026-02-01',
        '2026-03-01',
      ),
    ).toEqual({ entries: [], skipped: 1 })

    expect(
      collectVehicleLogOrgUnitCandidates([
        {
          customerExternalId: ' 99 ',
          customerLegacyId: 'Legacy',
          customerCode: 'ABC',
          customerShortform: 'North',
          customerName: 'Main Site',
        },
      ]),
    ).toEqual({
      codes: ['abc', 'legacy', 'north', '99', 'c2-legacy', 'c2-abc', 'c2-99'],
      names: ['main site'],
      externalIds: ['99', 'legacy'],
    })
  })
})
