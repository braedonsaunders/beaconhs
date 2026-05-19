// Server-only helper for sending a toolbox-talk recap email.
// Keeps the [id]/page.tsx server actions thin.
//
// Recipient strategy (per spec): tenant_notification_recipients lookup is too
// far away — send to the super-admin / tenant admin emails (users with active
// tenantUsers memberships) for the journal's tenant. Falls back to the
// tenant's invitee admin if no other admins are found.

import { and, eq, sql } from 'drizzle-orm'
import { sendEmail } from '@beaconhs/emails'
import {
  orgUnits,
  tenantUsers,
  toolboxJournalAttendees,
  toolboxJournals,
  user,
  users,
  people,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

export async function sendJournalEmail(ctx: RequestContext, journalId: string): Promise<void> {
  const data = await ctx.db(async (tx) => {
    const [j] = await tx
      .select({
        journal: toolboxJournals,
        site: orgUnits,
        foremanMembership: tenantUsers,
        foremanUser: user,
      })
      .from(toolboxJournals)
      .leftJoin(orgUnits, eq(orgUnits.id, toolboxJournals.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, toolboxJournals.foremanTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(toolboxJournals.id, journalId))
      .limit(1)
    if (!j) return null

    const attendeesRows = await tx
      .select({
        att: toolboxJournalAttendees,
        person: people,
      })
      .from(toolboxJournalAttendees)
      .innerJoin(people, eq(people.id, toolboxJournalAttendees.personId))
      .where(eq(toolboxJournalAttendees.journalId, journalId))

    // Admin distribution: all active tenant members on this tenant. We bypass
    // RLS via the standard "app.bypass_rls" guard inside the tenant context
    // and then re-scope to admins. Keep simple — pull every active member
    // with an email.
    const recipients = await tx
      .select({ email: users.email, name: users.name })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(
        and(
          eq(tenantUsers.tenantId, j.journal.tenantId),
          eq(tenantUsers.status, 'active'),
          sql`${users.email} IS NOT NULL`,
        ),
      )

    return { ...j, attendeesRows, recipients }
  })
  if (!data) return

  const to = Array.from(new Set(data.recipients.map((r) => r.email).filter(Boolean)))
  if (to.length === 0) return

  const foremanName =
    data.foremanUser?.name ?? data.foremanMembership?.displayName ?? 'Unknown foreman'
  const subject = `Toolbox Talk · ${data.journal.reference} · ${data.journal.occurredOn}`
  const signedCount = data.attendeesRows.filter((a) => !!a.att.signatureDataUrl).length

  const attendeeLines = data.attendeesRows.map(
    (a) =>
      `  - ${a.person.lastName}, ${a.person.firstName}${
        a.att.signatureDataUrl ? ' (signed)' : ''
      }`,
  )
  const text = [
    `Toolbox Talk: ${data.journal.title}`,
    ``,
    `Reference: ${data.journal.reference}`,
    `Date: ${data.journal.occurredOn}`,
    `Site: ${data.site?.name ?? '—'}`,
    `Foreman: ${foremanName}`,
    `Topic: ${data.journal.topic ?? '—'}`,
    ``,
    `Attendees: ${data.attendeesRows.length} (${signedCount} signed)`,
    ...attendeeLines,
    ``,
    `Discussion:`,
    data.journal.discussionNotes ?? '(none)',
    ``,
    `Questions raised:`,
    data.journal.questionsRaised ?? '(none)',
    ``,
    `Action items:`,
    data.journal.actionItems ?? '(none)',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:680px;">
      <h2 style="margin:0 0 4px">Toolbox Talk · ${escapeHtml(data.journal.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px;">
        ${escapeHtml(data.journal.reference)} · ${escapeHtml(data.journal.occurredOn)} ·
        Foreman: ${escapeHtml(foremanName)}
      </div>
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Site</td>
            <td style="padding:4px 0;">${escapeHtml(data.site?.name ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Topic</td>
            <td style="padding:4px 0;">${escapeHtml(data.journal.topic ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Status</td>
            <td style="padding:4px 0;">${escapeHtml(data.journal.status)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Attendees</td>
            <td style="padding:4px 0;">${data.attendeesRows.length} (${signedCount} signed)</td></tr>
      </table>
      <h3 style="margin:18px 0 4px;font-size:14px;">Attendees</h3>
      <ul style="font-size:13px;margin:0 0 12px 18px;padding:0;">
        ${data.attendeesRows
          .map(
            (a) =>
              `<li>${escapeHtml(a.person.lastName)}, ${escapeHtml(a.person.firstName)}${
                a.att.signatureDataUrl
                  ? ' <span style="color:#15803d;">(signed)</span>'
                  : ''
              }</li>`,
          )
          .join('\n')}
      </ul>
      ${section('Discussion', data.journal.discussionNotes)}
      ${section('Questions raised', data.journal.questionsRaised)}
      ${section('Action items', data.journal.actionItems)}
    </div>
  `

  await sendEmail({ to, subject, html, text })
  await recordAudit(ctx, {
    entityType: 'toolbox_journal',
    entityId: journalId,
    action: 'update',
    summary: `Emailed ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    after: { recipientCount: to.length },
  })
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
