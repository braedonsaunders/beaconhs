// Server-only helper to email a hazard assessment recap.
//
// Mirrors apps/web/src/app/(app)/incidents/[id]/_send-email.ts in shape:
// the parent server action collects form values, this helper resolves
// recipients + composes html/text and dispatches via `sendEmail`. The
// audit row + email_log row both end up linked back to the assessment.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidHazards,
  hazidTasks,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { recordAudit } from '@/lib/audit'
import { formatDateTime } from '@/lib/datetime'

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
      .where(and(eq(hazidAssessments.id, assessmentId), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!row) return null

    const tasks = await tx
      .select({ row: hazidAssessmentTasks, task: hazidTasks })
      .from(hazidAssessmentTasks)
      .leftJoin(hazidTasks, eq(hazidTasks.id, hazidAssessmentTasks.taskId))
      .where(eq(hazidAssessmentTasks.assessmentId, assessmentId))
      .orderBy(asc(hazidAssessmentTasks.entityOrder))
    const taskHazardIds = [...new Set(tasks.flatMap((t) => t.row.hazardIds))]
    const taskHazards =
      taskHazardIds.length > 0
        ? await tx
            .select({ id: hazidHazards.id, name: hazidHazards.name })
            .from(hazidHazards)
            .where(inArray(hazidHazards.id, taskHazardIds))
        : []
    const hazards = await tx
      .select({ row: hazidAssessmentHazards, library: hazidHazards })
      .from(hazidAssessmentHazards)
      .leftJoin(hazidHazards, eq(hazidHazards.id, hazidAssessmentHazards.hazardId))
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

    return { ...row, tasks, taskHazards, hazards, ppe, signatures }
  })
  if (!data) return null

  // Explicit recipients only — no silent blast to every active tenant user.
  // The email queue carries no Cc header (EmailJobData transports only `to`),
  // so Cc addresses are delivered as additional recipients rather than dropped.
  const to = Array.from(
    new Set([...(options?.recipients ?? []), ...(options?.cc ?? [])].filter((s) => /@/.test(s))),
  )
  if (to.length === 0) return null

  const supervisorName = data.supervisor
    ? `${data.supervisor.firstName} ${data.supervisor.lastName}`
    : '—'
  const subject =
    (options?.subjectPrefix ? `${options.subjectPrefix} · ` : '') +
    `Hazard Assessment ${data.a.reference}${data.type ? ` · ${data.type.name}` : ''}`
  const style = data.type?.style ?? 'task_based'
  const showJobScope = style === 'hazard_based'
  const showTasks = style === 'task_based'
  const showHazards = style === 'hazard_based'
  const showPPE = data.type?.hasPPE ?? true
  const taskHazardLookup = new Map(data.taskHazards.map((h) => [h.id, h.name]))
  const taskSummary = data.tasks.map((t) => {
    const name = t.task?.name ?? t.row.description ?? '—'
    const hazards = t.row.hazardIds
      .map((id) => taskHazardLookup.get(id))
      .filter((hazard): hazard is string => Boolean(hazard))
      .join(', ')
    return `  - ${name}${hazards ? `\n      Hazards: ${hazards}` : ''}${t.row.controls ? `\n      Controls: ${t.row.controls}` : ''}`
  })
  const hazardSummary = data.hazards.map((h) => {
    const name = h.library?.name ?? h.row.name ?? '—'
    const controls = [h.row.standardControls, h.row.specificControls].filter(Boolean).join(' / ')
    return `  - ${name}${controls ? `\n      Controls: ${controls}` : ''}`
  })
  const ppeRequired = data.ppe.filter((p) => p.answer === 'yes')

  const text = [
    `HAZARD ASSESSMENT`,
    `${data.a.reference}${data.type ? ` · ${data.type.name}` : ''}`,
    ``,
    `Occurred: ${formatDateTime(data.a.occurredAt, ctx.timezone)}`,
    `Site: ${data.site?.name ?? '—'}`,
    `Location on site: ${data.a.locationOnSite ?? '—'}`,
    `Supervisor: ${supervisorName}`,
    ...(showJobScope ? [`Job scope: ${htmlToText(data.a.jobScope) || '—'}`] : []),
    `Status: ${data.a.locked ? 'locked / completed' : 'in progress'}`,
    ``,
    options?.messageOverride ? `Note: ${options.messageOverride}\n` : '',
    ...(showTasks ? [`Tasks (${data.tasks.length}):`, ...taskSummary, ``] : []),
    ...(showHazards ? [`Hazards (${data.hazards.length}):`, ...hazardSummary, ``] : []),
    ...(showPPE ? [`PPE required:`, ...ppeRequired.map((p) => `  - ${p.name}`), ``] : []),
    `Signatures (${data.signatures.length}):`,
    ...data.signatures.map((s) => {
      const name = s.person
        ? `${s.person.firstName} ${s.person.lastName}`
        : (s.row.externalName ?? 'Unknown')
      return `  - ${name}${s.row.signedAt ? ` (signed ${formatDateTime(s.row.signedAt, ctx.timezone)})` : ' (not signed)'}`
    }),
  ]
    .filter((s) => s !== '')
    .join('\n')

  const jobScopeHtml = showJobScope
    ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;vertical-align:top;">Job scope</td>
            <td style="padding:4px 0;">${data.a.jobScope ? sanitizeDocumentHtml(data.a.jobScope) : '—'}</td></tr>`
    : ''
  const tasksHtml = showTasks
    ? `<h3 style="margin:18px 0 4px;font-size:14px;">Tasks (${data.tasks.length})</h3>
      ${
        data.tasks.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None recorded.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.tasks
              .map((t) => {
                const name = t.task?.name ?? t.row.description ?? '—'
                const hazards = t.row.hazardIds
                  .map((id) => taskHazardLookup.get(id))
                  .filter((hazard): hazard is string => Boolean(hazard))
                  .join(', ')
                return `<li><strong>${escapeHtml(name)}</strong>${hazards ? `<br/><span style="color:#64748b">Hazards: ${escapeHtml(hazards)}</span>` : ''}${t.row.controls ? `<br/><span style="color:#64748b">Controls: ${escapeHtml(t.row.controls)}</span>` : ''}</li>`
              })
              .join('')}</ul>`
      }`
    : ''
  const hazardsHtml = showHazards
    ? `<h3 style="margin:18px 0 4px;font-size:14px;">Hazards (${data.hazards.length})</h3>
      ${
        data.hazards.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None recorded.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.hazards
              .map((h) => {
                const controls = [h.row.standardControls, h.row.specificControls]
                  .filter(Boolean)
                  .join(' / ')
                return `<li><strong>${escapeHtml(h.library?.name ?? h.row.name ?? '—')}</strong>${controls ? `<br/><span style="color:#64748b">Controls: ${escapeHtml(controls)}</span>` : ''}</li>`
              })
              .join('')}</ul>`
      }`
    : ''
  const ppeHtml = showPPE
    ? `<h3 style="margin:18px 0 4px;font-size:14px;">PPE</h3>
      ${
        ppeRequired.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None required.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${ppeRequired
              .map((p) => `<li>${escapeHtml(p.name)}</li>`)
              .join('')}</ul>`
      }`
    : ''

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">Hazard Assessment ${escapeHtml(data.a.reference)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${data.type ? escapeHtml(data.type.name) + ' · ' : ''}
        ${escapeHtml(formatDateTime(data.a.occurredAt, ctx.timezone))} ·
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
        ${jobScopeHtml}
      </table>
      ${tasksHtml}
      ${hazardsHtml}
      ${ppeHtml}
      <h3 style="margin:18px 0 4px;font-size:14px;">Signatures (${data.signatures.length})</h3>
      ${
        data.signatures.length === 0
          ? '<div style="font-size:13px;color:#64748b;">None captured.</div>'
          : `<ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">${data.signatures
              .map((s) => {
                const name = s.person
                  ? `${escapeHtml(s.person.firstName)} ${escapeHtml(s.person.lastName)}`
                  : escapeHtml(s.row.externalName ?? 'Unknown')
                return `<li>${name}${s.row.signedAt ? ` (signed ${escapeHtml(formatDateTime(s.row.signedAt, ctx.timezone))})` : ' (not signed)'}</li>`
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
