import type { DocumentControlHeader } from '@beaconhs/db/schema'
import { countPages, sofficeConvert } from '@beaconhs/office'
import {
  CONTROLLED_HEADER_BAND_PT,
  reserveFirstPageBand,
  setDocxPageSize,
} from '@beaconhs/office/docx-page-size'
import { composeDocumentBook } from '../workers/document-book-compose'

/** Keep an undecorated body for book assembly and immutable source preservation. */
export async function renderDocxToPdf(
  docx: Buffer,
  options: { reserveHeader?: boolean } = {},
): Promise<Buffer> {
  const letter = await setDocxPageSize(docx, 'letter')
  const reserved = await reserveFirstPageBand(
    letter,
    options.reserveHeader ? CONTROLLED_HEADER_BAND_PT : 0,
  )
  return sofficeConvert(reserved, 'document.docx', 'pdf')
}

/** Individual documents use exactly the same control table and footer as books. */
export async function composeControlledDocumentPdf(
  pdf: Buffer,
  header: DocumentControlHeader,
  options: {
    tenantName: string
    accentColor?: string | null
    headerReserved: boolean
  },
): Promise<Buffer> {
  return composeDocumentBook({
    title: header.title,
    tenantName: options.tenantName,
    accentColor: options.accentColor,
    timeZone: 'America/Toronto',
    settings: { coverPage: false, tableOfContents: false, documentHeaders: true, footer: true },
    entries: [
      {
        kind: 'document',
        ...header,
        key: header.key ?? '',
        version: 1,
        headerVersion: header.version,
        pdf,
        pageCount: await countPages(pdf),
        headerReserved: options.headerReserved,
      },
    ],
  })
}
