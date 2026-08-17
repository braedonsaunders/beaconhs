import { htmlToText, sanitizeDocumentHtml } from '@beaconhs/forms-core'

type CorrectiveActionSummaryEmailInput = {
  reference: string
  title: string
  severity: string
  status: string
  owner: string | null
  location: string | null
  assignedOn: string | null
  dueOn: string | null
  message: string | null
  description: string | null
  rootCause: string | null
  actionTaken: string | null
  url: string
}

export function renderCorrectiveActionSummaryEmail(input: CorrectiveActionSummaryEmailInput): {
  html: string
  text: string
} {
  const descriptionHtml = richHtmlOrFallback(input.description, '(none)')
  const rootCauseHtml = richHtmlOrFallback(input.rootCause)
  const actionTakenHtml = richHtmlOrFallback(input.actionTaken)
  const descriptionText = htmlToText(input.description) || '(none)'
  const rootCauseText = htmlToText(input.rootCause)
  const actionTakenText = htmlToText(input.actionTaken)

  const text = [
    'CORRECTIVE ACTION',
    `${input.reference} · ${input.title}`,
    '',
    `Severity: ${input.severity}`,
    `Status: ${input.status.replace(/_/g, ' ')}`,
    `Owner: ${input.owner ?? '—'}`,
    `Location: ${input.location ?? '—'}`,
    `Assigned on: ${input.assignedOn ?? '—'}`,
    `Due on: ${input.dueOn ?? '—'}`,
    '',
    input.message ? `Note: ${input.message}\n` : '',
    'Description:',
    descriptionText,
    '',
    rootCauseText ? `Root cause:\n${rootCauseText}\n` : '',
    actionTakenText ? `Action taken:\n${actionTakenText}\n` : '',
    `View the record: ${input.url}`,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(input.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${escapeHtml(input.reference)} ·
        severity ${escapeHtml(input.severity)} ·
        status ${escapeHtml(input.status.replace(/_/g, ' '))}
      </div>
      ${
        input.message
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(input.message)}</div>`
          : ''
      }
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Owner</td>
            <td style="padding:4px 0;">${escapeHtml(input.owner ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Location</td>
            <td style="padding:4px 0;">${escapeHtml(input.location ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Assigned on</td>
            <td style="padding:4px 0;">${escapeHtml(input.assignedOn ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Due on</td>
            <td style="padding:4px 0;">${escapeHtml(input.dueOn ?? '—')}</td></tr>
      </table>
      <h3 style="margin:18px 0 4px;font-size:14px;">Description</h3>
      <div style="font-size:13px;">${descriptionHtml}</div>
      ${
        rootCauseHtml
          ? `<h3 style="margin:18px 0 4px;font-size:14px;">Root cause</h3>
             <div style="font-size:13px;">${rootCauseHtml}</div>`
          : ''
      }
      ${
        actionTakenHtml
          ? `<h3 style="margin:18px 0 4px;font-size:14px;">Action taken</h3>
             <div style="font-size:13px;">${actionTakenHtml}</div>`
          : ''
      }
      <p style="margin:18px 0 0;font-size:13px;">
        <a href="${escapeHtml(input.url)}" style="color:#0f766e;">Open the corrective action</a>
      </p>
    </div>
  `

  return { html, text }
}

function richHtmlOrFallback(value: string | null, fallback = ''): string {
  const clean = sanitizeDocumentHtml(value ?? '')
  return htmlToText(clean) ? clean : fallback
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
