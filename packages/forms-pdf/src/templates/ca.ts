// Corrective Action PDF template.
//
// Mirrors the platform corrective-actions schema
// (packages/db/src/schema/corrective-actions.ts). Renders a single CA as a
// formal letterhead-style PDF with:
//   - Header (reference, severity, status, ownership)
//   - Description / root cause / action taken (narrative blocks)
//   - Verification panel (when required)
//   - Photos (capped at 12)
//   - Complete-action timeline (ca_complete_steps with optional signatures)

export type CaRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  ca: {
    reference: string
    title: string
    description?: string | null
    rootCause?: string | null
    actionTaken?: string | null
    severity: string
    status: string
    source?: string | null
    sourceEntityType?: string | null
    siteName?: string | null
    ownerName?: string | null
    assignedByName?: string | null
    assignedOn?: string | Date | null
    dueOn?: string | Date | null
    closedAt?: string | Date | null
    costImpact?: string | null
    verificationRequired: boolean
    verificationNotes?: string | null
    verifierName?: string | null
    verifiedAt?: string | Date | null
  }
  photos: { url: string; caption?: string | null }[]
  completeSteps: {
    kind: string
    description?: string | null
    completedByName?: string | null
    completedAt: string | Date
    signatureDataUrl?: string | null
  }[]
  generatedAt?: string | Date
}

export function renderCaHtml(input: CaRenderInput): string {
  const c = input.ca
  const primary = input.primaryColor ?? '#1f3a5f'
  const generated = fmtDateTime(input.generatedAt ?? new Date())
  const closed = c.closedAt ? fmtDateTime(c.closedAt) : null
  const verified = c.verifiedAt ? fmtDateTime(c.verifiedAt) : null

  const photosHtml =
    input.photos.length === 0
      ? ''
      : `<section class="page-break">
          <h2>Photos (${input.photos.length})</h2>
          <div class="photo-grid">
          ${input.photos
            .slice(0, 12)
            .map(
              (p) => `<figure>
                <img src="${esc(p.url)}" alt=""/>
                ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
              </figure>`,
            )
            .join('')}
          </div>
        </section>`

  const stepsHtml =
    input.completeSteps.length === 0
      ? ''
      : `<section>
          <h2>Complete-action timeline (${input.completeSteps.length})</h2>
          ${input.completeSteps
            .map(
              (s) => `<div class="step">
                <div class="step-head">
                  <strong>${esc(formatStepKind(s.kind))}</strong>
                  <span class="step-when">${esc(fmtDateTime(s.completedAt))} · ${esc(s.completedByName ?? 'unknown')}</span>
                </div>
                ${s.description ? `<div class="step-desc">${esc(s.description)}</div>` : ''}
                ${s.signatureDataUrl ? `<div class="step-sig"><img src="${esc(s.signatureDataUrl)}" alt="signature"/></div>` : ''}
              </div>`,
            )
            .join('')}
        </section>`

  const verificationHtml = c.verificationRequired
    ? `<section>
        <h2>Verification</h2>
        ${
          verified
            ? `<div class="verification verified">
                <p><strong>Verified by ${esc(c.verifierName ?? 'unknown')}</strong> on ${esc(verified)}.</p>
                ${c.verificationNotes ? `<div class="narrative">${esc(c.verificationNotes)}</div>` : ''}
              </div>`
            : `<p class="muted">Verification required but not yet signed off.</p>`
        }
      </section>`
    : ''

  return `
  <style>
    :root { --primary: ${primary}; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; font-size: 10.5pt; line-height: 1.4; margin: 0; }
    .letterhead { border-top: 8px solid var(--primary); padding: 14px 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #ccc; margin-bottom: 14px; }
    .letterhead .left { display: flex; align-items: center; gap: 16px; }
    .letterhead img.logo { max-height: 56px; max-width: 200px; }
    .letterhead .tenant-name { font-size: 16pt; font-weight: 700; letter-spacing: 0.5px; color: var(--primary); }
    .letterhead .right { text-align: right; font-size: 9pt; color: #444; }
    .title-block { text-align: center; margin: 6px 0 12px; }
    .title-block h1 { font-size: 18pt; letter-spacing: 1.5px; margin: 0; color: #222; text-transform: uppercase; }
    .title-block .ref { font-size: 11pt; color: #555; margin-top: 4px; font-style: italic; }
    .badge-row { display: flex; gap: 8px; justify-content: center; margin: 10px 0 16px; }
    .badge { display: inline-block; border-radius: 12px; padding: 3px 10px; font-size: 9pt; font-weight: 600; border: 1px solid #999; background: #f3f3f3; letter-spacing: 0.3px; }
    .badge.sev-critical, .badge.sev-high { background: #fee; border-color: #c00; color: #800; }
    .badge.sev-medium { background: #fef3c7; border-color: #b58500; color: #5a4400; }
    .badge.sev-low { background: #e2e8f0; color: #334155; }
    .badge.status-closed { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    .badge.status-cancelled { background: #e2e8f0; color: #334155; }
    .badge.status-open, .badge.status-in_progress, .badge.status-pending_verification { background: #fef3c7; border-color: #b58500; color: #5a4400; }
    h2 { font-size: 11.5pt; letter-spacing: 1px; text-transform: uppercase; color: var(--primary); border-bottom: 1px solid var(--primary); padding-bottom: 2px; margin: 18px 0 8px; }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    .narrative { background: #fafafa; border-left: 3px solid var(--primary); padding: 8px 10px; margin: 6px 0 10px; white-space: pre-wrap; font-family: Georgia, serif; }
    .verification.verified { background: #ecfdf5; border-left: 3px solid #047857; padding: 8px 10px; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photo-grid figure { margin: 0; border: 1px solid #ddd; padding: 4px; }
    .photo-grid img { max-width: 100%; height: 130px; object-fit: cover; display: block; }
    .photo-grid figcaption { font-size: 8pt; padding-top: 3px; color: #555; }
    .step { border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; margin: 6px 0; page-break-inside: avoid; }
    .step-head { display: flex; justify-content: space-between; font-size: 10pt; color: #555; }
    .step-when { font-size: 9pt; }
    .step-desc { margin-top: 4px; font-size: 10pt; }
    .step-sig { margin-top: 6px; }
    .step-sig img { max-height: 56px; max-width: 100%; object-fit: contain; border: 1px solid #ddd; padding: 2px; }
    .muted { color: #888; font-style: italic; font-size: 9.5pt; }
    .page-break { page-break-before: always; }
  </style>
  <div class="letterhead">
    <div class="left">
      ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(input.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(generated)}<br/>
      Reference <strong>${esc(c.reference)}</strong>
    </div>
  </div>

  <div class="title-block">
    <h1>Corrective Action</h1>
    <div class="ref">${esc(c.title)}</div>
  </div>
  <div class="badge-row">
    <span class="badge sev-${esc(c.severity)}">${esc(c.severity)}</span>
    <span class="badge status-${esc(c.status)}">${esc(c.status.replace(/_/g, ' '))}</span>
    ${c.source ? `<span class="badge">${esc(c.source.replace(/_/g, ' '))}</span>` : ''}
  </div>

  <section>
    <h2>General</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Reference</td><td class="val">${esc(c.reference)}</td>
        <td class="lbl">Status</td><td class="val">${esc(c.status.replace(/_/g, ' '))}</td>
      </tr>
      <tr>
        <td class="lbl">Severity</td><td class="val">${esc(c.severity)}</td>
        <td class="lbl">Site</td><td class="val">${esc(c.siteName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Owner</td><td class="val">${esc(c.ownerName ?? '—')}</td>
        <td class="lbl">Assigned by</td><td class="val">${esc(c.assignedByName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Source</td><td class="val">${esc(c.source ?? '—')}${c.sourceEntityType ? ` (${esc(c.sourceEntityType)})` : ''}</td>
        <td class="lbl">Cost impact</td><td class="val">${esc(formatMoney(c.costImpact))}</td>
      </tr>
      <tr>
        <td class="lbl">Assigned on</td><td class="val">${c.assignedOn ? esc(fmtDate(c.assignedOn)) : '—'}</td>
        <td class="lbl">Due on</td><td class="val">${c.dueOn ? esc(fmtDate(c.dueOn)) : '—'}</td>
      </tr>
      <tr>
        <td class="lbl">Closed on</td><td class="val" colspan="3">${closed ? esc(closed) : '—'}</td>
      </tr>
    </table>
  </section>

  ${c.description ? `<section><h2>Description</h2><div class="narrative">${esc(c.description)}</div></section>` : ''}
  ${c.rootCause ? `<section><h2>Root cause</h2><div class="narrative">${esc(c.rootCause)}</div></section>` : ''}
  ${c.actionTaken ? `<section><h2>Action taken</h2><div class="narrative">${esc(c.actionTaken)}</div></section>` : ''}

  ${verificationHtml}
  ${stepsHtml}
  ${photosHtml}
  `
}

function formatStepKind(kind: string): string {
  return kind
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function formatMoney(n: string | null | undefined): string {
  if (n == null) return '—'
  const v = Number(n)
  if (Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function fmtDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 10)
}

function fmtDateTime(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return String(d)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
