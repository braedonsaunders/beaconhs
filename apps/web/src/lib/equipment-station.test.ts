import { describe, expect, it } from 'vitest'
import { parseStationScanInput } from './equipment-station'

const PERSON = '00000000-0000-4000-8000-000000000001'

describe('equipment station scan input', () => {
  it('normalizes a valid scan and bounded notes', () => {
    expect(
      parseStationScanInput({
        code: '  EQ-101 ',
        activePersonId: PERSON,
        direction: 'out',
        expectedReturnOn: '2026-07-31',
        returnedNotes: ' ready ',
      }),
    ).toEqual({
      code: 'EQ-101',
      activePersonId: PERSON,
      destinationOrgUnitId: undefined,
      direction: 'out',
      expectedReturnOn: '2026-07-31',
      condition: undefined,
      returnedNotes: 'ready',
    })
  })

  it('rejects malformed ids, dates, directions, oversized codes, and oversized notes', () => {
    expect(parseStationScanInput({ code: 'EQ', activePersonId: 'not-a-uuid' })).toBeNull()
    expect(parseStationScanInput({ code: 'EQ', expectedReturnOn: '2026-02-31' })).toBeNull()
    expect(parseStationScanInput({ code: 'EQ', direction: 'sideways' })).toBeNull()
    expect(parseStationScanInput({ code: 'x'.repeat(201) })).toBeNull()
    expect(parseStationScanInput({ code: 'EQ', returnedNotes: 'x'.repeat(2_001) })).toBeNull()
  })
})
