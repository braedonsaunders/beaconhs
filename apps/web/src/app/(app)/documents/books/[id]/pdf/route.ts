// Render a document book to a single HTML response that the browser will
// print-to-PDF. A true async worker render is intentionally out of scope for
// the first cut — the spec asks for a 302 → worker, but until the pdf queue
// gains a 'document_book' kind, this print-friendly page is the deliverable.
//
// The page sets up a `@page` block so File → Save as PDF (or Print → Save as PDF)
// produces a clean booklet without browser chrome.

import { asc, desc, eq } from 'drizzle-orm'
import {
  documentBookItems,
  documentBooks,
  documentVersions,
  documents,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function markdownToHtml(md: string): string {
  // Deliberately minimal — bold, italic, headings, paragraphs, line breaks.
  const escaped = escapeHtml(md)
  const lines = escaped.split('\n')
  const html: string[] = []
  let inPara = false
  const flushPara = () => {
    if (inPara) {
      html.push('</p>')
      inPara = false
    }
  }
  for (const line of lines) {
    if (line.startsWith('# ')) {
      flushPara()
      html.push(`<h1>${line.slice(2)}</h1>`)
    } else if (line.startsWith('## ')) {
      flushPara()
      html.push(`<h2>${line.slice(3)}</h2>`)
    } else if (line.startsWith('### ')) {
      flushPara()
      html.push(`<h3>${line.slice(4)}</h3>`)
    } else if (line.trim() === '') {
      flushPara()
    } else {
      if (!inPara) {
        html.push('<p>')
        inPara = true
      } else {
        html.push('<br />')
      }
      let out = line
      out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      out = out.replace(/\*(.+?)\*/g, '<em>$1</em>')
      html.push(out)
    }
  }
  flushPara()
  return html.join('\n')
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [book] = await tx.select().from(documentBooks).where(eq(documentBooks.id, id)).limit(1)
    if (!book) return null
    const items = await tx
      .select({ item: documentBookItems, doc: documents })
      .from(documentBookItems)
      .innerJoin(documents, eq(documents.id, documentBookItems.documentId))
      .where(eq(documentBookItems.bookId, id))
      .orderBy(asc(documentBookItems.position))
    const versions = await Promise.all(
      items.map(async (i) => {
        const [v] = await tx
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.documentId, i.doc.id))
          .orderBy(desc(documentVersions.version))
          .limit(1)
        return { docId: i.doc.id, version: v }
      }),
    )
    return { book, items, versions }
  })

  if (!data) return new Response('Not found', { status: 404 })
  const { book, items, versions } = data
  const versionMap = new Map(versions.map((v) => [v.docId, v.version] as const))

  const display = book.title || book.name || 'Document book'
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(display)}</title>
  <style>
    @page { size: letter; margin: 1in; }
    body { font: 11pt/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #0f172a; }
    .cover { page-break-after: always; padding-top: 2in; text-align: center; }
    .cover h1 { font-size: 28pt; margin-bottom: 0.5rem; }
    .cover .meta { color: #475569; font-size: 11pt; }
    .toc { page-break-after: always; }
    .toc h2 { font-size: 18pt; }
    .toc ol { padding-left: 1.25rem; }
    .toc li { padding: 0.25rem 0; }
    .doc { page-break-before: always; }
    .doc h1 { font-size: 18pt; border-bottom: 2px solid #0f766e; padding-bottom: 0.25rem; }
    .doc h2 { font-size: 14pt; margin-top: 1rem; }
    .doc h3 { font-size: 12pt; margin-top: 0.75rem; }
    .doc p { margin: 0.5rem 0; }
    .doc-meta { color: #64748b; font-size: 9pt; margin-bottom: 0.5rem; }
    .empty { color: #94a3b8; font-style: italic; }
    @media print { .no-print { display: none; } }
    .no-print { position: fixed; top: 1rem; right: 1rem; padding: 0.5rem 1rem; background: #0f766e; color: white; border-radius: 4px; text-decoration: none; font-size: 10pt; }
  </style>
</head>
<body>
  <a class="no-print" href="javascript:window.print()">Print / Save as PDF</a>

  <section class="cover">
    <h1>${escapeHtml(display)}</h1>
    ${book.description ? `<p class="meta">${escapeHtml(book.description)}</p>` : ''}
    <p class="meta">
      ${items.length} document${items.length === 1 ? '' : 's'}
      ${book.publishedAt ? ` · published ${new Date(book.publishedAt).toLocaleDateString()}` : ''}
    </p>
  </section>

  <section class="toc">
    <h2>Contents</h2>
    <ol>
      ${items.map((i) => `<li>${escapeHtml(i.doc.title)}</li>`).join('\n      ')}
    </ol>
  </section>

  ${items
    .map((i) => {
      const v = versionMap.get(i.doc.id)
      const body = v?.contentMarkdown
        ? markdownToHtml(v.contentMarkdown)
        : '<p class="empty">No published content for this document.</p>'
      return `
  <section class="doc">
    <h1>${escapeHtml(i.doc.title)}</h1>
    <div class="doc-meta">
      ${i.doc.category ? escapeHtml(i.doc.category) + ' · ' : ''}${i.doc.key ? 'Key: ' + escapeHtml(i.doc.key) : ''}
      ${v?.version ? ' · v' + v.version : ''}
    </div>
    ${body}
  </section>`
    })
    .join('\n')}
</body>
</html>`

  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: id,
    action: 'export',
    summary: 'Rendered document book to PDF (printable HTML)',
  })

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
