import { beforeEach, describe, expect, it, vi } from 'vitest'
import { composePdf, countPages, sofficeConvert } from '@beaconhs/office'
import { reserveFirstPageBand } from '@beaconhs/office/docx-page-size'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { composeControlledDocumentPdf, renderDocxToPdf } from './document-pdf'
vi.mock('@beaconhs/office', () => ({
  pageGeometry: () => ({ width: 612, height: 792 }),
  sofficeConvert: vi.fn(async () => Buffer.from('body PDF')),
  composePdf: vi.fn(async () => Buffer.from('controlled PDF')),
  countPages: vi.fn(async () => 1),
}))
vi.mock('@beaconhs/office/docx-page-size', () => ({
  CONTROLLED_HEADER_BAND_PT: 132,
  setDocxPageSize: vi.fn(async (bytes: Buffer) => bytes),
  reserveFirstPageBand: vi.fn(async (bytes: Buffer) => bytes),
}))
vi.mock('@beaconhs/forms-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@beaconhs/forms-pdf')>()),
  renderHtmlDocumentPdf: vi.fn(async () => Buffer.from('table')),
}))
const header = {
  title: 'Hydro <test>',
  key: 'PROC-1',
  category: 'Mechanical',
  type: 'Procedure',
  version: 3,
  issuedAt: null,
  revisedAt: null,
  approvedBy: null,
}
describe('controlled individual PDF layout', () => {
  beforeEach(() => vi.clearAllMocks())
  it('preserves an undecorated source body for later composition', async () => {
    const master = Buffer.from('Word master')
    expect(await renderDocxToPdf(master)).toEqual(Buffer.from('body PDF'))
    expect(reserveFirstPageBand).toHaveBeenCalledWith(master, 0)
    expect(sofficeConvert).toHaveBeenCalledWith(master, 'document.docx', 'pdf')
    expect(composePdf).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'adds a control header and numbered footer with reserved=%s',
    async (headerReserved) => {
      const body = await renderDocxToPdf(Buffer.from('Word master'), {
        reserveHeader: headerReserved,
      })
      await composeControlledDocumentPdf(body, header, {
        tenantName: 'QA Company',
        accentColor: '#7c3aed',
        headerReserved,
      })
      expect(renderHtmlDocumentPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          pageSizePt: { width: 612, height: 132 },
          bodyHtml: expect.stringContaining('Hydro &lt;test&gt;'),
        }),
      )
      const options = vi.mocked(composePdf).mock.calls[0]![0]
      expect(options.parts).toHaveLength(1)
      expect(options.parts[0]?.letterhead).toMatchObject({
        heightPt: 132,
        reserveSpace: !headerReserved,
      })
      expect(options.footerReservePt).toBeGreaterThan(28)
      expect(options.footer?.cells?.(1, 2)).toMatchObject({
        left: 'UNCONTROLLED WHEN PRINTED',
        center: 'PAGE 1 OF 2',
      })
      expect(options.footer?.subline?.(1, 2)).toBe('QA COMPANY')
    },
  )
  it('rejects overflow instead of losing header fields', async () => {
    vi.mocked(countPages).mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    await expect(
      composeControlledDocumentPdf(Buffer.from('body'), header, {
        tenantName: 'QA',
        headerReserved: false,
      }),
    ).rejects.toThrow('too long to fit')
    expect(composePdf).not.toHaveBeenCalled()
  })
})
