// Email delivery. The provider abstraction (Resend, SendGrid, Mailgun, Postmark,
// SMTP) lives in ./providers + ./transport. Delivery always uses an explicitly
// resolved tenant or platform transport; this package has no implicit provider.

export * from './providers'
export * from './transport'
export * from '@beaconhs/email-render/delivery-input'

// --- Templates -----------------------------------------------------------

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
