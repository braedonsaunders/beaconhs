// Server-only helper for sending an incident recap email.
//
// Explicit recipients only — no silent blast to every active tenant user. The
// body carries injury, hospital, and insurance details, so the sender must
// name who receives it (matches the hazard-assessment / document senders).

import { eq } from 'drizzle-orm'
import { departments, incidentInjuries, incidents, orgUnits, people } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

export async function sendIncidentEmail(
  ctx: RequestContext,
  incidentId: string,
  options?: { recipients?: string[]; subjectPrefix?: string; messageOverride?: string },
): Promise<{ recipientCount: number } | null> {
  const data = await ctx.db(async (tx) => {
    const [inc] = await tx
      .select({
        i: incidents,
        site: orgUnits,
        department: departments,
        supervisor: people,
      })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .leftJoin(departments, eq(departments.id, incidents.departmentId))
      .leftJoin(people, eq(people.id, incidents.supervisorPersonId))
      .where(eq(incidents.id, incidentId))
      .limit(1)
    if (!inc) return null

    const injuries = await tx
      .select({ inj: incidentInjuries, person: people })
      .from(incidentInjuries)
      .leftJoin(people, eq(people.id, incidentInjuries.personId))
      .where(eq(incidentInjuries.incidentId, incidentId))

    return { ...inc, injuries }
  })
  if (!data) return null

  const to = Array.from(new Set((options?.recipients ?? []).filter((s) => /@/.test(s))))
  if (to.length === 0) return null

  const supervisorName = data.supervisor
    ? `${data.supervisor.firstName} ${data.supervisor.lastName}`
    : '—'
  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    `Incident ${data.i.reference} · ${data.i.title}`

  const injuryLines = data.injuries.map((j) => {
    const name = j.person
      ? `${j.person.firstName} ${j.person.lastName}`
      : (j.inj.personName ?? 'Unknown')
    const parts = j.inj.bodyParts.join(', ') || '—'
    const types =
      Array.isArray(j.inj.injuryTypes) && j.inj.injuryTypes.length > 0
        ? j.inj.injuryTypes.join(', ')
        : '—'
    return `  - ${name} · ${types} · ${parts}`
  })

  const text = [
    `INCIDENT REPORT`,
    `${data.i.reference} · ${data.i.title}`,
    ``,
    `Occurred: ${data.i.occurredAt.toLocaleString()}`,
    `Reported: ${data.i.reportedAt.toLocaleString()}`,
    `Site: ${data.site?.name ?? '—'}`,
    `Department: ${data.department?.name ?? '—'}`,
    `Supervisor: ${supervisorName}`,
    `Type: ${data.i.type.replace(/_/g, ' ')}`,
    `Severity: ${data.i.severity.replace(/_/g, ' ')}`,
    `Status: ${data.i.status.replace(/_/g, ' ')}`,
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}` : '',
    ``,
    `Description:`,
    data.i.description ?? '(none)',
    ``,
    `Events leading up:`,
    data.i.eventsLeadingUp ?? '(none)',
    ``,
    `Immediate action taken:`,
    data.i.immediateActionTaken ?? '(none)',
    ``,
    data.injuries.length > 0 ? `Injuries (${data.injuries.length}):` : 'No injuries recorded.',
    ...injuryLines,
    ``,
    `Medical:`,
    `  EMS called: ${yn(data.i.emsCalled)}`,
    `  First aid: ${yn(data.i.firstAidReceived || data.i.firstAidGiven)}`,
    `  Medical attention: ${yn(data.i.medicalAttentionReceived)}`,
    `  Hospital: ${data.i.hospitalName ?? data.i.treatedAtHospital ?? '—'}`,
    `  MOL notified: ${yn(data.i.ministryOfLabourNotified)}${data.i.molReportNumber ? ` (${data.i.molReportNumber})` : ''}`,
    `  Police notified: ${yn(data.i.policeNotified)}${data.i.policeReportNumber ? ` (${data.i.policeReportNumber})` : ''}`,
    `  Insurance claim: ${data.i.insuranceClaimNumber ?? '—'}`,
    ``,
    `Severity (1-5): actual=${data.i.actualSeverity ?? '—'} · potential=${data.i.potentialSeverity ?? '—'}`,
    `Damage estimate: ${data.i.damageEstimate ? `$${Number(data.i.damageEstimate).toLocaleString()}` : '—'}`,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(data.i.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${escapeHtml(data.i.reference)} ·
        ${escapeHtml(data.i.type.replace(/_/g, ' '))} ·
        severity ${escapeHtml(data.i.severity.replace(/_/g, ' '))} ·
        status ${escapeHtml(data.i.status.replace(/_/g, ' '))}
      </div>
      ${
        options?.messageOverride
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(options.messageOverride)}</div>`
          : ''
      }
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Occurred</td>
            <td style="padding:4px 0;">${escapeHtml(data.i.occurredAt.toLocaleString())}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Site</td>
            <td style="padding:4px 0;">${escapeHtml(data.site?.name ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Supervisor</td>
            <td style="padding:4px 0;">${escapeHtml(supervisorName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Department</td>
            <td style="padding:4px 0;">${escapeHtml(data.department?.name ?? '—')}</td></tr>
      </table>
      ${section('Description', data.i.description)}
      ${section('Events leading up', data.i.eventsLeadingUp)}
      ${section('Immediate action taken', data.i.immediateActionTaken)}
      <h3 style="margin:18px 0 4px;font-size:14px;">Injuries (${data.injuries.length})</h3>
      ${
        data.injuries.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None recorded.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.injuries
              .map((j) => {
                const name = j.person
                  ? `${escapeHtml(j.person.firstName)} ${escapeHtml(j.person.lastName)}`
                  : escapeHtml(j.inj.personName ?? 'Unknown')
                const types =
                  Array.isArray(j.inj.injuryTypes) && j.inj.injuryTypes.length > 0
                    ? escapeHtml(j.inj.injuryTypes.join(', '))
                    : '—'
                const parts = escapeHtml(j.inj.bodyParts.join(', ') || '—')
                return `<li>${name} — ${types} (${parts})</li>`
              })
              .join('')}</ul>`
      }
      <h3 style="margin:18px 0 4px;font-size:14px;">Medical / notification</h3>
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">EMS called</td>
            <td>${yn(data.i.emsCalled)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">First aid</td>
            <td>${yn(data.i.firstAidReceived || data.i.firstAidGiven)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">Medical attention</td>
            <td>${yn(data.i.medicalAttentionReceived)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">Hospital</td>
            <td>${escapeHtml(data.i.hospitalName ?? data.i.treatedAtHospital ?? '—')}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">MOL notified</td>
            <td>${yn(data.i.ministryOfLabourNotified)}${
              data.i.molReportNumber ? ` (${escapeHtml(data.i.molReportNumber)})` : ''
            }</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">Police notified</td>
            <td>${yn(data.i.policeNotified)}${
              data.i.policeReportNumber ? ` (${escapeHtml(data.i.policeReportNumber)})` : ''
            }</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#64748b;">Insurance claim</td>
            <td>${escapeHtml(data.i.insuranceClaimNumber ?? '—')}</td></tr>
      </table>
    </div>
  `

  // Enqueue via BullMQ so the worker captures an email_log row + retries on
  // failure (mirrors the hazard-assessment / document send helpers).
  const { enqueueEmail } = await import('@beaconhs/jobs')
  await enqueueEmail({
    to,
    subject,
    html,
    text,
    meta: {
      tenantId: ctx.tenantId,
      category: 'incident_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: incidentId,
    action: 'export',
    summary: `Emailed incident to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    after: { recipientCount: to.length, recipients: to },
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

function section(title: string, body: string | null | undefined): string {
  return `
    <h3 style="margin:18px 0 4px;font-size:14px;">${escapeHtml(title)}</h3>
    <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(body ?? '(none)')}</div>
  `
}

function yn(b: boolean | null | undefined): string {
  return b ? 'yes' : 'no'
}
