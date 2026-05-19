// Lift Plan PDF template.
//
// Mirrors the platform lift-plans schema (packages/db/src/schema/lift-plans.ts).
// Renders a single critical-lift plan as a formal letterhead-style PDF with:
//   - General context (project, site, lift date, operator, supervisor, rigger)
//   - Loads table (multi-piece manifest, total weight)
//   - Equipment table (crane/lifting devices with engineering numbers)
//   - Hazards & controls
//   - Required PPE list
//   - Signature block (supervisor, operator, rigger, signaler, spotter)
//   - Photos (capped at 12)

export type LiftPlanRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  liftPlan: {
    reference: string
    liftDate: string | Date
    description?: string | null
    status: string
    locked: boolean
    siteName?: string | null
    projectName?: string | null
    supervisorName?: string | null
    operatorName?: string | null
    riggerName?: string | null
    cancellationReason?: string | null
    completedAt?: string | Date | null
  }
  loads: {
    description: string
    weightKg?: string | null
    dimensionsMaxMm?: number | null
    attachmentMethod?: string | null
  }[]
  equipment: {
    name: string
    capacityKg?: string | null
    boomLengthM?: string | null
    radiusM?: string | null
    capacityUsedPct?: string | null
  }[]
  hazards: {
    hazardDescription: string
    controls?: string | null
  }[]
  ppe: {
    ppeName: string
    required: boolean
  }[]
  signatures: {
    role: string
    name: string
    signatureDataUrl?: string | null
    signedAt?: string | Date | null
  }[]
  photos: { url: string; caption?: string | null }[]
  generatedAt?: string | Date
}

export function renderLiftPlanHtml(input: LiftPlanRenderInput): string {
  const lp = input.liftPlan
  const primary = input.primaryColor ?? '#1f3a5f'
  const liftDate = fmtDate(lp.liftDate)
  const generated = fmtDateTime(input.generatedAt ?? new Date())

  const totalWeight = input.loads.reduce((acc, l) => acc + (l.weightKg ? Number(l.weightKg) : 0), 0)
  const totalWeightStr = totalWeight > 0 ? `${totalWeight.toFixed(2)} kg` : '—'

  const loadsHtml =
    input.loads.length === 0
      ? '<p class="muted">No loads defined.</p>'
      : `<table class="data-table">
          <thead><tr>
            <th style="width:32px;">#</th>
            <th>Description</th>
            <th>Weight (kg)</th>
            <th>Max dim (mm)</th>
            <th>Attachment method</th>
          </tr></thead>
          <tbody>
          ${input.loads
            .map(
              (l, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(l.description)}</td>
                <td>${esc(l.weightKg ?? '—')}</td>
                <td>${l.dimensionsMaxMm ?? '—'}</td>
                <td>${esc(l.attachmentMethod ?? '—')}</td>
              </tr>`,
            )
            .join('')}
          <tr class="totals"><td colspan="2"><strong>Total</strong></td><td colspan="3"><strong>${esc(totalWeightStr)}</strong></td></tr>
          </tbody>
        </table>`

  const equipmentHtml =
    input.equipment.length === 0
      ? '<p class="muted">No equipment defined.</p>'
      : `<table class="data-table">
          <thead><tr>
            <th style="width:32px;">#</th>
            <th>Equipment</th>
            <th>Capacity (kg)</th>
            <th>Boom (m)</th>
            <th>Radius (m)</th>
            <th>Used %</th>
          </tr></thead>
          <tbody>
          ${input.equipment
            .map(
              (e, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(e.name)}</td>
                <td>${esc(e.capacityKg ?? '—')}</td>
                <td>${esc(e.boomLengthM ?? '—')}</td>
                <td>${esc(e.radiusM ?? '—')}</td>
                <td>${e.capacityUsedPct ? `${esc(e.capacityUsedPct)}%` : '—'}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const hazardsHtml =
    input.hazards.length === 0
      ? '<p class="muted">No hazards recorded.</p>'
      : `<table class="data-table">
          <thead><tr><th style="width:32px;">#</th><th>Hazard</th><th>Controls</th></tr></thead>
          <tbody>
          ${input.hazards
            .map(
              (h, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(h.hazardDescription)}</td>
                <td class="wrap">${esc(h.controls ?? '—')}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const ppeHtml =
    input.ppe.length === 0
      ? '<p class="muted">No PPE listed.</p>'
      : `<ul class="ppe-list">
          ${input.ppe
            .map((p) => `<li>${esc(p.ppeName)}${p.required ? '' : ' <span class="muted">(optional)</span>'}</li>`)
            .join('')}
        </ul>`

  const signaturesHtml =
    input.signatures.length === 0
      ? '<p class="muted">No signatures recorded.</p>'
      : `<div class="sig-grid">
          ${input.signatures
            .map(
              (s) => `<div class="sig-box">
                <div class="sig-role">${esc(formatRole(s.role))}</div>
                <div class="sig-name">${esc(s.name)}</div>
                <div class="sig-line">${
                  s.signatureDataUrl ? `<img src="${esc(s.signatureDataUrl)}" alt="signature"/>` : '<em>Not signed</em>'
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
    .badge.completed { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    .badge.draft { background: #f3f3f3; color: #444; }
    .badge.cancelled { background: #fee; border-color: #c00; color: #800; }
    .badge.approved, .badge.in_progress { background: #fef3c7; border-color: #b58500; color: #5a4400; }
    h2 { font-size: 11.5pt; letter-spacing: 1px; text-transform: uppercase; color: var(--primary); border-bottom: 1px solid var(--primary); padding-bottom: 2px; margin: 18px 0 8px; }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    .data-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; }
    .data-table th, .data-table td { border: 1px solid #d0d0d0; padding: 5px 7px; text-align: left; vertical-align: top; }
    .data-table th { background: #f0f3f8; color: var(--primary); font-weight: 700; }
    .data-table td.wrap { white-space: pre-wrap; }
    .data-table tr.totals td { background: #fffbeb; border-top: 2px solid var(--primary); }
    .ppe-list { columns: 2; column-gap: 24px; margin: 4px 0; padding-left: 18px; font-size: 10pt; }
    .ppe-list li { margin-bottom: 2px; }
    .sig-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 6px 0; }
    .sig-box { border: 1px solid #ccc; padding: 8px; page-break-inside: avoid; }
    .sig-role { font-weight: 700; font-size: 9.5pt; color: var(--primary); letter-spacing: 0.5px; text-transform: uppercase; }
    .sig-name { font-size: 10pt; font-style: italic; }
    .sig-line { margin-top: 6px; min-height: 48px; border-bottom: 1.5px solid #333; padding-bottom: 2px; }
    .sig-line img { max-height: 44px; max-width: 100%; object-fit: contain; }
    .sig-line em { color: #b00; font-size: 9pt; }
    .sig-when { font-size: 8pt; color: #666; padding-top: 3px; }
    .muted { color: #888; font-style: italic; font-size: 9.5pt; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photo-grid figure { margin: 0; border: 1px solid #ddd; padding: 4px; }
    .photo-grid img { max-width: 100%; height: 130px; object-fit: cover; display: block; }
    .photo-grid figcaption { font-size: 8pt; padding-top: 3px; color: #555; }
    .page-break { page-break-before: always; }
    .narrative { background: #fafafa; border-left: 3px solid var(--primary); padding: 8px 10px; margin: 6px 0 10px; white-space: pre-wrap; }
  </style>
  <div class="letterhead">
    <div class="left">
      ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(input.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(generated)}<br/>
      Reference <strong>${esc(lp.reference)}</strong>
    </div>
  </div>

  <div class="title-block">
    <h1>Critical Lift Plan</h1>
    <div class="ref">Lift date ${esc(liftDate)}</div>
  </div>
  <div class="badge-row">
    <span class="badge ${esc(lp.status)}">${esc(lp.status.replace(/_/g, ' '))}</span>
    ${lp.locked ? '<span class="badge">LOCKED</span>' : ''}
    ${lp.completedAt ? `<span class="badge completed">Completed ${esc(fmtDate(lp.completedAt))}</span>` : ''}
  </div>

  <section>
    <h2>General</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Reference</td><td class="val">${esc(lp.reference)}</td>
        <td class="lbl">Lift date</td><td class="val">${esc(liftDate)}</td>
      </tr>
      <tr>
        <td class="lbl">Project</td><td class="val">${esc(lp.projectName ?? '—')}</td>
        <td class="lbl">Site</td><td class="val">${esc(lp.siteName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Supervisor</td><td class="val">${esc(lp.supervisorName ?? '—')}</td>
        <td class="lbl">Crane operator</td><td class="val">${esc(lp.operatorName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Rigger</td><td class="val">${esc(lp.riggerName ?? '—')}</td>
        <td class="lbl">Total load weight</td><td class="val">${esc(totalWeightStr)}</td>
      </tr>
    </table>
    ${lp.description ? `<div class="narrative">${esc(lp.description)}</div>` : ''}
    ${lp.cancellationReason ? `<p><strong>Cancellation reason:</strong> ${esc(lp.cancellationReason)}</p>` : ''}
  </section>

  <section>
    <h2>Loads (${input.loads.length})</h2>
    ${loadsHtml}
  </section>

  <section>
    <h2>Equipment (${input.equipment.length})</h2>
    ${equipmentHtml}
  </section>

  <section>
    <h2>Hazards &amp; Controls (${input.hazards.length})</h2>
    ${hazardsHtml}
  </section>

  <section>
    <h2>Required PPE</h2>
    ${ppeHtml}
  </section>

  <section>
    <h2>Sign-off</h2>
    ${signaturesHtml}
  </section>

  ${photosHtml}
  `
}

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, ' ')
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
