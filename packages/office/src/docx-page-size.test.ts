import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  clampMarginsInDocumentXml,
  readDocxPageSize,
  setDocxPageSize,
  setPageSizeInDocumentXml,
} from './docx-page-size'

const A4 = '<w:pgSz w:w="11906" w:h="16838"/>'
const LETTER = '<w:pgSz w:w="12240" w:h="15840"/>'

function docXml(body: string): string {
  return `<?xml version="1.0"?><w:document><w:body><w:sectPr>${body}</w:sectPr></w:body></w:document>`
}

async function makeDocx(body: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('word/document.xml', docXml(body))
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('readDocxPageSize', () => {
  it('names the sizes that matter', () => {
    expect(readDocxPageSize(docXml(A4))).toBe('a4')
    expect(readDocxPageSize(docXml(LETTER))).toBe('letter')
    expect(readDocxPageSize(docXml('<w:pgSz w:w="12240" w:h="20160"/>'))).toBe('legal')
  })

  it('reads a landscape page as the size it is', () => {
    // Orientation is not a different paper; a landscape A4 is still A4.
    expect(readDocxPageSize(docXml('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'))).toBe(
      'a4',
    )
  })

  it('tolerates a converter being a twip or two out', () => {
    expect(readDocxPageSize(docXml('<w:pgSz w:w="12239" w:h="15842"/>'))).toBe('letter')
  })

  it('reports an unrecognised size rather than guessing', () => {
    expect(readDocxPageSize(docXml('<w:pgSz w:w="9000" w:h="12000"/>'))).toBe('other')
    expect(readDocxPageSize(docXml(''))).toBeNull()
  })
})

describe('setPageSizeInDocumentXml', () => {
  it('rewrites the page size', () => {
    expect(setPageSizeInDocumentXml(docXml(A4), 'letter')).toContain('w:w="12240" w:h="15840"')
  })

  it('keeps a landscape section landscape', () => {
    // A portrait procedure with one landscape table must not have that table
    // rotated back upright.
    const out = setPageSizeInDocumentXml(
      docXml('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'),
      'letter',
    )
    expect(out).toContain('w:w="15840"')
    expect(out).toContain('w:h="12240"')
    expect(out).toContain('w:orient="landscape"')
  })

  it('rewrites every section, not just the first', () => {
    const two = docXml(A4) + docXml(A4)
    const out = setPageSizeInDocumentXml(two, 'letter')
    expect(out.match(/w:w="12240"/g)).toHaveLength(2)
    expect(out).not.toContain('11906')
  })
})

describe('clampMarginsInDocumentXml', () => {
  it('leaves normal margins alone', () => {
    const xml = docXml(
      `${LETTER}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>`,
    )
    expect(clampMarginsInDocumentXml(xml, 'letter')).toBe(xml)
  })

  it('pulls margins in when they would leave no measure', () => {
    // Going to a narrower page, margins written for the wider one can consume
    // the whole width and leave a column of nothing.
    const xml = docXml(
      `${LETTER}<w:pgMar w:top="1440" w:right="5000" w:bottom="1440" w:left="5000"/>`,
    )
    const out = clampMarginsInDocumentXml(xml, 'letter')
    const left = Number(/w:left="(\d+)"/.exec(out)![1])
    const right = Number(/w:right="(\d+)"/.exec(out)![1])
    expect(12240 - left - right).toBeGreaterThanOrEqual(2880)
  })
})

describe('setDocxPageSize', () => {
  it('converts an A4 master to Letter', async () => {
    const out = await setDocxPageSize(await makeDocx(A4), 'letter')
    const xml = await (await JSZip.loadAsync(out)).file('word/document.xml')!.async('string')
    expect(readDocxPageSize(xml)).toBe('letter')
  })

  it('returns the original bytes when it is already the right size', async () => {
    // Re-saving a zip for no reason churns storage and the attachment hash.
    const docx = await makeDocx(LETTER)
    expect(await setDocxPageSize(docx, 'letter')).toBe(docx)
  })

  it('refuses anything that is not a Word document', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'not a docx')
    await expect(
      setDocxPageSize(await zip.generateAsync({ type: 'nodebuffer' }), 'letter'),
    ).rejects.toThrow('word/document.xml')
  })

  it('keeps the rest of the package intact', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', docXml(A4))
    zip.file('word/styles.xml', '<styles/>')
    zip.file('word/media/image1.png', Buffer.from([1, 2, 3]))
    const out = await setDocxPageSize(await zip.generateAsync({ type: 'nodebuffer' }), 'letter')
    const back = await JSZip.loadAsync(out)
    expect(await back.file('word/styles.xml')!.async('string')).toBe('<styles/>')
    expect([...(await back.file('word/media/image1.png')!.async('nodebuffer'))]).toEqual([1, 2, 3])
  })
})
