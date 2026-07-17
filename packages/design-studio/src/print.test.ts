import { describe, expect, it } from 'vitest'
import type { DesignDocument, PrintProvider } from './schema'
import { directPrintProvider } from './print'

function design(provider: PrintProvider): DesignDocument {
  return {
    version: 1,
    engine: 'fabric',
    kind: 'person-badge',
    name: 'Badge',
    unit: 'in',
    dpi: 300,
    artboards: [
      {
        id: 'front',
        name: 'Front',
        format: 'cr80-front',
        width: 3.375,
        height: 2.125,
        background: '#ffffff',
        printProfile: { provider, media: 'cr80' },
        elements: [],
      },
    ],
  }
}

describe('directPrintProvider', () => {
  it.each(['cardpresso-wps', 'zebra-browser-print', 'evolis-sdk', 'hid-fargo-sdk'] as const)(
    'returns the configured %s provider',
    (provider) => {
      expect(directPrintProvider(design(provider))).toBe(provider)
    },
  )

  it('keeps normal PDF output out of direct-print routes', () => {
    expect(directPrintProvider(design('browser-pdf'))).toBeNull()
  })
})
