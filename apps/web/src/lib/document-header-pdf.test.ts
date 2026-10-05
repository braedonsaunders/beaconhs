import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { extractText } from 'unpdf'
import { getBrowser } from '../../../../packages/forms-pdf/src/util'
import { documentControlHeaderHtml } from '../../../worker/src/lib/document-control-header'

afterAll(async () => {
  await (await getBrowser()).close()
})
describe('editable document PDF header', () => {
  it('prints all saved header details within one page', async () => {
    const html = documentControlHeaderHtml(
      {
        title: 'Hydro Testing Procedure',
        key: 'PROC-430',
        category: 'Safety procedures',
        type: 'Controlled procedure',
        issuedAt: '2026-09-01',
        revisedAt: '2026-10-01',
        approvedBy: 'Peter Kazmierczak',
        version: 'Rev B',
      },
      '#0f172a',
      'America/Toronto',
      false,
    )
    const pdf = await renderHtmlDocumentPdf({
      bodyHtml: html + '<p>Procedure body</p>',
      paperSize: 'letter',
      orientation: 'portrait',
      marginMm: 14,
    })
    const text = await extractText(new Uint8Array(pdf), { mergePages: true })
    expect(text.totalPages).toBe(1)
    for (const value of [
      'Hydro Testing Procedure',
      'PROC-430',
      'September 1, 2026',
      'October 1, 2026',
      'Peter Kazmierczak',
      'Rev B',
      'CONTROLLED PROCEDURE',
      'Procedure body',
    ])
      expect(text.text).toContain(value)
    const directory = process.env.BEACON_DOCUMENT_PDF_REVIEW_DIR
    if (directory) {
      await mkdir(directory, { recursive: true })
      await writeFile(`${directory}/document-header.pdf`, pdf)
    }
  }, 30_000)
})
