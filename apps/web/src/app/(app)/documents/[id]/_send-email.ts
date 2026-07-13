// Server-only helper to email a document. The body of the email includes
// the document description + a link to the in-app view; if the published
// version has a content attachment, we surface its authenticated, audited
// download route too. (We don't attach the PDF inline — the
// email queue keeps payloads small.)

import { and, desc, eq, sql } from 'drizzle-orm'
import { attachments, documentCategories, documentVersions, documents } from '@beaconhs/db/schema'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
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
): Promise<{ recipientCount: number } | null> {
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ doc: documents, categoryName: documentCategories.name })
      .from(documents)
      .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
      .where(eq(documents.id, documentId))
      .limit(1)
    if (!row) return null

    const [publishedVersion] = await tx
      .select({ v: documentVersions, attachment: attachments })
      .from(documentVersions)
      .leftJoin(attachments, eq(attachments.id, documentVersions.contentAttachmentId))
      .where(
        and(
          eq(documentVersions.documentId, documentId),
          sql`${documentVersions.publishedAt} IS NOT NULL`,
        ),
      )
      .orderBy(desc(documentVersions.version))
      .limit(1)

    return { doc: row.doc, categoryName: row.categoryName, publishedVersion }
  })
  if (!data) return null

  // Explicit recipients only — no silent blast to every active tenant user.
  const to = Array.from(new Set((options?.recipients ?? []).filter((s) => /@/.test(s))))
  if (to.length === 0) return null
  const cc = (options?.cc ?? []).filter((s) => /@/.test(s))

  const appUrl = appBaseUrl()
  const docUrl = `${appUrl}/documents/${documentId}`
  const attachmentUrl = data.publishedVersion?.attachment
    ? `${appUrl}/documents/${documentId}/versions/${data.publishedVersion.v.id}/download`
    : null

  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') + `Document: ${data.doc.title}`

  const text = [
    `DOCUMENT`,
    `${data.doc.title} (${data.doc.key})`,
    ``,
    `Status: ${data.doc.status}`,
    `Category: ${data.categoryName ?? '—'}`,
    data.publishedVersion
      ? `Published version: v${data.publishedVersion.v.version}`
      : 'No published version.',
    data.doc.nextReviewOn ? `Next review: ${data.doc.nextReviewOn}` : '',
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    `Description:`,
    data.doc.description ?? '(none)',
    ``,
    data.publishedVersion?.v.textContent
      ? `Content:\n${data.publishedVersion.v.textContent.slice(0, 4000)}\n`
      : '',
    `View in app: ${docUrl}`,
    attachmentUrl ? `Download attachment: ${attachmentUrl}` : '',
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
        ${data.publishedVersion ? ` · v${data.publishedVersion.v.version}` : ''}
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
        data.publishedVersion?.v.textContent
          ? `<div style="font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-bottom:12px;white-space:pre-wrap;">${sanitizeDocumentHtml(data.publishedVersion.v.textContent.slice(0, 4000))}</div>`
          : ''
      }
      <p style="margin:18px 0 4px;font-size:13px;">
        <a href="${escapeHtml(docUrl)}" style="background:#0f766e;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Open in app</a>
        ${
          attachmentUrl
            ? ` <a href="${escapeHtml(attachmentUrl)}" style="margin-left:8px;color:#0f766e;text-decoration:underline;">Download attachment</a>`
            : ''
        }
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
    metadata: { recipients: to, cc, channel: 'email' },
  })
  return { recipientCount: to.length }
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
