import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  clampMarginsInDocumentXml,
  defaultRunSize,
  modalRunSize,
  normalizeDocxTypography,
  readDocxPageSize,
  scaleRunSizes,
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

describe('modalRunSize', () => {
  const rPr = (size: number) => `<w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`

  it('reports the size most runs use', () => {
    const runs = (size: number, n: number) => `<w:r>${rPr(size)}<w:t>x</w:t></w:r>`.repeat(n)
    expect(modalRunSize(runs(23, 10) + runs(48, 2), 20)).toBe(23)
  })

  it('ignores a border width, which is eighths of a point', () => {
    // <w:tblBorders><w:top w:sz="4"/> is a hairline rule, not 2pt text. Counting
    // it would drag the mode to nothing and scale the whole document up.
    const xml =
      `<w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders>` +
      `<w:r>${rPr(24)}<w:t>x</w:t></w:r>`.repeat(3)
    expect(modalRunSize(xml, 20)).toBe(24)
  })

  it('counts runs that inherit their size from the defaults', () => {
    // One real master had 84 runs and a single explicit size; matching the body
    // to that lone heading shrank the whole document.
    const inherited = '<w:r><w:t>x</w:t></w:r>'.repeat(84)
    expect(modalRunSize(inherited + `<w:r>${rPr(27)}<w:t>x</w:t></w:r>`, 24)).toBe(24)
  })

  it('returns null when there are no runs at all', () => {
    expect(modalRunSize('<w:body/>', 20)).toBeNull()
  })
})

describe('defaultRunSize', () => {
  it('reads the document defaults', () => {
    expect(
      defaultRunSize(
        '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>',
      ),
    ).toBe(24)
  })

  it("falls back to Word's own default", () => {
    expect(defaultRunSize(null)).toBe(20)
    expect(defaultRunSize('<w:styles/>')).toBe(20)
  })
})

describe('scaleRunSizes', () => {
  it('keeps the document hierarchy while moving the body', () => {
    // A heading two steps above the body must stay two steps above it.
    const xml = `<w:rPr><w:sz w:val="24"/></w:rPr><w:rPr><w:sz w:val="48"/></w:rPr>`
    const out = scaleRunSizes(xml, 22 / 24)
    expect(out).toContain('w:sz w:val="22"')
    expect(out).toContain('w:sz w:val="44"')
  })

  it('moves complex-script sizes with their run', () => {
    expect(scaleRunSizes('<w:rPr><w:szCs w:val="24"/></w:rPr>', 0.5)).toContain('w:szCs w:val="12"')
  })

  it('leaves border widths alone', () => {
    const xml = '<w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders>'
    expect(scaleRunSizes(xml, 2)).toBe(xml)
  })

  it('is a no-op at factor 1', () => {
    const xml = '<w:rPr><w:sz w:val="24"/></w:rPr>'
    expect(scaleRunSizes(xml, 1)).toBe(xml)
  })
})

describe('normalizeDocxTypography', () => {
  it('puts a master on the house paper, margins and body size', async () => {
    const body = `${A4}<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="1134"/>${'<w:r><w:rPr><w:sz w:val="27"/></w:rPr><w:t>x</w:t></w:r>'.repeat(5)}`
    const out = await normalizeDocxTypography(await makeDocx(body), 'letter')
    const xml = await (await JSZip.loadAsync(out)).file('word/document.xml')!.async('string')
    expect(readDocxPageSize(xml)).toBe('letter')
    expect(xml).toContain('w:left="1440"')
    expect(xml).toContain('w:right="1440"')
    // 27 half-points (13.5pt) scaled to the 22 half-point (11pt) house body.
    expect(modalRunSize(xml, 20)).toBe(22)
  })

  it('leaves an already-normal master byte-identical', async () => {
    const body = `${LETTER}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>x</w:t></w:r>`
    const docx = await makeDocx(body)
    expect(await normalizeDocxTypography(docx, 'letter')).toBe(docx)
  })
})

describe('normalizeDocxTypography sizeFactor', () => {
  it('uses a measured ratio in place of the declared point size', async () => {
    // Two masters both set at 11pt render different glyph heights in different
    // typefaces, so a caller that measured the render overrides the guess.
    const body = `${A4}<w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>x</w:t></w:r>`
    const out = await normalizeDocxTypography(await makeDocx(body), 'letter', { sizeFactor: 0.5 })
    const xml = await (await JSZip.loadAsync(out)).file('word/document.xml')!.async('string')
    expect(xml).toContain('w:sz w:val="12"')
  })
})
