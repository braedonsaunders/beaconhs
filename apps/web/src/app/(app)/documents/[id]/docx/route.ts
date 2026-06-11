// GET /documents/:id/docx  → streams a generated .docx of the document.
//   ?draft=1 exports the live draft; otherwise the latest published version.
//
// html-to-docx is pure-JS (no Chromium) and fast, so we generate on demand and
// stream the file (mirrors the CSV export route) rather than queueing a job.

import { NextResponse } from 'next/server'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import HTMLtoDOCX from '@turbodocx/html-to-docx'
import { documentDrafts, documentVersions, documents } from '@beaconhs/db/schema'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// DOCX ignores <style>/class CSS, so flatten editing artifacts in the markup:
// drop tracked deletions, unwrap insertions + comment marks, turn page breaks
// into a Word-recognized break.
function flattenForExport(html: string): string {
  return html
    .replace(/<span[^>]*data-deletion[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<span[^>]*data-insertion[^>]*>([\s\S]*?)<\/span>/gi, '$1')
    .replace(/<span[^>]*data-comment-id[^>]*>([\s\S]*?)<\/span>/gi, '$1')
    .replace(
      /<div[^>]*data-page-break[^>]*>\s*<\/div>/gi,
      '<br style="page-break-after: always" />',
    )
    .replace(/<div[^>]*data-page-break[^>]*\/?>/gi, '<br style="page-break-after: always" />')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const ctx = await requireRequestContext()
  const useDraft = new URL(req.url).searchParams.get('draft') === '1'

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
    if (!doc) return null
    let html = ''
    let label = 'draft'
    if (useDraft) {
      const [d] = await tx
        .select({ html: documentDrafts.contentHtml })
        .from(documentDrafts)
        .where(eq(documentDrafts.documentId, id))
        .limit(1)
      html = d?.html ?? ''
    } else {
      const [v] = await tx
        .select({ html: documentVersions.contentMarkdown, version: documentVersions.version })
        .from(documentVersions)
        .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
        .orderBy(desc(documentVersions.version))
        .limit(1)
      html = v?.html ?? ''
      label = v ? `v${v.version}` : 'draft'
    }
    return { doc, html, label }
  })

  if (!data) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const body = sanitizeDocumentHtml(flattenForExport(data.html)) || '<p></p>'
  const full = `<!doctype html><html><head><meta charset="utf-8"/></head><body>
    <h1>${escapeHtml(data.doc.title)}</h1>
    ${body}
  </body></html>`

  const result = await HTMLtoDOCX(
    full,
    null,
    {
      title: data.doc.title,
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
      orientation: 'portrait',
    },
    null,
  )
  const buffer = result instanceof ArrayBuffer ? Buffer.from(result) : (result as Buffer)

  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'export',
    summary: 'Exported document to Word (.docx)',
  })

  const safeName = (data.doc.key || data.doc.title || 'document').replace(/[^a-z0-9._-]/gi, '_')
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}-${data.label}.docx"`,
    },
  })
}
