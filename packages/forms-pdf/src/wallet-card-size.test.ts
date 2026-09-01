import { describe, expect, it } from 'vitest'
import { createWalletDesignDocument } from '@beaconhs/design-studio'
import { CR80_PAGE_SIZE, renderDesignDocumentsPdf } from './index'

const RENDER_TEST_TIMEOUT_MS = 180_000

describe('wallet-card PDF page size', () => {
  it(
    'locks a batch of fronts to the CR80 MediaBox',
    async () => {
      const document = createWalletDesignDocument({
        primary: '#174033',
        accent: '#d98a1f',
        paper: '#f7fbf7',
        typeface: 'technical',
      })
      const drifted = {
        ...document,
        artboards: document.artboards.map((artboard) => ({
          ...artboard,
          width: 8.5,
          height: 11,
        })),
      }
      const pdf = await renderDesignDocumentsPdf(
        [
          {
            document: drifted,
            data: {
              tenantName: 'BeaconHS',
              recipientFullName: 'Alex Worker',
              credentialName: 'Site Orientation',
            },
          },
        ],
        { artboards: 'first', pageSize: CR80_PAGE_SIZE, title: 'Training wallet cards' },
      )

      expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF')
      const boxes = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([^\]]+)\]/g)].map(
        (match) => match[1]!.trim().split(/\s+/).map(Number),
      )
      expect(boxes.length).toBeGreaterThan(0)
      for (const box of boxes) {
        expect(box).toHaveLength(4)
        expect(box[0]).toBeCloseTo(0, 1)
        expect(box[1]).toBeCloseTo(0, 1)
        expect(box[2]).toBeCloseTo(243, 0)
        expect(box[3]).toBeCloseTo(153, 0)
      }
    },
    RENDER_TEST_TIMEOUT_MS,
  )
})
