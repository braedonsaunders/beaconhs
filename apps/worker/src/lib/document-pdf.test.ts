import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTROLLED_HEADER_BAND_PT } from '@beaconhs/office/docx-page-size'
import { composePdf, countPages, sofficeConvert } from '@beaconhs/office'
import { reserveFirstPageBand } from '@beaconhs/office/docx-page-size'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { renderDocxToPdf } from './document-pdf'

vi.mock('@beaconhs/office', () => ({
  pageGeometry: () => ({ width: 612, height: 792 }),
  sofficeConvert: vi.fn(async () => Buffer.from('body PDF')),
  composePdf: vi.fn(async () => Buffer.from('header PDF')),
  countPages: vi.fn(async () => 1),
}))
vi.mock('@beaconhs/office/docx-page-size', () => ({
  CONTROLLED_HEADER_BAND_PT: 132,
  setDocxPageSize: vi.fn(async (bytes: Buffer) => bytes),
  reserveFirstPageBand: vi.fn(async (bytes: Buffer) => bytes),
}))
vi.mock('@beaconhs/forms-pdf', () => ({
  renderHtmlDocumentPdf: vi.fn(async () => Buffer.from('table')),
}))

describe('individual document PDF layout', () => {
  beforeEach(() => vi.clearAllMocks())
  it('prints without a reserved band or table by default', async () => {
    const master = Buffer.from('Word master')
    expect(await renderDocxToPdf(master)).toEqual(Buffer.from('body PDF'))
    expect(reserveFirstPageBand).toHaveBeenCalledWith(master, 0)
    expect(sofficeConvert).toHaveBeenCalledWith(master, 'document.docx', 'pdf')
    expect(renderHtmlDocumentPdf).not.toHaveBeenCalled()
    expect(composePdf).not.toHaveBeenCalled()
  })
  it('reflows the first page before adding one table, without shrinking the body', async () => {
    await renderDocxToPdf(Buffer.from('Word master'), {
      header: {
        title: 'Hydro <test>',
        key: 'doc-430',
        category: 'Mechanical',
        type: 'Procedure',
        version: 3,
        issuedAt: '2026-07-07T12:00:00Z',
        revisedAt: '2026-09-29T12:00:00Z',
        approvedBy: null,
      },
    })
    expect(reserveFirstPageBand).toHaveBeenCalledWith(expect.any(Buffer), CONTROLLED_HEADER_BAND_PT)
    expect(renderHtmlDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSizePt: { width: 612, height: 132 },
        bodyHtml: expect.stringContaining('Hydro &lt;test&gt;'),
      }),
    )
    expect(composePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            bytes: Buffer.from('body PDF'),
            letterhead: { bytes: Buffer.from('table'), heightPt: 132, reserveSpace: false },
          },
        ],
      }),
    )
  })
  it('creates a book body without duplicating an individual document table', async () => {
    await renderDocxToPdf(Buffer.from('Word master'), { reserveHeader: true })
    expect(reserveFirstPageBand).toHaveBeenCalledWith(expect.any(Buffer), 132)
    expect(renderHtmlDocumentPdf).not.toHaveBeenCalled()
  })

  it('rejects an overflowing table instead of dropping its remaining fields', async () => {
    vi.mocked(countPages).mockResolvedValueOnce(2)
    await expect(
      renderDocxToPdf(Buffer.from('Word master'), {
        header: {
          title: 'Procedure',
          key: 'check',
          category: null,
          type: null,
          version: 'Draft',
          issuedAt: null,
          revisedAt: null,
          approvedBy: null,
        },
      }),
    ).rejects.toThrow('header is too long to fit')
    expect(composePdf).not.toHaveBeenCalled()
  })
})
