import { describe, expect, it } from 'vitest'
import { isEquipmentAvailableForCheckout, openCheckoutConflictMessage } from './equipment-custody'

describe('equipment custody policy', () => {
  it('only makes an in-service, present, unassigned item without an open checkout available', () => {
    const base = {
      status: 'in_service' as const,
      currentHolderPersonId: null,
      isMissing: false,
      hasOpenCheckout: false,
    }
    expect(isEquipmentAvailableForCheckout(base)).toBe(true)
    for (const status of ['out_of_service', 'in_repair', 'lost', 'retired'] as const) {
      expect(isEquipmentAvailableForCheckout({ ...base, status })).toBe(false)
    }
    expect(isEquipmentAvailableForCheckout({ ...base, currentHolderPersonId: 'person-id' })).toBe(
      false,
    )
    expect(isEquipmentAvailableForCheckout({ ...base, isMissing: true })).toBe(false)
    expect(isEquipmentAvailableForCheckout({ ...base, hasOpenCheckout: true })).toBe(false)
  })

  it('names direct-custody conflicts without producing an unbounded error', () => {
    expect(openCheckoutConflictMessage([{ assetTag: 'EQ-1' }])).toBe(
      'Check in this item before changing direct custody: EQ-1.',
    )
    expect(
      openCheckoutConflictMessage(
        ['EQ-1', 'EQ-2', 'EQ-3', 'EQ-4'].map((assetTag) => ({ assetTag })),
      ),
    ).toBe('Check in these items before changing direct custody: EQ-1, EQ-2, EQ-3 and 1 more.')
  })
})
