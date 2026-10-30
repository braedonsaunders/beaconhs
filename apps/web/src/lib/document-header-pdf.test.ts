import { composeControlledDocumentPdf } from '../../../worker/src/lib/document-pdf'
import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { extractText } from 'unpdf'
import { getBrowser } from '../../../../packages/forms-pdf/src/util'
import { documentControlHeaderHtml } from '../../../worker/src/lib/document-control-header'

// Allow the renderer's bounded 120-second cold start to finish before cleanup.
afterAll(async () => {
  await (await getBrowser()).close()
}, 180_000)
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
        approvedBy: 'Alex Morgan',
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
      'Alex Morgan',
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
  }, 180_000)
  it('prints standalone uploaded content with a control header and a footer on every page', async () => {
    const body = await renderHtmlDocumentPdf({
      bodyHtml:
        '<p>First procedure body</p><p style="page-break-before:always">Second procedure body</p>',
      paperSize: 'letter',
      orientation: 'portrait',
      marginMm: 14,
    })
    const pdf = await composeControlledDocumentPdf(
      body,
      {
        title: 'Standalone safety procedure',
        key: 'QA-101',
        version: 2,
        category: 'Safety',
        type: 'Procedure',
        issuedAt: null,
        revisedAt: null,
        approvedBy: null,
      },
      { tenantName: 'QA Company', headerReserved: false },
    )
    const text = await extractText(new Uint8Array(pdf), { mergePages: false })
    expect(text.totalPages).toBe(2)
    expect(text.text[0]).toContain('Standalone safety procedure')
    expect(text.text[0]).toContain('First procedure body')
    expect(text.text[1]).toContain('Second procedure body')
    for (const page of text.text) {
      expect(page).toContain('UNCONTROLLED WHEN PRINTED')
      expect(page).toContain('QA COMPANY')
    }
    expect(text.text[0]).toContain('PAGE 1 OF 2')
    expect(text.text[1]).toContain('PAGE 2 OF 2')
    const directory = process.env.BEACON_DOCUMENT_PDF_REVIEW_DIR
    if (directory) {
      await mkdir(directory, { recursive: true })
      await writeFile(`${directory}/individual-controlled.pdf`, pdf)
    }
  }, 180_000)
})
