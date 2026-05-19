// Server-only helper to email a document. The body of the email includes
// the document description + a link to the in-app view; if the published
// version has a content_attachment_id, we surface its public URL as a
// "view attachment" link too. (We don't attach the PDF inline — the
// email queue keeps payloads small.)

import { and, desc, eq, sql } from 'drizzle-orm'
import {
  attachments,
  documentVersions,
  documents,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
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
      .select()
      .from(documents)
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

    const adminRecipients = await tx
      .select({ email: users.email })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(
        and(
          eq(tenantUsers.tenantId, row.tenantId),
          eq(tenantUsers.status, 'active'),
          sql`${users.email} IS NOT NULL`,
        ),
      )

    return { doc: row, publishedVersion, adminRecipients }
  })
  if (!data) return null

  const explicit = (options?.recipients ?? []).filter((s) => /@/.test(s))
  const adminEmails = data.adminRecipients.map((r) => r.email).filter((s): s is string => !!s)
  const to = explicit.length > 0 ? explicit : Array.from(new Set(adminEmails))
  if (to.length === 0) return null
  const cc = (options?.cc ?? []).filter((s) => /@/.test(s))

  const appUrl = process.env.APP_URL ?? ''
  const docUrl = `${appUrl}/documents/${documentId}`
  const attachmentUrl = data.publishedVersion?.attachment
    ? publicUrl(data.publishedVersion.attachment.r2Key)
    : null

  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    `Document: ${data.doc.title}`

  const text = [
    `DOCUMENT`,
    `${data.doc.title} (${data.doc.key})`,
    ``,
    `Status: ${data.doc.status}`,
    `Category: ${data.doc.category ?? '—'}`,
    data.publishedVersion ? `Published version: v${data.publishedVersion.v.version}` : 'No published version yet.',
    data.doc.nextReviewOn ? `Next review: ${data.doc.nextReviewOn}` : '',
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    `Description:`,
    data.doc.description ?? '(none)',
    ``,
    data.publishedVersion?.v.contentMarkdown
      ? `Content:\n${data.publishedVersion.v.contentMarkdown}\n`
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
        ${escapeHtml(data.doc.category ?? 'document')} ·
        ${escapeHtml(data.doc.status)}
        ${data.publishedVersion ? ` · v${data.publishedVersion.v.version}` : ''}
      </div>
      ${options?.messageOverride
        ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
        : ''}
      ${data.doc.description
        ? `<div style="font-size:13px;white-space:pre-wrap;margin-bottom:12px;">${escapeHtml(data.doc.description)}</div>`
        : ''}
      ${data.publishedVersion?.v.contentMarkdown
        ? `<div style="font-size:13px;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-bottom:12px;">${escapeHtml(data.publishedVersion.v.contentMarkdown)}</div>`
        : ''}
      <p style="margin:18px 0 4px;font-size:13px;">
        <a href="${escapeHtml(docUrl)}" style="background:#0f766e;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Open in app</a>
        ${attachmentUrl
          ? ` <a href="${escapeHtml(attachmentUrl)}" style="margin-left:8px;color:#0f766e;text-decoration:underline;">Download attachment</a>`
          : ''}
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
