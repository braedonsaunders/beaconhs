// HazID / JSHA assessment PDF template.
//
// Mirrors the platform hazid schema (packages/db/src/schema/hazid-assessments.ts).
// Renders a single full assessment in a formal letterhead-style layout
// suitable for compliance / regulator submission. Sections:
//   1. General + classification info
//   2. PPE manifest
//   3. Question & Answer
//   4. Tasks
//   5. Hazards & controls
//   6. Signatures + photos
//
// Specialty work plans (Working at Heights, Confined Space, Arc Flash) are no
// longer native sub-forms — they are Builder Apps (form templates) attached to
// the assessment type, and render through the forms PDF path.

import { sanitizeDocumentHtml } from '@beaconhs/forms-core'

export type HazidRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  assessment: {
    reference: string
    occurredAt: string | Date
    locked: boolean
    lockedAt?: string | Date | null
    siteName?: string | null
    locationOnSite?: string | null
    projectName?: string | null
    typeName?: string | null
    supervisorName?: string | null
    jobScope?: string | null
  }
  ppe: {
    name: string
    description?: string | null
    required: boolean
    answer?: string | null
  }[]
  questions: {
    question: string
    answer?: string | null
    requiresYes: boolean
  }[]
  tasks: {
    name: string
    controls?: string | null
  }[]
  hazards: {
    name: string
    standardControls?: string | null
    specificControls?: string | null
    applicable: boolean
  }[]
  signatures: {
    name: string
    signatureType: string
    csEntrant: boolean
    csAttendant: boolean
    csRescue: boolean
    signatureDataUrl?: string | null
    signedAt?: string | Date | null
  }[]
  photos: { url: string; caption?: string | null }[]
  generatedAt?: string | Date
}

export function renderHazidHtml(input: HazidRenderInput): string {
  const a = input.assessment
  const primary = input.primaryColor ?? '#1f3a5f'
  const occurred = fmtDateTime(a.occurredAt)
  const generated = fmtDateTime(input.generatedAt ?? new Date())

  const ppeRows =
    input.ppe.length === 0
      ? '<p class="muted">No PPE recorded.</p>'
      : `<table class="data-table">
          <thead><tr><th>Name</th><th>Description</th><th>Required</th><th>Answer</th></tr></thead>
          <tbody>
          ${input.ppe
            .map(
              (p) => `<tr>
                <td>${esc(p.name)}</td>
                <td>${esc(p.description ?? '—')}</td>
                <td>${p.required ? 'Yes' : 'No'}</td>
                <td>${esc((p.answer ?? '—').toUpperCase())}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const questionsHtml =
    input.questions.length === 0
      ? '<p class="muted">No questions recorded.</p>'
      : `<ol class="qlist">
          ${input.questions
            .map(
              (q) => `<li>
                <div class="q">${esc(q.question)}${q.requiresYes ? ' <span class="req">requires "yes"</span>' : ''}</div>
                <div class="a">Answer: <strong>${esc(q.answer ?? '—')}</strong></div>
              </li>`,
            )
            .join('')}
        </ol>`

  const tasksHtml =
    input.tasks.length === 0
      ? '<p class="muted">No tasks recorded.</p>'
      : `<table class="data-table">
          <thead><tr><th style="width:32px;">#</th><th>Task</th><th>Controls</th></tr></thead>
          <tbody>
          ${input.tasks
            .map(
              (t, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(t.name)}</td>
                <td class="wrap">${esc(t.controls ?? '—')}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const hazardsHtml =
    input.hazards.length === 0
      ? '<p class="muted">No hazards recorded.</p>'
      : `<table class="data-table">
          <thead><tr><th style="width:32px;">#</th><th>Hazard</th><th>Standard controls</th><th>Specific controls</th><th>Applicable</th></tr></thead>
          <tbody>
          ${input.hazards
            .map(
              (h, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(h.name)}</td>
                <td class="wrap">${esc(h.standardControls ?? '—')}</td>
                <td class="wrap">${esc(h.specificControls ?? '—')}</td>
                <td>${h.applicable ? 'Yes' : 'No'}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const signaturesHtml =
    input.signatures.length === 0
      ? '<p class="muted">No signatures recorded.</p>'
      : `<div class="sig-grid">
          ${input.signatures
            .map(
              (s) => `<div class="sig-box">
                <div class="sig-name">${esc(s.name)}</div>
                <div class="sig-meta">${esc(s.signatureType.toUpperCase())}${
                  s.csEntrant ? ' · Entrant' : ''
                }${s.csAttendant ? ' · Attendant' : ''}${s.csRescue ? ' · Rescue' : ''}</div>
                <div class="sig-line">${
                  s.signatureDataUrl
                    ? `<img src="${esc(s.signatureDataUrl)}" alt="signature"/>`
                    : '<em>Not signed</em>'
                }</div>
                <div class="sig-when">${s.signedAt ? esc(fmtDateTime(s.signedAt)) : ''}</div>
              </div>`,
            )
            .join('')}
        </div>`

  const photosHtml =
    input.photos.length === 0
      ? ''
      : `<section class="page-break">
          <h2>Photos</h2>
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
    .badge.locked { background: #fee; border-color: #c00; color: #800; }
    .badge.in-progress { background: #fffbe6; border-color: #b58500; color: #5a4400; }
    h2 { font-size: 11.5pt; letter-spacing: 1px; text-transform: uppercase; color: var(--primary); border-bottom: 1px solid var(--primary); padding-bottom: 2px; margin: 18px 0 8px; }
    h3.sub { font-size: 10.5pt; color: #444; margin: 12px 0 6px; }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    /* Rich-text (job scope): keep narrative formatting tight in the table cell. */
    .info-table td.rich :first-child { margin-top: 0; }
    .info-table td.rich :last-child { margin-bottom: 0; }
    .info-table td.rich p { margin: 0 0 4px; }
    .info-table td.rich ul, .info-table td.rich ol { margin: 0 0 4px; padding-left: 18px; }
    .data-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; }
    .data-table th, .data-table td { border: 1px solid #d0d0d0; padding: 5px 7px; text-align: left; vertical-align: top; }
    .data-table th { background: #f0f3f8; color: var(--primary); font-weight: 700; }
    .data-table td.wrap { white-space: pre-wrap; }
    .qlist { margin: 6px 0 8px; padding-left: 22px; }
    .qlist li { margin-bottom: 8px; page-break-inside: avoid; }
    .qlist .q { font-weight: 600; }
    .qlist .req { font-weight: 400; color: #b80; font-size: 8.5pt; font-style: italic; }
    .qlist .a { margin-top: 2px; color: #444; font-size: 10pt; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photo-grid figure { margin: 0; border: 1px solid #ddd; padding: 4px; background: #fff; }
    .photo-grid img { max-width: 100%; height: 130px; object-fit: cover; display: block; }
    .photo-grid figcaption { font-size: 8pt; padding-top: 3px; color: #555; }
    .sig-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 6px 0; }
    .sig-box { border: 1px solid #ccc; padding: 8px; page-break-inside: avoid; }
    .sig-name { font-weight: 700; font-size: 10pt; }
    .sig-meta { font-size: 8.5pt; color: #666; letter-spacing: 0.4px; }
    .sig-line { margin-top: 6px; min-height: 48px; border-bottom: 1.5px solid #333; padding-bottom: 2px; }
    .sig-line img { max-height: 44px; max-width: 100%; object-fit: contain; }
    .sig-line em { color: #b00; font-size: 9pt; }
    .sig-when { font-size: 8pt; color: #666; padding-top: 3px; font-style: italic; }
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
      Reference <strong>${esc(a.reference)}</strong>
    </div>
  </div>

  <div class="title-block">
    <h1>Hazard Assessment</h1>
    <div class="ref">${esc(a.typeName ?? 'Job Safety Hazard Analysis')}</div>
  </div>
  <div class="badge-row">
    <span class="badge ${a.locked ? 'locked' : 'in-progress'}">${a.locked ? 'LOCKED' : 'IN PROGRESS'}</span>
  </div>

  <section>
    <h2>General Information</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Occurred</td><td class="val">${esc(occurred)}</td>
        <td class="lbl">Type</td><td class="val">${esc(a.typeName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Site</td><td class="val">${esc(a.siteName ?? '—')}</td>
        <td class="lbl">Location on site</td><td class="val">${esc(a.locationOnSite ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Project</td><td class="val">${esc(a.projectName ?? '—')}</td>
        <td class="lbl">Supervisor</td><td class="val">${esc(a.supervisorName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Job scope</td><td class="val rich" colspan="3">${a.jobScope ? sanitizeDocumentHtml(a.jobScope) : '—'}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>PPE Manifest</h2>
    ${ppeRows}
  </section>

  <section>
    <h2>Questions &amp; Answers</h2>
    ${questionsHtml}
  </section>

  <section>
    <h2>Tasks</h2>
    ${tasksHtml}
  </section>

  <section>
    <h2>Hazards &amp; Controls</h2>
    ${hazardsHtml}
  </section>

  <section>
    <h2>Signatures</h2>
    ${signaturesHtml}
  </section>

  ${photosHtml}
  `
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
