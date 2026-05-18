// Email delivery via Resend (or a local mailpit smtp in dev via nodemailer fallback).
// Tightly minimal — keep templates here too.

import { Resend } from 'resend'

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  text: string
  from?: string
  replyTo?: string
}

const apiKey = process.env.RESEND_API_KEY
const defaultFrom = process.env.RESEND_FROM ?? 'BeaconHS <noreply@beaconhs.app>'

let resend: Resend | null = null
function client(): Resend {
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  if (!resend) resend = new Resend(apiKey)
  return resend
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  if (!apiKey) {
    // Dev fallback: log to stdout so engineers can see what would have been sent.
    console.log('[emails] (no API key) →', input.to, input.subject)
    return { id: 'dev-skipped' }
  }
  const res = await client().emails.send({
    from: input.from ?? defaultFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo,
  })
  if ('error' in res && res.error) throw new Error(res.error.message)
  return { id: (res as { data: { id: string } }).data.id }
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

export function incidentReportedEmail(args: {
  reference: string
  title: string
  severity: string
  siteName?: string
  url: string
}): { subject: string; html: string; text: string } {
  const subject = `[${args.severity.toUpperCase()}] Incident reported: ${args.reference}`
  const text = `An incident has been reported.\n\nReference: ${args.reference}\nTitle: ${args.title}\nSeverity: ${args.severity}\nSite: ${args.siteName ?? '—'}\n\nReview it: ${args.url}`
  const html = `
    <h2>Incident reported</h2>
    <p><strong>${args.reference}</strong> · ${args.title}</p>
    <p>Severity: <strong>${args.severity}</strong>${args.siteName ? ` · Site: ${args.siteName}` : ''}</p>
    <p><a href="${args.url}" style="background:#dc2626;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review incident</a></p>`
  return { subject, html, text }
}

export function certExpiringEmail(args: {
  personName: string
  courseName: string
  expiresOn: string
  daysLeft: number
  url: string
}): { subject: string; html: string; text: string } {
  const subject = `${args.courseName} expires in ${args.daysLeft} days — ${args.personName}`
  const text = `${args.personName}'s ${args.courseName} certification expires on ${args.expiresOn} (${args.daysLeft} days). Renew at: ${args.url}`
  const html = `
    <h2>Certification expiring</h2>
    <p><strong>${args.personName}</strong>'s <strong>${args.courseName}</strong> expires on <strong>${args.expiresOn}</strong> (${args.daysLeft} days).</p>
    <p><a href="${args.url}">Open training record</a></p>`
  return { subject, html, text }
}
