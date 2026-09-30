import type { DocumentControlHeader } from '@beaconhs/db/schema'
import { composePdf, countPages, pageGeometry, sofficeConvert } from '@beaconhs/office'
import {
  CONTROLLED_HEADER_BAND_PT,
  reserveFirstPageBand,
  setDocxPageSize,
} from '@beaconhs/office/docx-page-size'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { documentAccentColor, documentControlHeaderHtml } from './document-control-header'

/** Reflow only when a control table is requested; ordinary PDFs match Writer. */
export async function renderDocxToPdf(
  docx: Buffer,
  options: {
    header?: DocumentControlHeader | null
    reserveHeader?: boolean
    accentColor?: string | null
  } = {},
): Promise<Buffer> {
  const letter = await setDocxPageSize(docx, 'letter')
  const reserved = await reserveFirstPageBand(
    letter,
    options.header || options.reserveHeader ? CONTROLLED_HEADER_BAND_PT : 0,
  )
  const pdf = await sofficeConvert(reserved, 'document.docx', 'pdf')
  if (!options.header) return pdf
  return addDocumentControlHeader(pdf, options.header, options.accentColor)
}

/** The source has already reflowed around the header band. */
export async function addDocumentControlHeader(
  pdf: Buffer,
  controlHeader: DocumentControlHeader,
  accentColor?: string | null,
): Promise<Buffer> {
  const geometry = pageGeometry('letter', 'portrait')
  const header = await renderHtmlDocumentPdf({
    paperSize: 'letter',
    orientation: 'portrait',
    pageSizePt: { width: geometry.width, height: CONTROLLED_HEADER_BAND_PT },
    marginMm: 4,
    bodyHtml: documentControlHeaderHtml(
      controlHeader,
      documentAccentColor(accentColor),
      'America/Toronto',
      false,
    ),
  })
  if ((await countPages(header)) !== 1) {
    throw new Error(
      'The document header is too long to fit. Shorten the header details or turn off the PDF header.',
    )
  }
  return composePdf({
    geometry,
    parts: [
      {
        bytes: pdf,
        letterhead: {
          bytes: header,
          heightPt: CONTROLLED_HEADER_BAND_PT,
          reserveSpace: false,
        },
      },
    ],
  })
}
