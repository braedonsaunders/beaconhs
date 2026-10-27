import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { docxWording } from './docx-text'

async function docx(parts: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [path, xml] of Object.entries(parts)) zip.file(path, xml)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const body = (inner: string) => `<w:document xmlns:w="w"><w:body>${inner}</w:body></w:document>`

describe('docxWording', () => {
  it('reads runs across paragraphs, headers and footers', async () => {
    const bytes = await docx({
      'word/document.xml': body(
        '<w:p><w:r><w:t>Safety</w:t></w:r><w:r><w:t xml:space="preserve"> first</w:t></w:r></w:p><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p>',
      ),
      'word/header1.xml': '<w:hdr><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>',
      'word/footer1.xml': '<w:ftr><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>',
    })
    expect(await docxWording(bytes)).toBe('Safety first A & B Footer Header')
  })

  it('ignores images and relationship differences', async () => {
    const plain = await docx({
      'word/document.xml': body('<w:p><w:r><w:t>Orientation</w:t></w:r></w:p>'),
    })
    const withImage = await docx({
      'word/document.xml': body(
        '<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r><w:r><w:t>Orientation</w:t></w:r></w:p>',
      ),
      'word/media/image1.png': 'png',
    })
    expect(await docxWording(withImage)).toBe(await docxWording(plain))
  })

  it('distinguishes changed wording', async () => {
    const a = await docx({
      'word/document.xml': body('<w:p><w:r><w:t>Wear gloves</w:t></w:r></w:p>'),
    })
    const b = await docx({
      'word/document.xml': body('<w:p><w:r><w:t>Wear goggles</w:t></w:r></w:p>'),
    })
    expect(await docxWording(a)).not.toBe(await docxWording(b))
  })
})
