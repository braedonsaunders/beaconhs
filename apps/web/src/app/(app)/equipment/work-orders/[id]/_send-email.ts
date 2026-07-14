// Server-only helper to email an equipment work order. Sends a recap
// with the WO summary, status, equipment, priority, assignee + reporter
// and the description / action-taken text. Recipients are explicit, plus the
// assigned user when they have an email address.

import { eq } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentWorkOrders,
  people,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { formatDateTime } from '@/lib/datetime'
import { recordAudit } from '@/lib/audit'

export async function sendWorkOrderEmail(
  ctx: RequestContext,
  workOrderId: string,
  options?: {
    recipients?: string[]
    cc?: string[]
    subjectPrefix?: string
    messageOverride?: string
  },
): Promise<{ recipientCount: number } | null> {
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        wo: equipmentWorkOrders,
        item: equipmentItems,
        assigneeMembership: tenantUsers,
        assigneeUser: user,
        reporter: people,
      })
      .from(equipmentWorkOrders)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(people, eq(people.id, equipmentWorkOrders.reportedByPersonId))
      .where(eq(equipmentWorkOrders.id, workOrderId))
      .limit(1)
    if (!row) return null

    return { ...row }
  })
  if (!data) return null

  // Explicit recipients (+ the assignee, who the work order is for) — no blast
  // to every active tenant user.
  const primary = Array.from(
    new Set([
      ...(options?.recipients ?? []).filter((s) => /@/.test(s)),
      ...(data.assigneeUser?.email ? [data.assigneeUser.email] : []),
    ]),
  )
  const primaryCanonical = new Set(primary.map((address) => address.toLowerCase()))
  const cc = Array.from(
    new Set(
      (options?.cc ?? []).filter(
        (address) => /@/.test(address) && !primaryCanonical.has(address.toLowerCase()),
      ),
    ),
  )
  // The queue delivers one private copy per address and has no Cc header.
  const to = [...primary, ...cc]
  if (to.length === 0) return null
  if (to.length > 100) throw new Error('A work-order email may have at most 100 recipients')

  const assigneeName =
    data.assigneeUser?.name ?? data.assigneeMembership?.displayName ?? 'Unassigned'
  const reporterName = data.reporter ? `${data.reporter.firstName} ${data.reporter.lastName}` : '—'
  const equipmentLine = data.item
    ? `${data.item.assetTag ?? ''} ${data.item.name ?? ''}`.trim()
    : '—'

  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    `Work Order ${data.wo.reference} · ${data.wo.summary}`

  const text = [
    `WORK ORDER`,
    `${data.wo.reference} · ${data.wo.summary}`,
    ``,
    `Status: ${data.wo.status}`,
    `Priority: ${data.wo.priority}`,
    `Equipment: ${equipmentLine}`,
    `Assignee: ${assigneeName}`,
    `Reported by: ${reporterName}`,
    `Opened: ${formatDateTime(new Date(data.wo.openedAt), ctx.timezone)}`,
    data.wo.closedAt ? `Closed: ${formatDateTime(new Date(data.wo.closedAt), ctx.timezone)}` : '',
    data.wo.cost ? `Cost: $${Number(data.wo.cost).toLocaleString()}` : '',
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    `Description:`,
    data.wo.description ?? '(none)',
    ``,
    `Action taken:`,
    data.wo.actionTaken ?? '(none)',
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(data.wo.summary)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        <span style="font-family:monospace">${escapeHtml(data.wo.reference)}</span> ·
        priority ${escapeHtml(data.wo.priority)} ·
        status ${escapeHtml(data.wo.status)}
        ${data.wo.closedAt ? ` · closed ${escapeHtml(formatDateTime(new Date(data.wo.closedAt), ctx.timezone))}` : ''}
      </div>
      ${
        options?.messageOverride
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
          : ''
      }
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Equipment</td>
            <td style="padding:4px 0;">${escapeHtml(equipmentLine)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Assignee</td>
            <td style="padding:4px 0;">${escapeHtml(assigneeName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Reported by</td>
            <td style="padding:4px 0;">${escapeHtml(reporterName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Opened</td>
            <td style="padding:4px 0;">${escapeHtml(formatDateTime(new Date(data.wo.openedAt), ctx.timezone))}</td></tr>
        ${
          data.wo.cost
            ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;">Cost</td>
                 <td style="padding:4px 0;">$${escapeHtml(Number(data.wo.cost).toLocaleString())}</td></tr>`
            : ''
        }
      </table>
      <h3 style="margin:18px 0 4px;font-size:14px;">Description</h3>
      <div style="font-size:13px;white-space:pre-wrap;margin-bottom:12px;">${escapeHtml(data.wo.description ?? '(none)')}</div>
      <h3 style="margin:18px 0 4px;font-size:14px;">Action taken</h3>
      <div style="font-size:13px;white-space:pre-wrap;margin-bottom:12px;">${escapeHtml(data.wo.actionTaken ?? '(none)')}</div>
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
      category: 'equipment_work_order_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: workOrderId,
    action: 'export',
    summary: `Emailed work order to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    metadata: { recipients: primary, cc, deliveredTo: to, channel: 'email' },
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
