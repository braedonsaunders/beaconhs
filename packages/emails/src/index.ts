// Email delivery. The provider abstraction (Resend, SendGrid, Mailgun, Postmark,
// SMTP) lives in ./providers + ./transport. This file keeps `sendEmail` as the
// environment fallback — used for platform sends that have no tenant/platform
// provider configured (for example auth magic links) — plus all the built-in
// transactional templates. Missing configuration is an error: callers must
// never record a delivery that no provider accepted.

import { sendVia, type SendEmailInput } from './transport'

export * from './providers'
export * from './transport'

const defaultFrom = process.env.RESEND_FROM ?? 'BeaconHS <noreply@beaconhs.app>'

// The worker resolves a tenant/platform transport first (see
// @beaconhs/worker resolve-email-transport) and only falls back to this when
// none is configured. A real Resend key is required for this fallback.
export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error(
      'Email delivery is not configured: set a tenant/platform provider or RESEND_API_KEY',
    )
  }
  return sendVia({ provider: 'resend', apiKey, from: input.from ?? defaultFrom }, input)
}

// --- Templates -----------------------------------------------------------

export function magicLinkEmail(args: { url: string; appName: string }): {
  subject: string
  html: string
  text: string
} {
  const subject = `Sign in to ${args.appName}`
  const text = `Click the link to sign in: ${args.url}\n\nThis link expires in 15 minutes. If you didn't request this, you can ignore this email.`
  const html = `
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:ui-sans-serif,system-ui,sans-serif;color:#111">
      <tr><td>
        <h2 style="margin:0 0 16px">Sign in to ${args.appName}</h2>
        <p>Click the button below to sign in. This link expires in 15 minutes.</p>
        <p style="margin:24px 0"><a href="${args.url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in</a></p>
        <p style="color:#666;font-size:12px">If you didn't request this email, you can safely ignore it.</p>
      </td></tr>
    </table>`
  return { subject, html, text }
}

// HTML escape — applied to every user-controlled value rendered in template HTML.
function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

type EmailOut = { subject: string; html: string; text: string }

function shell(args: {
  heading: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
  ctaColor?: string
  footer?: string
}): string {
  const cta =
    args.ctaUrl && args.ctaLabel
      ? `<p style="margin:24px 0"><a href="${esc(args.ctaUrl)}" style="background:${args.ctaColor ?? '#0f766e'};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">${esc(args.ctaLabel)}</a></p>`
      : ''
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:ui-sans-serif,system-ui,sans-serif;color:#111;line-height:1.5">
      <tr><td>
        <h2 style="margin:0 0 16px">${esc(args.heading)}</h2>
        ${args.bodyHtml}
        ${cta}
        <p style="color:#666;font-size:12px;margin-top:24px">${args.footer ? esc(args.footer) : 'You can manage your notification preferences in BeaconHS settings.'}</p>
      </td></tr>
    </table>`
}

export function incidentReportedEmail(args: {
  tenant: { name: string }
  incident: {
    reference: string
    title: string
    severity: string
    summary?: string | null
    location?: string | null
  }
  reporter?: { displayName?: string | null } | null
  url: string
}): EmailOut {
  const i = args.incident
  const subject = `[${i.severity.toUpperCase()}] Incident reported: ${i.reference}`
  const reporterName = args.reporter?.displayName ?? 'someone in the field'
  const text =
    `An incident has been reported in ${args.tenant.name}.\n\n` +
    `Reference: ${i.reference}\n` +
    `Title: ${i.title}\n` +
    `Severity: ${i.severity}\n` +
    `${i.location ? `Location: ${i.location}\n` : ''}` +
    `Reported by: ${reporterName}\n` +
    `${i.summary ? `\nSummary:\n${i.summary}\n` : ''}` +
    `\nReview it: ${args.url}`
  const html = shell({
    heading: 'Incident reported',
    bodyHtml: `
      <p><strong>${esc(i.reference)}</strong> · ${esc(i.title)}</p>
      <p>Severity: <strong>${esc(i.severity)}</strong>${i.location ? ` · Location: ${esc(i.location)}` : ''}</p>
      <p>Reported by ${esc(reporterName)} in ${esc(args.tenant.name)}.</p>
      ${i.summary ? `<p style="background:#f9fafb;padding:12px;border-left:3px solid #dc2626;border-radius:4px">${esc(i.summary)}</p>` : ''}`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
    ctaColor: '#dc2626',
  })
  return { subject, html, text }
}

export function caAssignedEmail(args: {
  tenant: { name: string }
  ca: {
    reference: string
    title: string
    severity: string
    dueOn?: string | null
    description?: string | null
  }
  assigner?: { displayName?: string | null } | null
  url: string
}): EmailOut {
  const c = args.ca
  const assigner = args.assigner?.displayName ?? 'A team member'
  const subject = `Corrective action assigned: ${c.reference}`
  const text =
    `${assigner} assigned a corrective action to you in ${args.tenant.name}.\n\n` +
    `Reference: ${c.reference}\n` +
    `Title: ${c.title}\n` +
    `Severity: ${c.severity}\n` +
    `${c.dueOn ? `Due on: ${c.dueOn}\n` : ''}` +
    `${c.description ? `\n${c.description}\n` : ''}` +
    `\nOpen it: ${args.url}`
  const html = shell({
    heading: 'Corrective action assigned',
    bodyHtml: `
      <p>${esc(assigner)} assigned <strong>${esc(c.reference)} — ${esc(c.title)}</strong> to you.</p>
      <p>Severity: <strong>${esc(c.severity)}</strong>${c.dueOn ? ` · Due: <strong>${esc(c.dueOn)}</strong>` : ''}</p>
      ${c.description ? `<p style="background:#f9fafb;padding:12px;border-left:3px solid #0f766e;border-radius:4px">${esc(c.description)}</p>` : ''}`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
    ctaColor: '#0f766e',
  })
  return { subject, html, text }
}

export function caCompletedEmail(args: {
  tenant: { name: string }
  ca: { reference: string; title: string; status: string }
  completer?: { displayName?: string | null } | null
  url: string
}): EmailOut {
  const c = args.ca
  const completer = args.completer?.displayName ?? 'A team member'
  const subject = `Corrective action ${c.status === 'closed' ? 'closed' : 'updated'}: ${c.reference}`
  const text =
    `${completer} moved ${c.reference} to "${c.status.replace(/_/g, ' ')}" in ${args.tenant.name}.\n\n` +
    `Title: ${c.title}\n\nOpen it: ${args.url}`
  const html = shell({
    heading: `Corrective action ${c.status.replace(/_/g, ' ')}`,
    bodyHtml: `
      <p>${esc(completer)} moved <strong>${esc(c.reference)} — ${esc(c.title)}</strong> to <strong>${esc(c.status.replace(/_/g, ' '))}</strong>.</p>`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
  })
  return { subject, html, text }
}

export function caOverdueEmail(args: {
  tenant: { name: string }
  ca: { reference: string; title: string; dueOn?: string | null }
  url: string
}): EmailOut {
  const c = args.ca
  const subject = `Overdue: ${c.reference} — ${c.title}`
  const text =
    `A corrective action is overdue in ${args.tenant.name}.\n\n` +
    `Reference: ${c.reference}\nTitle: ${c.title}\n` +
    `${c.dueOn ? `Was due on: ${c.dueOn}\n` : ''}` +
    `\nOpen it: ${args.url}`
  const html = shell({
    heading: 'Corrective action overdue',
    bodyHtml: `
      <p><strong>${esc(c.reference)} — ${esc(c.title)}</strong> is past its due date${c.dueOn ? ` of <strong>${esc(c.dueOn)}</strong>` : ''}.</p>
      <p>Please take action or update the status.</p>`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
    ctaColor: '#dc2626',
  })
  return { subject, html, text }
}

export function trainingExpiringEmail(args: {
  tenant: { name: string }
  person: { name: string }
  training: { courseName: string; expiresOn: string }
  daysToExpiry: number
  url: string
}): EmailOut {
  const subject = `${args.training.courseName} expires in ${args.daysToExpiry} days — ${args.person.name}`
  const text =
    `${args.person.name}'s ${args.training.courseName} expires on ${args.training.expiresOn} (${args.daysToExpiry} days).\n\n` +
    `Open record: ${args.url}`
  const html = shell({
    heading: 'Certification expiring',
    bodyHtml: `
      <p><strong>${esc(args.person.name)}</strong>'s <strong>${esc(args.training.courseName)}</strong> expires on <strong>${esc(args.training.expiresOn)}</strong> (${args.daysToExpiry} day${args.daysToExpiry === 1 ? '' : 's'}).</p>
      <p>From ${esc(args.tenant.name)}.</p>`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
  })
  return { subject, html, text }
}

export function trainingExpiredEmail(args: {
  tenant: { name: string }
  person: { name: string }
  training: { courseName: string; expiresOn: string }
  url: string
}): EmailOut {
  const subject = `EXPIRED: ${args.training.courseName} — ${args.person.name}`
  const text =
    `${args.person.name}'s ${args.training.courseName} expired on ${args.training.expiresOn}.\n\n` +
    `Open record: ${args.url}`
  const html = shell({
    heading: 'Certification expired',
    bodyHtml: `
      <p><strong>${esc(args.person.name)}</strong>'s <strong>${esc(args.training.courseName)}</strong> expired on <strong>${esc(args.training.expiresOn)}</strong>.</p>
      <p>This person should not be performing tasks covered by this certification until renewed.</p>`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
    ctaColor: '#dc2626',
  })
  return { subject, html, text }
}

export function documentReviewDueEmail(args: {
  tenant: { name: string }
  document: { title: string; key: string; nextReviewOn?: string | null }
  url: string
}): EmailOut {
  const d = args.document
  const subject = `Document review due: ${d.title}`
  const text =
    `Document "${d.title}" (${d.key}) is due for review in ${args.tenant.name}.\n` +
    `${d.nextReviewOn ? `Review date: ${d.nextReviewOn}\n` : ''}` +
    `\nOpen it: ${args.url}`
  const html = shell({
    heading: 'Document review due',
    bodyHtml: `
      <p><strong>${esc(d.title)}</strong> <span style="color:#666">(${esc(d.key)})</span> is due for review${d.nextReviewOn ? ` on <strong>${esc(d.nextReviewOn)}</strong>` : ''}.</p>`,
    ctaLabel: 'Open in app',
    ctaUrl: args.url,
  })
  return { subject, html, text }
}

export function loneWorkerOverdueEmail(args: {
  tenant: { name: string }
  session: {
    task?: string | null
    startedAt: Date | string
    nextCheckinDueAt: Date | string
  }
  worker: { name: string }
  url: string
}): EmailOut {
  const startedAt =
    args.session.startedAt instanceof Date
      ? args.session.startedAt.toISOString()
      : args.session.startedAt
  const dueAt =
    args.session.nextCheckinDueAt instanceof Date
      ? args.session.nextCheckinDueAt.toISOString()
      : args.session.nextCheckinDueAt
  const subject = `CRITICAL: Lone worker overdue — ${args.worker.name}`
  const text =
    `LONE WORKER OVERDUE\n\n` +
    `Worker: ${args.worker.name}\n` +
    `${args.session.task ? `Task: ${args.session.task}\n` : ''}` +
    `Started: ${startedAt}\n` +
    `Check-in was due: ${dueAt}\n\n` +
    `Initiate welfare check immediately.\n\n` +
    `Open session: ${args.url}`
  const html = shell({
    heading: 'Lone worker overdue',
    bodyHtml: `
      <p style="background:#fef2f2;border:2px solid #dc2626;padding:16px;border-radius:6px;color:#7f1d1d">
        <strong style="font-size:16px">${esc(args.worker.name)}</strong> missed their check-in.
      </p>
      ${args.session.task ? `<p>Task: <strong>${esc(args.session.task)}</strong></p>` : ''}
      <p>Started: ${esc(startedAt)}<br>Check-in was due: <strong>${esc(dueAt)}</strong></p>
      <p>Initiate a welfare check immediately.</p>`,
    ctaLabel: 'Open session',
    ctaUrl: args.url,
    ctaColor: '#dc2626',
  })
  return { subject, html, text }
}

// Kept for backward compat with existing callers (cert expiry).
export function certExpiringEmail(args: {
  personName: string
  courseName: string
  expiresOn: string
  daysLeft: number
  url: string
}): EmailOut {
  return trainingExpiringEmail({
    tenant: { name: 'BeaconHS' },
    person: { name: args.personName },
    training: { courseName: args.courseName, expiresOn: args.expiresOn },
    daysToExpiry: args.daysLeft,
    url: args.url,
  })
}
