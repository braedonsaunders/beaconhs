// Server-only helper to email a document. The body of the email includes
// the document description + a link to the in-app view; if the published
// version has a content attachment, we surface its authenticated, audited
// download route too. (We don't attach the PDF inline — the
// email queue keeps payloads small.)

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { documentCategories, documentVersions, documents } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { appBaseUrl } from '@/lib/app-base-url'
import { recordAudit } from '@/lib/audit'

export async function sendDocumentEmail(
  ctx: RequestContext,
  documentId: string,
  options?: {
    recipients?: string[]
    cc?: string[]
    subjectPrefix?: string
    messageOverride?: string
  },
): Promise<{ recipientCount: number }> {
  if ((options?.subjectPrefix?.length ?? 0) > 120) {
    throw new Error('Subject prefix must be 120 characters or fewer')
  }
  if ((options?.messageOverride?.length ?? 0) > 4_000) {
    throw new Error('Personal note must be 4,000 characters or fewer')
  }
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ doc: documents, categoryName: documentCategories.name })
      .from(documents)
      .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.status, 'published'),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1)
    if (!row) return null

    const [publishedVersion] = await tx
      .select({ v: documentVersions })
      .from(documentVersions)
      .where(
        and(eq(documentVersions.documentId, documentId), isNotNull(documentVersions.publishedAt)),
      )
      .orderBy(desc(documentVersions.version))
      .limit(1)

    return { doc: row.doc, categoryName: row.categoryName, publishedVersion }
  })
  if (!data) throw new Error('Only a published document can be emailed')
  if (!data.publishedVersion) throw new Error('This document has no published version')
  if (!data.publishedVersion.v.pdfAttachmentId && !data.publishedVersion.v.contentAttachmentId) {
    throw new Error('The published PDF is still being prepared')
  }

  // The durable email queue deliberately sends one private copy per address
  // and has no Cc header, so Cc entries join the fan-out instead of disappearing.
  const primary = uniqueEmails(options?.recipients ?? [])
  const cc = uniqueEmails(options?.cc ?? []).filter(
    (address) => !primary.some((candidate) => candidate.toLowerCase() === address.toLowerCase()),
  )
  const to = [...primary, ...cc]
  if (to.length === 0) throw new Error('Enter at least one valid recipient')
  if (to.length > 100) throw new Error('A document email may have at most 100 recipients')

  const appUrl = appBaseUrl()
  const docUrl = `${appUrl}/documents/${documentId}`
  const attachmentUrl = `${appUrl}/documents/${documentId}/versions/${data.publishedVersion.v.id}/download`

  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') + `Document: ${data.doc.title}`

  const text = [
    `DOCUMENT`,
    `${data.doc.title} (${data.doc.key})`,
    ``,
    `Status: ${data.doc.status}`,
    `Category: ${data.categoryName ?? '—'}`,
    `Published version: v${data.publishedVersion.v.version}`,
    data.doc.nextReviewOn ? `Next review: ${data.doc.nextReviewOn}` : '',
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    `Description:`,
    data.doc.description ?? '(none)',
    ``,
    data.publishedVersion.v.textContent
      ? `Content:\n${data.publishedVersion.v.textContent.slice(0, 4000)}\n`
      : '',
    `View in app: ${docUrl}`,
    `Download PDF: ${attachmentUrl}`,
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(data.doc.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        <span style="font-family:monospace">${escapeHtml(data.doc.key)}</span> ·
        ${escapeHtml(data.categoryName ?? 'document')} ·
        ${escapeHtml(data.doc.status)}
        · v${data.publishedVersion.v.version}
      </div>
      ${
        options?.messageOverride
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
          : ''
      }
      ${
        data.doc.description
          ? `<div style="font-size:13px;white-space:pre-wrap;margin-bottom:12px;">${escapeHtml(data.doc.description)}</div>`
          : ''
      }
      ${
        data.publishedVersion.v.textContent
          ? `<div style="font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(data.publishedVersion.v.textContent.slice(0, 4000))}</div>`
          : ''
      }
      <p style="margin:18px 0 4px;font-size:13px;">
        <a href="${escapeHtml(docUrl)}" style="background:#0f766e;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Open in app</a>
        ${` <a href="${escapeHtml(attachmentUrl)}" style="margin-left:8px;color:#0f766e;text-decoration:underline;">Download PDF</a>`}
      </p>
    </div>
  `

  const { enqueueEmail } = await import('@beaconhs/jobs')
  await enqueueEmail({
    to,
    subject,
    html,
    text,
    meta: {
      tenantId: ctx.tenantId,
      category: 'document_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'export',
    summary: `Emailed document to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    metadata: { recipients: primary, cc, deliveredTo: to, channel: 'email' },
  })
  return { recipientCount: to.length }
}

function uniqueEmails(values: string[]): string[] {
  const byCanonical = new Map<string, string>()
  for (const candidate of values) {
    const value = candidate.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue
    const canonical = value.toLowerCase()
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, value)
  }
  return [...byCanonical.values()]
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
