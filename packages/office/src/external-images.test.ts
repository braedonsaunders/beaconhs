import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { embedExternalImages, findExternalImages } from './external-images'

const AZURE =
  'https://beaconhs.blob.core.windows.net/beaconhs-rassaun/entities/documents/abc/photo.png'
const IMAGE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:drawing><a:blip r:embed="rId7"/></w:drawing></w:r></w:p></w:body></w:document>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="${IMAGE_TYPE}" Target="${AZURE}" TargetMode="External"/><Relationship Id="rId8" Type="${IMAGE_TYPE}" Target="media/already.png"/></Relationships>`,
  )
  zip.file('word/media/already.png', PNG)
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('findExternalImages', () => {
  it('finds only linked image relationships', async () => {
    const refs = await findExternalImages(await makeDocx())
    expect(refs).toEqual([{ relsPath: 'word/_rels/document.xml.rels', id: 'rId7', url: AZURE }])
  })
})

describe('embedExternalImages', () => {
  it('embeds the download as a media part and rewrites the relationship', async () => {
    const result = await embedExternalImages(await makeDocx(), async (url) => {
      expect(url).toBe(AZURE)
      return { bytes: PNG, contentType: 'image/png' }
    })
    expect(result.embedded).toHaveLength(1)
    expect(result.failed).toEqual([])
    const zip = await JSZip.loadAsync(result.bytes)
    const mediaPath = result.embedded[0]!.mediaPath
    expect(mediaPath.startsWith('word/media/')).toBe(true)
    expect(await zip.file(mediaPath)!.async('nodebuffer')).toEqual(PNG)
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(rels).not.toContain('TargetMode="External"')
    expect(rels).not.toContain('blob.core.windows.net')
    expect(rels).toContain(`Target="media/${mediaPath.split('/').pop()}"`)
    const types = await zip.file('[Content_Types].xml')!.async('string')
    expect(types).toContain('<Default Extension="png" ContentType="image/png"/>')
    // Idempotent: a second pass finds nothing left to do.
    expect(await findExternalImages(result.bytes)).toEqual([])
    const again = await embedExternalImages(result.bytes, async () => null)
    expect(again.bytes).toBe(result.bytes)
  })

  it('leaves the relationship untouched and reports a failed download', async () => {
    const original = await makeDocx()
    const result = await embedExternalImages(original, async () => null)
    expect(result.bytes).toBe(original)
    expect(result.embedded).toEqual([])
    expect(result.failed).toEqual([{ url: AZURE, error: 'Download returned no bytes' }])
  })

  it('relativises PPTX slide targets to ../media', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="x"></Types>')
    zip.file('ppt/slides/slide1.xml', '<p:sld/>')
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      `<?xml version="1.0"?><Relationships><Relationship Id="rId2" Type="${IMAGE_TYPE}" Target="${AZURE}" TargetMode="External"/></Relationships>`,
    )
    const pptx = await zip.generateAsync({ type: 'nodebuffer' })
    const result = await embedExternalImages(pptx, async () => ({
      bytes: PNG,
      contentType: 'image/png',
    }))
    expect(result.embedded[0]!.mediaPath.startsWith('ppt/media/')).toBe(true)
    const out = await JSZip.loadAsync(result.bytes)
    const rels = await out.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
    expect(rels).toContain('Target="../media/')
  })
})
