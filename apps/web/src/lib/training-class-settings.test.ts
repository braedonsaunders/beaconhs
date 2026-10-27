import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { trackClassCustomerFromSettings } from './training-class-settings'

describe('training class customer tracking setting', () => {
  it('is off unless explicitly enabled', () => {
    for (const settings of [
      null,
      undefined,
      {},
      { training: null },
      { training: {} },
      { training: { trackClassCustomer: false } },
      { training: { trackClassCustomer: 'true' } },
      'training',
    ]) {
      expect(trackClassCustomerFromSettings(settings)).toBe(false)
    }
  })

  it('turns on only for the boolean true flag', () => {
    expect(trackClassCustomerFromSettings({ training: { trackClassCustomer: true } })).toBe(true)
  })
})
