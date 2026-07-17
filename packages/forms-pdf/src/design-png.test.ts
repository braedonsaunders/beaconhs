import { describe, expect, it } from 'vitest'
import { createWalletDesignDocument } from '@beaconhs/design-studio'
import { renderDesignDocumentPngs } from './index'

// A cold Chromium launch plus two 300-DPI screenshots can exceed Vitest's
// default timeout on shared CI runners. Each page render already has its own
// bounded timeout; this outer bound allows both renders and browser startup.
const RENDER_TEST_TIMEOUT_MS = 90_000

describe('design studio PNG rendering', () => {
  it(
    'renders both CR80 faces at printer resolution',
    async () => {
      const document = createWalletDesignDocument({
        primary: '#174033',
        accent: '#d98a1f',
        paper: '#f7fbf7',
        typeface: 'technical',
      })
      const images = await renderDesignDocumentPngs({
        document,
        data: {
          tenantName: 'BeaconHS',
          recipientFullName: 'Alex Worker',
          credentialName: 'Site Orientation',
        },
        dpi: 300,
      })

      expect(images).toHaveLength(2)
      for (const image of images) {
        expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        expect(image.readUInt32BE(16)).toBeGreaterThanOrEqual(1000)
        expect(image.readUInt32BE(20)).toBeGreaterThanOrEqual(630)
      }
    },
    RENDER_TEST_TIMEOUT_MS,
  )
})
