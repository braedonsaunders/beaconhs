import { describe, expect, it } from 'vitest'
import { DESIGN_DOCUMENT_LIMITS, slugId } from './schema'

describe('slugId', () => {
  it('normalizes separators in one bounded pass', () => {
    expect(slugId('  Front / Wallet___Card  ', 'fallback')).toBe('front-wallet-card')
    expect(slugId('---', 'fallback')).toBe('fallback')
    expect(slugId(`${'x'.repeat(50_000)} tail`, 'fallback')).toHaveLength(
      DESIGN_DOCUMENT_LIMITS.idLength,
    )
    expect(slugId(`${'x'.repeat(79)} tail`, 'fallback')).toHaveLength(
      DESIGN_DOCUMENT_LIMITS.idLength,
    )
  })
})
