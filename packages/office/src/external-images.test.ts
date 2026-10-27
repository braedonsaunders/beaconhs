import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  embedExternalImages,
  findExternalImages,
  repairLinkedEmbeddedImages,
} from './external-images'

const AZURE = 'https://legacy.blob.core.windows.net/tenant-files/entities/documents/abc/photo.png'
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
    '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:drawing><a:blip r:link="rId7"/></w:drawing></w:r></w:p></w:body></w:document>',
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
    // Legacy pictures LINK their image; once it is inside the package they
    // must EMBED it, or renderers silently drop the picture.
    const body = await zip.file('word/document.xml')!.async('string')
    expect(body).toContain('<a:blip r:embed="rId7"/>')
    expect(body).not.toContain('r:link=')
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

describe('repairLinkedEmbeddedImages', () => {
  async function linkedInternalDocx(blip: string): Promise<Buffer> {
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:drawing>${blip}</w:drawing></w:r></w:p></w:body></w:document>`,
    )
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${IMAGE_TYPE}" Target="media/embedded-image-1.jpg"/><Relationship Id="rId3" Type="${IMAGE_TYPE}" Target="${AZURE}" TargetMode="External"/></Relationships>`,
    )
    zip.file('word/media/embedded-image-1.jpg', PNG)
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  it('turns links to package media into embeds', async () => {
    const result = await repairLinkedEmbeddedImages(
      await linkedInternalDocx('<a:blip r:link="rId2">'),
    )
    expect(result.repaired).toBe(1)
    const body = await (
      await JSZip.loadAsync(result.bytes)
    )
      .file('word/document.xml')!
      .async('string')
    expect(body).toContain('<a:blip r:embed="rId2">')
  })

  it('replaces a placeholder embed with the linked package image', async () => {
    const result = await repairLinkedEmbeddedImages(
      await linkedInternalDocx('<a:blip r:embed="rId9" r:link="rId2"/>'),
    )
    expect(result.repaired).toBe(1)
    const body = await (
      await JSZip.loadAsync(result.bytes)
    )
      .file('word/document.xml')!
      .async('string')
    expect(body).toContain('<a:blip r:embed="rId2"/>')
  })

  it('leaves genuine external links and correct files unchanged', async () => {
    const external = await linkedInternalDocx('<a:blip r:link="rId3"/>')
    const result = await repairLinkedEmbeddedImages(external)
    expect(result.repaired).toBe(0)
    expect(result.bytes).toBe(external)
  })

  it('restores the picture proportions from the image', async () => {
    // 400x200 PNG header: the picture must be twice as wide as it is tall.
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(400, 16)
    png.writeUInt32BE(200, 20)
    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="3810000" cy="360045"/><a:graphic><pic:pic><pic:blipFill><a:blip r:link="rId2"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="3810000" cy="360045"/></a:xfrm></pic:spPr></pic:pic></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>',
    )
    zip.file(
      'word/_rels/document.xml.rels',
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_TYPE}" Target="media/embedded-image-1.png"/></Relationships>`,
    )
    zip.file('word/media/embedded-image-1.png', png)
    const result = await repairLinkedEmbeddedImages(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(result.repaired).toBe(1)
    const body = await (
      await JSZip.loadAsync(result.bytes)
    )
      .file('word/document.xml')!
      .async('string')
    expect(body).toContain('<a:blip r:embed="rId2"/>')
    expect(body).toContain('<wp:extent cx="3810000" cy="1905000"/>')
    expect(body).toContain('<a:ext cx="3810000" cy="1905000"/>')
    // A second pass has nothing left to repair.
    const again = await repairLinkedEmbeddedImages(result.bytes)
    expect(again.repaired).toBe(0)
  })
})
