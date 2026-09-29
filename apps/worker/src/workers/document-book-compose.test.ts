import { beforeEach, describe, expect, it, vi } from 'vitest'
import { composePdf, countPages } from '@beaconhs/office'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { composeDocumentBook } from './document-book-compose'

vi.mock('@beaconhs/office', () => ({
  pageGeometry: () => ({ width: 612, height: 792 }),
  composePdf: vi.fn(async () => Buffer.from('composed')),
  countPages: vi.fn(async () => 1),
}))
vi.mock('@beaconhs/forms-pdf', () => ({
  renderHtmlDocumentPdf: vi.fn(async () => Buffer.from('generated page')),
}))

const entry = {
  kind: 'document' as const,
  title: 'Hydro Testing Procedure',
  key: 'doc-430',
  version: 3,
  pdf: Buffer.from('published body'),
  pageCount: 3,
  headerReserved: true,
}
const input = {
  title: 'Safety manual',
  tenantName: 'Rassaun',
  timeZone: 'America/Toronto',
  entries: [entry],
}
const settings = { coverPage: false, tableOfContents: false, footer: false, documentHeaders: true }

describe('document book control tables', () => {
  beforeEach(() => vi.clearAllMocks())
  it('uses the reserved Word body at full size', async () => {
    await composeDocumentBook({ ...input, settings })
    expect(composePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            bytes: entry.pdf,
            letterhead: {
              bytes: Buffer.from('generated page'),
              page: 0,
              heightPt: 132,
              reserveSpace: false,
            },
          },
        ],
      }),
    )
  })
  it('makes room for a table on uploaded PDFs that cannot reflow', async () => {
    await composeDocumentBook({
      ...input,
      settings,
      entries: [{ ...entry, headerReserved: false }],
    })
    expect(composePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          expect.objectContaining({
            letterhead: expect.objectContaining({ reserveSpace: true }),
          }),
        ],
      }),
    )
  })
  it('adds a separate sheet without overlaying another table on the body', async () => {
    await composeDocumentBook({
      ...input,
      settings: { ...settings, documentHeadersOnOwnPage: true },
    })
    expect(composePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ bytes: Buffer.from('generated page'), pages: [0] }, { bytes: entry.pdf }],
      }),
    )
  })
  it('uses actual document and divider page counts in the contents', async () => {
    vi.mocked(countPages).mockResolvedValueOnce(2)
    await composeDocumentBook({
      ...input,
      settings: { ...settings, tableOfContents: true },
      entries: [
        { kind: 'section', title: 'Mechanical' },
        entry,
        { ...entry, title: 'Second procedure', key: 'doc-431' },
      ],
    })
    const contents = vi
      .mocked(renderHtmlDocumentPdf)
      .mock.calls.find(([args]) => args.bodyHtml.includes('Contents'))?.[0].bodyHtml
    expect(contents).toMatch(/doc-430[\s\S]*?>2<\/td>/)
    expect(contents).toMatch(/doc-431[\s\S]*?>5<\/td>/)
  })
})
