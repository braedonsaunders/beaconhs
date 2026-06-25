// Server-only helper to email a hazard assessment recap.
//
// Mirrors apps/web/src/app/(app)/incidents/[id]/_send-email.ts in shape:
// the parent server action collects form values, this helper resolves
// recipients + composes html/text and dispatches via `sendEmail`. The
// audit row + email_log row both end up linked back to the assessment.

import { and, asc, eq, sql } from 'drizzle-orm'
import {
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypes,
  hazidAssessments,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { recordAudit } from '@/lib/audit'

export async function sendHazidEmail(
  ctx: RequestContext,
  assessmentId: string,
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
        a: hazidAssessments,
        type: hazidAssessmentTypes,
        site: orgUnits,
        supervisor: people,
      })
      .from(hazidAssessments)
      .leftJoin(
        hazidAssessmentTypes,
        eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
      )
      .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
      .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
      .where(eq(hazidAssessments.id, assessmentId))
      .limit(1)
    if (!row) return null

    const tasks = await tx
      .select()
      .from(hazidAssessmentTasks)
      .where(eq(hazidAssessmentTasks.assessmentId, assessmentId))
      .orderBy(asc(hazidAssessmentTasks.entityOrder))
    const hazards = await tx
      .select()
      .from(hazidAssessmentHazards)
      .where(eq(hazidAssessmentHazards.assessmentId, assessmentId))
      .orderBy(asc(hazidAssessmentHazards.entityOrder))
    const ppe = await tx
      .select()
      .from(hazidAssessmentPPE)
      .where(eq(hazidAssessmentPPE.assessmentId, assessmentId))
    const signatures = await tx
      .select({ row: hazidAssessmentSignatures, person: people })
      .from(hazidAssessmentSignatures)
      .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
      .where(eq(hazidAssessmentSignatures.assessmentId, assessmentId))

    // Default distribution = active tenant admins on this tenant.
    const adminRecipients = await tx
      .select({ email: users.email })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(
        and(
          eq(tenantUsers.tenantId, row.a.tenantId),
          eq(tenantUsers.status, 'active'),
          sql`${users.email} IS NOT NULL`,
        ),
      )

    return { ...row, tasks, hazards, ppe, signatures, adminRecipients }
  })
  if (!data) return null

  const explicit = (options?.recipients ?? []).filter((s) => /@/.test(s))
  const adminEmails = data.adminRecipients.map((r) => r.email).filter((s): s is string => !!s)
  // Explicit recipients override the default distribution; if none given,
  // fall back to tenant-admin distribution.
  const to = explicit.length > 0 ? explicit : Array.from(new Set(adminEmails))
  if (to.length === 0) return null
  const cc = (options?.cc ?? []).filter((s) => /@/.test(s))

  const supervisorName = data.supervisor
    ? `${data.supervisor.firstName} ${data.supervisor.lastName}`
    : '—'
  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    `Hazard Assessment ${data.a.reference}${data.type ? ` · ${data.type.name}` : ''}`

  const text = [
    `HAZARD ASSESSMENT`,
    `${data.a.reference}${data.type ? ` · ${data.type.name}` : ''}`,
    ``,
    `Occurred: ${data.a.occurredAt.toLocaleString()}`,
    `Site: ${data.site?.name ?? '—'}`,
    `Location on site: ${data.a.locationOnSite ?? '—'}`,
    `Supervisor: ${supervisorName}`,
    `Job scope: ${htmlToText(data.a.jobScope) || '—'}`,
    `Status: ${data.a.locked ? 'locked / completed' : 'in progress'}`,
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    `Tasks (${data.tasks.length}):`,
    ...data.tasks.map((t) => `  - ${t.description ?? '—'}`),
    ``,
    `Hazards (${data.hazards.length}):`,
    ...data.hazards.map((h) => {
      const controls = [h.standardControls, h.specificControls].filter(Boolean).join(' / ')
      return `  - ${h.name ?? '—'}${controls ? `\n      Controls: ${controls}` : ''}`
    }),
    ``,
    `PPE required:`,
    ...data.ppe.filter((p) => p.answer === 'yes').map((p) => `  - ${p.name}`),
    ``,
    `Signatures (${data.signatures.length}):`,
    ...data.signatures.map((s) => {
      const name = s.person
        ? `${s.person.firstName} ${s.person.lastName}`
        : (s.row.externalName ?? 'Unknown')
      return `  - ${name}${s.row.signedAt ? ` (signed ${s.row.signedAt.toLocaleString()})` : ' (not signed)'}`
    }),
  ]
    .filter((s) => s !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">Hazard Assessment ${escapeHtml(data.a.reference)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${data.type ? escapeHtml(data.type.name) + ' · ' : ''}
        ${escapeHtml(data.a.occurredAt.toLocaleString())} ·
        ${data.a.locked ? 'locked / completed' : 'in progress'}
      </div>
      ${
        options?.messageOverride
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
          : ''
      }
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Site</td>
            <td style="padding:4px 0;">${escapeHtml(data.site?.name ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Location</td>
            <td style="padding:4px 0;">${escapeHtml(data.a.locationOnSite ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Supervisor</td>
            <td style="padding:4px 0;">${escapeHtml(supervisorName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;">Job scope</td>
            <td style="padding:4px 0;">${data.a.jobScope ? sanitizeDocumentHtml(data.a.jobScope) : '—'}</td></tr>
      </table>
      <h3 style="margin:18px 0 4px;font-size:14px;">Tasks (${data.tasks.length})</h3>
      ${
        data.tasks.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None recorded.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.tasks.map((t) => `<li>${escapeHtml(t.description ?? '—')}</li>`).join('')}</ul>`
      }
      <h3 style="margin:18px 0 4px;font-size:14px;">Hazards (${data.hazards.length})</h3>
      ${
        data.hazards.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None recorded.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.hazards
              .map((h) => {
                const controls = [h.standardControls, h.specificControls]
                  .filter(Boolean)
                  .join(' / ')
                return `<li><strong>${escapeHtml(h.name ?? '—')}</strong>${controls ? `<br/><span style="color:#64748b">Controls: ${escapeHtml(controls)}</span>` : ''}</li>`
              })
              .join('')}</ul>`
      }
      <h3 style="margin:18px 0 4px;font-size:14px;">PPE</h3>
      ${
        data.ppe.filter((p) => p.answer === 'yes').length === 0
          ? '<div style="font-size:13px;color:#64748b;">None required.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.ppe
              .filter((p) => p.answer === 'yes')
              .map((p) => `<li>${escapeHtml(p.name)}</li>`)
              .join('')}</ul>`
      }
      <h3 style="margin:18px 0 4px;font-size:14px;">Signatures (${data.signatures.length})</h3>
      ${
        data.signatures.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None captured.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.signatures
              .map((s) => {
                const name = s.person
                  ? `${escapeHtml(s.person.firstName)} ${escapeHtml(s.person.lastName)}`
                  : escapeHtml(s.row.externalName ?? 'Unknown')
                return `<li>${name}${s.row.signedAt ? ` (signed ${escapeHtml(s.row.signedAt.toLocaleString())})` : ' (not signed)'}</li>`
              })
              .join('')}</ul>`
      }
    </div>
  `

  // Enqueue via BullMQ so the worker captures email_log + retries on
  // failure. The worker stamps meta.tenantId + meta.category onto the
  // email_log row so this send is queryable from /admin/email-log.
  const { enqueueEmail } = await import('@beaconhs/jobs')
  await enqueueEmail({
    to,
    subject,
    html,
    text,
    meta: {
      tenantId: ctx.tenantId,
      category: 'hazid_assessment_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: assessmentId,
    action: 'export',
    summary: `Emailed hazard assessment to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    after: { recipientCount: to.length, recipients: to, cc },
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
