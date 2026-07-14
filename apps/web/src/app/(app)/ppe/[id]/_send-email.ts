// Server-only helper to email a PPE issue report — specifically the
// open one, when there is one. Use case from the spec: "when there's an
// open issue report, allow sending to maintenance".
//
// We resolve the item + its open issue report + the holder, and the
// caller-supplied recipients (defaults to tenant admin list, since
// "maintenance" is just an admin distribution downstream).

import { and, desc, eq } from 'drizzle-orm'
import {
  people,
  ppeIssueReports,
  ppeIssues,
  ppeItems,
  ppeTypes,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { formatDateTime } from '@/lib/datetime'
import { recordAudit } from '@/lib/audit'

export async function sendPpeIssueEmail(
  ctx: RequestContext,
  ppeItemId: string,
  options?: {
    recipients?: string[]
    cc?: string[]
    subjectPrefix?: string
    messageOverride?: string
  },
): Promise<{ recipientCount: number } | null> {
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ item: ppeItems, type: ppeTypes })
      .from(ppeItems)
      .leftJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .where(eq(ppeItems.id, ppeItemId))
      .limit(1)
    if (!row) return null

    // Active issue (most recent issuance row). The ledger pattern is
    // append-only — issue/return/replace are separate rows — so we just
    // take the most recent 'issue' to identify the current holder.
    const [activeIssue] = await tx
      .select({ issue: ppeIssues, person: people })
      .from(ppeIssues)
      .leftJoin(people, eq(people.id, ppeIssues.personId))
      .where(and(eq(ppeIssues.itemId, ppeItemId), eq(ppeIssues.action, 'issue')))
      .orderBy(desc(ppeIssues.occurredAt))
      .limit(1)

    // Most recent open issue report.
    const [openReport] = await tx
      .select({
        report: ppeIssueReports,
        reporterMembership: tenantUsers,
        reporterUser: user,
      })
      .from(ppeIssueReports)
      .leftJoin(tenantUsers, eq(tenantUsers.id, ppeIssueReports.reportedByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(eq(ppeIssueReports.itemId, ppeItemId), eq(ppeIssueReports.status, 'open')))
      .orderBy(desc(ppeIssueReports.reportedAt))
      .limit(1)

    return { ...row, activeIssue, openReport }
  })
  if (!data) return null

  // Recipients are whoever the sender explicitly typed — no silent fallback.
  // (This previously defaulted to EVERY active tenant user, which blasted the
  // whole company on a blank field; that behaviour is removed.)
  const primary = Array.from(new Set((options?.recipients ?? []).filter((s) => /@/.test(s))))
  if (primary.length === 0) return null
  const cc = (options?.cc ?? []).filter((s) => /@/.test(s) && !primary.includes(s))
  // The email transport has no separate CC lane — every address gets its own
  // copy, so CC entries are merged into the delivery list.
  const to = [...primary, ...cc]

  const typeName = data.type?.name ?? 'PPE'
  const holderName = data.activeIssue?.person
    ? `${data.activeIssue.person.firstName} ${data.activeIssue.person.lastName}`
    : '—'
  const reporterName =
    data.openReport?.reporterUser?.name ?? data.openReport?.reporterMembership?.displayName ?? '—'

  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    (data.openReport
      ? `PPE issue · ${typeName}${data.item.serialNumber ? ` · ${data.item.serialNumber}` : ''}`
      : `PPE item · ${typeName}${data.item.serialNumber ? ` · ${data.item.serialNumber}` : ''}`)

  const text = [
    `PPE ITEM`,
    `${typeName}${data.item.serialNumber ? ` · ${data.item.serialNumber}` : ''}`,
    ``,
    `Status: ${data.item.status}`,
    `Holder: ${holderName}`,
    `Size: ${data.item.size ?? '—'}`,
    data.item.expiresOn ? `Expires: ${data.item.expiresOn}` : '',
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    data.openReport
      ? [
          `OPEN ISSUE REPORT`,
          `Reported: ${formatDateTime(new Date(data.openReport.report.reportedAt), ctx.timezone, ctx.defaultLocale)}`,
          `Reported by: ${reporterName}`,
          `Description:`,
          data.openReport.report.description,
        ].join('\n')
      : 'No open issue report on this item.',
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">PPE: ${escapeHtml(typeName)}${data.item.serialNumber ? ` · ${escapeHtml(data.item.serialNumber)}` : ''}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        Status: <strong>${escapeHtml(data.item.status)}</strong> ·
        Holder: ${escapeHtml(holderName)}
        ${data.item.expiresOn ? ` · Expires ${escapeHtml(String(data.item.expiresOn))}` : ''}
      </div>
      ${
        options?.messageOverride
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
          : ''
      }
      ${
        data.openReport
          ? `<h3 style="margin:18px 0 4px;font-size:14px;color:#b91c1c">Open issue report</h3>
           <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
             <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Reported</td>
                 <td style="padding:4px 0;">${escapeHtml(formatDateTime(new Date(data.openReport.report.reportedAt), ctx.timezone, ctx.defaultLocale))}</td></tr>
             <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Reported by</td>
                 <td style="padding:4px 0;">${escapeHtml(reporterName)}</td></tr>
           </table>
           <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;font-size:13px;white-space:pre-wrap;">${escapeHtml(data.openReport.report.description ?? '(none)')}</div>`
          : `<div style="font-size:13px;color:#64748b;">No open issue report on this item.</div>`
      }
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
      category: data.openReport ? 'ppe_issue_report_send' : 'ppe_item_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'ppe_item',
    entityId: ppeItemId,
    action: 'export',
    summary: data.openReport
      ? `Emailed open issue report to ${to.length} recipient${to.length === 1 ? '' : 's'}`
      : `Emailed PPE item summary to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    metadata: {
      recipients: primary,
      cc,
      channel: 'email',
      issueReportId: data.openReport?.report.id ?? null,
    },
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
