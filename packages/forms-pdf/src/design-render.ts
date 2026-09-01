import {
  CR80,
  renderDesignDocumentHtml,
  renderDesignDocumentsHtml,
  type DesignDocument,
  type DesignDocumentData,
} from '@beaconhs/design-studio'
import { getBrowser as browser, newPdfPage, setPdfContent } from './util'

export async function renderDesignDocumentPdf(input: {
  document: DesignDocument
  data: DesignDocumentData
  title?: string
}): Promise<Buffer> {
  const html = renderDesignDocumentHtml(input.document, input.data, { title: input.title })
  return printDesignHtmlPdf(html, input.document.artboards[0])
}

/** Render each design artboard as a full-bleed PNG for physical-card bridges. */
export async function renderDesignDocumentPngs(input: {
  document: DesignDocument
  data: DesignDocumentData
  dpi?: number
}): Promise<Buffer[]> {
  const dpi = Math.max(72, Math.min(600, Math.round(input.dpi ?? input.document.dpi ?? 300)))
  const b = await browser()
  const rendered: Buffer[] = []

  for (const artboard of input.document.artboards) {
    const page = await newPdfPage(b)
    try {
      const width = Math.max(1, Math.ceil(artboard.width * 96))
      const height = Math.max(1, Math.ceil(artboard.height * 96))
      await page.setViewport({ width, height, deviceScaleFactor: dpi / 96 })
      const html = renderDesignDocumentHtml(input.document, input.data, {
        artboardId: artboard.id,
        title: input.document.name,
      })
      await setPdfContent(page, html, { waitForFonts: true })
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
        captureBeyondViewport: false,
      })
      rendered.push(Buffer.from(png))
    } finally {
      await page.close()
    }
  }
  return rendered
}

/**
 * N design documents printed back-to-back as ONE multi-page PDF — one page per
 * artboard, each rendered against its own data (bulk label runs). All pages
 * print at the FIRST artboard's physical size, so callers pass a uniform run.
 */
export async function renderDesignDocumentsPdf(
  pages: { document: DesignDocument; data: DesignDocumentData }[],
  options: {
    title?: string
    artboards?: 'all' | 'first'
    pageSize?: { width: number; height: number }
  } = {},
): Promise<Buffer> {
  if (pages.length === 0) throw new Error('renderDesignDocumentsPdf: no pages to render')
  const pageSize = options.pageSize
  const html = renderDesignDocumentsHtml(pages, {
    title: options.title,
    artboards: options.artboards,
    pageSize,
  })
  return printDesignHtmlPdf(html, pageSize ?? pages[0]?.document.artboards[0])
}

export const CR80_PAGE_SIZE = CR80

async function printDesignHtmlPdf(
  html: string,
  first: { width: number; height: number } | undefined,
): Promise<Buffer> {
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html, { waitForFonts: true })
    const pdf = await page.pdf({
      width: first ? `${first.width}in` : '11in',
      height: first ? `${first.height}in` : '8.5in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      // Prefer the explicit Puppeteer page box when a printer size is locked
      // (wallet CR80). CSS @page still matches; content must not win.
      preferCSSPageSize: false,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}
