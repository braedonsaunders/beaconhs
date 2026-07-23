import { describe, expect, it } from 'vitest'
import { photoDocumentUrl } from './photo-document-url'

describe('photo document URL', () => {
  it('keeps the signed source URL when no markup exists', () => {
    expect(
      photoDocumentUrl({
        url: 'https://storage.example/photo.jpg?sig=one&part=two',
        annotations: null,
        width: 800,
        height: 600,
      }),
    ).toBe('https://storage.example/photo.jpg?sig=one&part=two')
  })

  it('embeds the private image and vector layer in an export-safe SVG', () => {
    const url = photoDocumentUrl({
      url: 'https://storage.example/photo.jpg?sig=one&part=two',
      annotations: [
        {
          type: 'free',
          points: [
            [10, 20],
            [30, 40],
          ],
          color: '#ef4444',
          width: 8,
        },
      ],
      width: 800,
      height: 600,
    })
    expect(url).toMatch(/^data:image\/svg\+xml;base64,/u)
    const svg = Buffer.from(url.split(',')[1]!, 'base64').toString('utf8')
    expect(svg).toContain('width="800" height="600"')
    expect(svg).toContain('sig=one&amp;part=two')
    expect(svg).toContain('<polyline points="10,20 30,40"')
  })
})
