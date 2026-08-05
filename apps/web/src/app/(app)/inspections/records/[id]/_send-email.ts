import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { formatDateTime } from '@/lib/datetime'

export async function sendInspectionEmail(
  ctx: RequestContext,
  recordId: string,
  options: {
    recipients: string[]
    cc?: string[]
    subjectPrefix?: string
    messageOverride?: string
  },
): Promise<{ recipientCount: number }> {
  const recipients = Array.from(
    new Set(
      [...options.recipients, ...(options.cc ?? [])].map((value) => value.trim()).filter(Boolean),
    ),
  )
  if (recipients.length === 0 || recipients.some((value) => !/^\S+@\S+\.\S+$/.test(value))) {
    throw new Error('Enter at least one valid recipient email address')
  }

  const data = await ctx.db(async (tx) => {
    const [record] = await tx
      .select({ record: inspectionRecords, type: inspectionTypes, site: orgUnits })
      .from(inspectionRecords)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
      .where(
        and(
          eq(inspectionRecords.id, recordId),
          eq(inspectionRecords.tenantId, ctx.tenantId),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .limit(1)
    if (!record) throw new Error('Inspection record was not found')
    const criteria = await tx
      .select()
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.recordId, recordId))
      .orderBy(asc(inspectionRecordCriteria.sequence))
    return { ...record, criteria }
  })

  const answerFor = (criterion: (typeof data.criteria)[number]) =>
    criterion.answer ??
    criterion.choiceAnswer ??
    criterion.textAnswer ??
    criterion.numberAnswer ??
    'Not answered'
  const subject = `${options.subjectPrefix ? `${options.subjectPrefix} · ` : ''}Inspection ${data.record.reference} · ${data.type.name}`
  const message = options.messageOverride?.trim()
  const summaryLines = data.criteria.map(
    (criterion) =>
      `- ${criterion.questionTextSnapshot}: ${answerFor(criterion)}${criterion.nonComplianceDescription ? ` — ${criterion.nonComplianceDescription}` : ''}`,
  )
  const text = [
    message || null,
    `${data.type.name} (${data.record.reference})`,
    `Status: ${data.record.status.replace(/_/g, ' ')}`,
    `Date: ${formatDateTime(data.record.occurredAt, ctx.timezone, ctx.defaultLocale)}`,
    `Location: ${data.site?.name ?? data.record.locationOnSite ?? '—'}`,
    '',
    'Checklist',
    ...summaryLines,
    '',
    `Open record: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}/inspections/records/${recordId}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:720px;margin:auto;color:#0f172a">
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <h2>${escapeHtml(data.type.name)} <span style="color:#64748b">${escapeHtml(data.record.reference)}</span></h2>
      <p><strong>Status:</strong> ${escapeHtml(data.record.status.replace(/_/g, ' '))}<br>
      <strong>Date:</strong> ${escapeHtml(formatDateTime(data.record.occurredAt, ctx.timezone, ctx.defaultLocale))}<br>
      <strong>Location:</strong> ${escapeHtml(data.site?.name ?? data.record.locationOnSite ?? '—')}</p>
      <h3>Checklist</h3>
      <table style="width:100%;border-collapse:collapse">
        ${data.criteria
          .map(
            (criterion) => `<tr>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0">${escapeHtml(criterion.questionTextSnapshot)}</td>
              <td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:600">${escapeHtml(String(answerFor(criterion)))}</td>
            </tr>`,
          )
          .join('')}
      </table>
    </div>`

  const { enqueueEmail } = await import('@beaconhs/jobs')
  await enqueueEmail({
    to: recipients,
    subject,
    html,
    text,
    meta: { tenantId: ctx.tenantId, category: 'inspection_record_send', userId: ctx.userId },
  })
  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: recordId,
    action: 'export',
    summary: `Emailed inspection to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
    after: { recipientCount: recipients.length, recipients },
  })
  return { recipientCount: recipients.length }
}

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
