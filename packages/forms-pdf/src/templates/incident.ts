// Incident report PDF template.
//
// Renders a single full incident detail page in a formal, letterhead-style
// layout suitable for compliance / WSIB / MOL submission. The renderer in
// ../index.ts wraps this HTML in <html><head>... and prints it via Chromium.
//
// The shape mirrors the platform incidents schema (packages/db/src/schema/incidents.ts)
// — extend the IncidentInjury / IncidentLostTimeEvent shapes if you add columns.

export type IncidentRenderInput = {
  tenantName: string
  tenantLogoUrl?: string
  primaryColor?: string
  incident: {
    reference: string
    title: string
    description?: string | null
    type: string
    severity: string
    status: string
    occurredAt: string | Date
    reportedAt: string | Date
    closedAt?: string | Date | null
    siteName?: string | null
    location?: string | null
    departmentName?: string | null
    weather?: string | null
    classification?: Record<string, string>
    supervisorName?: string | null
    foremanText?: string | null
    externalPeopleInvolved?: string | null
    witnesses?: string | null
    eventsLeadingUp?: string | null
    immediateActionTaken?: string | null
    ppeWorn?: string | null
    // Medical flags
    criticalInjury: boolean
    ministryOfLabourNotified: boolean
    emsNotified: boolean
    firstAidReceived: boolean
    firstAidProvider?: string | null
    medicalAttentionReceived: boolean
    treatedAtHospital?: string | null
    treatedInCity?: string | null
    transportation?: string | null
    lostTime: boolean
    lostTimeFirstDay?: string | null
    lostTimeLastDay?: string | null
    lostTimeDays?: number | null
    modifiedDuty: boolean
    modifiedDutyFirstDay?: string | null
    modifiedDutyLastDay?: string | null
    modifiedDutyDays?: number | null
    externallyReportable: boolean
    // Severity ratings
    actualSeverity?: number | null
    potentialSeverity?: number | null
    // Investigation
    rootCause?: string | null
    contributingFactors?: string[]
  }
  involved?: { name: string; role?: string | null }[]
  injuries?: {
    personName: string
    bodyParts: string[]
    injuryTypes: string[]
    treatment?: string | null
    treatedAtFacility?: string | null
    workedHoursPriorTo?: number | null
  }[]
  lostTimeEvents?: {
    status: string
    validFrom: string
    validTo?: string | null
    notes?: string | null
  }[]
  photos?: { url: string; caption?: string | null }[]
  signature?: {
    signedByName?: string | null
    signedAt?: string | Date | null
    pngDataUrl?: string | null
  }
  generatedAt?: string | Date
}

export function renderIncidentHtml(input: IncidentRenderInput): string {
  const i = input.incident
  const primary = input.primaryColor ?? '#1f3a5f'
  const occurred = fmtDateTime(i.occurredAt)
  const reported = fmtDateTime(i.reportedAt)
  const generated = fmtDateTime(input.generatedAt ?? new Date())

  const classification = i.classification
    ? Object.entries(i.classification)
        .filter(([, v]) => v)
        .map(([k, v]) => `<span class="chip">${esc(k)}: <strong>${esc(v)}</strong></span>`)
        .join(' ')
    : ''

  const involvedHtml =
    (input.involved ?? []).length === 0
      ? '<em class="muted">None listed</em>'
      : `<ul class="people-list">${input
          .involved!.map(
            (p) =>
              `<li><strong>${esc(p.name)}</strong>${p.role ? ` <span class="muted">(${esc(p.role)})</span>` : ''}</li>`,
          )
          .join('')}</ul>`

  const injuriesHtml =
    (input.injuries ?? []).length === 0
      ? '<p class="muted">No injuries recorded.</p>'
      : `<table class="data-table">
          <thead><tr>
            <th>Person</th><th>Body part(s)</th><th>Injury type(s)</th>
            <th>Treatment</th><th>Facility</th><th>Hours&nbsp;prior</th>
          </tr></thead>
          <tbody>
          ${input
            .injuries!.map(
              (inj) => `<tr>
                <td>${esc(inj.personName)}</td>
                <td>${esc(inj.bodyParts.join(', ') || '—')}</td>
                <td>${esc(inj.injuryTypes.join(', ') || '—')}</td>
                <td>${esc(inj.treatment ?? '—')}</td>
                <td>${esc(inj.treatedAtFacility ?? '—')}</td>
                <td>${inj.workedHoursPriorTo ?? '—'}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const lostTimeHtml =
    (input.lostTimeEvents ?? []).length === 0
      ? '<p class="muted">No lost-time transitions recorded.</p>'
      : `<table class="data-table">
          <thead><tr><th>Status</th><th>From</th><th>To</th><th>Notes</th></tr></thead>
          <tbody>
          ${input
            .lostTimeEvents!.map(
              (e) =>
                `<tr><td>${esc(e.status.replace(/_/g, ' '))}</td><td>${esc(e.validFrom)}</td><td>${esc(e.validTo ?? '—')}</td><td>${esc(e.notes ?? '')}</td></tr>`,
            )
            .join('')}
          </tbody>
        </table>`

  const factorsHtml =
    !i.contributingFactors || i.contributingFactors.length === 0
      ? '<em class="muted">None</em>'
      : `<ul>${i.contributingFactors.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`

  // Photos are embedded as <img> tags with publicUrl source. Chromium will
  // fetch them at render time (networkidle0). Up to ~12 thumbs.
  const photosHtml =
    (input.photos ?? []).length === 0
      ? ''
      : `<section class="page-break">
          <h2>Photos &amp; Files</h2>
          <div class="photo-grid">
          ${input
            .photos!.slice(0, 12)
            .map(
              (p) => `<figure>
                <img src="${esc(p.url)}" alt="" />
                ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
              </figure>`,
            )
            .join('')}
          </div>
        </section>`

  const sigPng = input.signature?.pngDataUrl
  const sigBlock = `
    <section class="signature-block">
      <h2>Sign-off</h2>
      <div class="sig-row">
        <div class="sig-cell">
          <div class="sig-line">
            ${sigPng ? `<img src="${esc(sigPng)}" alt="signature"/>` : ''}
          </div>
          <div class="sig-label">Signature</div>
        </div>
        <div class="sig-cell">
          <div class="sig-text">${esc(input.signature?.signedByName ?? '')}</div>
          <div class="sig-label">Investigator / Supervisor</div>
        </div>
        <div class="sig-cell">
          <div class="sig-text">${esc(input.signature?.signedAt ? fmtDateTime(input.signature.signedAt) : '')}</div>
          <div class="sig-label">Date signed</div>
        </div>
      </div>
    </section>`

  return `
  <style>
    :root { --primary: ${primary}; }
    * { box-sizing: border-box; }
    body {
      font-family: Georgia, "Times New Roman", Cambria, serif;
      color: #1a1a1a;
      font-size: 10.5pt;
      line-height: 1.4;
      margin: 0;
    }
    .letterhead {
      border-top: 8px solid var(--primary);
      padding: 14px 0 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #ccc;
      margin-bottom: 14px;
    }
    .letterhead .left { display: flex; align-items: center; gap: 16px; }
    .letterhead img.logo { max-height: 56px; max-width: 200px; }
    .letterhead .tenant-name { font-size: 16pt; font-weight: 700; letter-spacing: 0.5px; color: var(--primary); }
    .letterhead .right { text-align: right; font-size: 9pt; color: #444; }
    .title-block { text-align: center; margin: 6px 0 12px; }
    .title-block h1 { font-size: 18pt; letter-spacing: 1.5px; margin: 0; color: #222; text-transform: uppercase; }
    .title-block .ref { font-size: 11pt; color: #555; margin-top: 4px; font-style: italic; }
    .badge-row { display: flex; gap: 8px; justify-content: center; margin: 10px 0 16px; }
    .badge {
      display: inline-block;
      border-radius: 12px;
      padding: 3px 10px;
      font-size: 9pt;
      font-weight: 600;
      border: 1px solid #999;
      background: #f3f3f3;
      letter-spacing: 0.3px;
    }
    .badge.severity-fatality, .badge.severity-lost_time { background: #fee; border-color: #c00; color: #800; }
    .badge.severity-medical_aid { background: #fff3e0; border-color: #c87800; color: #6a3d00; }
    .badge.severity-first_aid_only { background: #fffbe6; border-color: #b58500; color: #5a4400; }
    .badge.severity-no_injury { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    .badge.status-closed { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    h2 {
      font-size: 11.5pt;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--primary);
      border-bottom: 1px solid var(--primary);
      padding-bottom: 2px;
      margin: 18px 0 8px;
    }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    .narrative {
      background: #fafafa;
      border-left: 3px solid var(--primary);
      padding: 8px 10px;
      margin: 6px 0 10px;
      white-space: pre-wrap;
      font-family: Georgia, "Times New Roman", serif;
    }
    .check-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px 12px;
      margin: 6px 0 8px;
    }
    .check-grid .item { font-size: 10pt; }
    .check-grid .box { display: inline-block; width: 10pt; height: 10pt; border: 1.5px solid #444; margin-right: 6px; vertical-align: -1.5px; text-align: center; line-height: 9pt; font-weight: 700; }
    .check-grid .box.on { background: var(--primary); color: white; border-color: var(--primary); }
    .conditional {
      background: #fffbeb;
      border: 1px solid #f5e1a4;
      border-radius: 4px;
      padding: 8px 10px;
      margin: 6px 0 10px;
    }
    .conditional .field-line { display: flex; gap: 6px; font-size: 10pt; padding: 2px 0; }
    .conditional .field-line .lbl { font-weight: 600; color: #6a4d00; min-width: 130px; }
    .severity-scale { display: flex; gap: 16px; margin: 6px 0 4px; }
    .severity-scale .group { flex: 1; }
    .severity-scale .group-label { font-size: 10pt; font-weight: 600; margin-bottom: 4px; color: #444; }
    .severity-scale .dots { display: flex; gap: 4px; align-items: center; }
    .severity-scale .dot {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1.5px solid #888;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9pt;
      font-weight: 700;
      color: #555;
      background: #fff;
    }
    .severity-scale .dot.on { background: var(--primary); color: white; border-color: var(--primary); }
    .data-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; }
    .data-table th, .data-table td { border: 1px solid #d0d0d0; padding: 5px 7px; text-align: left; vertical-align: top; }
    .data-table th { background: #f0f3f8; color: var(--primary); font-weight: 700; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photo-grid figure { margin: 0; border: 1px solid #ddd; padding: 4px; background: #fff; }
    .photo-grid img { max-width: 100%; height: 130px; object-fit: cover; display: block; }
    .photo-grid figcaption { font-size: 8pt; padding-top: 3px; color: #555; }
    .people-list { margin: 4px 0; padding-left: 18px; }
    .chip { display: inline-block; border: 1px solid #c0c0c0; border-radius: 10px; padding: 1px 8px; margin: 1px 3px 1px 0; font-size: 9pt; background: #f8f8f8; }
    .muted { color: #888; }
    .signature-block { margin-top: 22px; page-break-inside: avoid; }
    .sig-row { display: flex; gap: 24px; align-items: flex-end; }
    .sig-cell { flex: 1; }
    .sig-line { border-bottom: 1.5px solid #333; min-height: 42px; padding-bottom: 2px; position: relative; }
    .sig-line img { max-height: 40px; max-width: 100%; object-fit: contain; }
    .sig-text { border-bottom: 1px solid #999; min-height: 24px; padding-bottom: 2px; font-style: italic; }
    .sig-label { font-size: 8.5pt; color: #555; padding-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
    .page-break { page-break-before: always; }
  </style>
  <div class="letterhead">
    <div class="left">
      ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(input.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(generated)}<br/>
      Reference <strong>${esc(i.reference)}</strong>
    </div>
  </div>

  <div class="title-block">
    <h1>Incident Report</h1>
    <div class="ref">${esc(i.title)}</div>
  </div>
  <div class="badge-row">
    <span class="badge severity-${esc(i.severity)}">${esc(i.severity.replace(/_/g, ' '))}</span>
    <span class="badge status-${esc(i.status)}">${esc(i.status.replace(/_/g, ' '))}</span>
    <span class="badge">${esc(i.type.replace(/_/g, ' '))}</span>
  </div>

  <section>
    <h2>General Information</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Occurred</td><td class="val">${esc(occurred)}</td>
        <td class="lbl">Reported</td><td class="val">${esc(reported)}</td>
      </tr>
      <tr>
        <td class="lbl">Site</td><td class="val">${esc(i.siteName ?? '—')}</td>
        <td class="lbl">Location on site</td><td class="val">${esc(i.location ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Department</td><td class="val">${esc(i.departmentName ?? '—')}</td>
        <td class="lbl">Weather</td><td class="val">${esc(i.weather ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Supervisor</td><td class="val">${esc(i.supervisorName ?? '—')}</td>
        <td class="lbl">Foreman</td><td class="val">${esc(i.foremanText ?? '—')}</td>
      </tr>
    </table>
    ${classification ? `<div style="margin: 6px 0;">${classification}</div>` : ''}

    <h2>People &amp; Witnesses</h2>
    <p><strong>People involved</strong></p>
    ${involvedHtml}
    ${i.externalPeopleInvolved ? `<p><strong>External people involved:</strong> ${esc(i.externalPeopleInvolved)}</p>` : ''}
    ${i.witnesses ? `<p><strong>Witnesses:</strong> ${esc(i.witnesses)}</p>` : ''}

    <h2>Events &amp; Response</h2>
    ${i.eventsLeadingUp ? `<p><strong>Events leading up to the incident</strong></p><div class="narrative">${esc(i.eventsLeadingUp)}</div>` : ''}
    ${i.description ? `<p><strong>Event details / cause</strong></p><div class="narrative">${esc(i.description)}</div>` : ''}
    ${i.immediateActionTaken ? `<p><strong>Immediate action taken</strong></p><div class="narrative">${esc(i.immediateActionTaken)}</div>` : ''}
    ${i.ppeWorn ? `<p><strong>PPE worn</strong></p><div class="narrative">${esc(i.ppeWorn)}</div>` : ''}
  </section>

  <section>
    <h2>Medical</h2>
    <div class="check-grid">
      ${checkItem('Critical injury', i.criticalInjury)}
      ${checkItem('Ministry of Labour notified', i.ministryOfLabourNotified)}
      ${checkItem('EMS notified', i.emsNotified)}
      ${checkItem('First aid received', i.firstAidReceived)}
      ${checkItem('Medical attention received', i.medicalAttentionReceived)}
      ${checkItem('Lost time', i.lostTime)}
      ${checkItem('Modified duty', i.modifiedDuty)}
      ${checkItem('Externally reportable', i.externallyReportable)}
    </div>

    ${
      i.firstAidReceived || i.medicalAttentionReceived
        ? `<div class="conditional">
            ${i.firstAidReceived ? `<div class="field-line"><span class="lbl">First aid provider</span><span>${esc(i.firstAidProvider ?? '—')}</span></div>` : ''}
            ${
              i.medicalAttentionReceived
                ? `
              <div class="field-line"><span class="lbl">Treated at</span><span>${esc(i.treatedAtHospital ?? '—')}</span></div>
              <div class="field-line"><span class="lbl">City</span><span>${esc(i.treatedInCity ?? '—')}</span></div>
              <div class="field-line"><span class="lbl">Transportation</span><span>${esc(i.transportation ?? '—')}</span></div>
            `
                : ''
            }
          </div>`
        : ''
    }

    ${
      i.lostTime || i.modifiedDuty
        ? `<div class="conditional">
            ${
              i.lostTime
                ? `
              <div class="field-line"><span class="lbl">Lost time first day</span><span>${esc(i.lostTimeFirstDay ?? '—')}</span></div>
              <div class="field-line"><span class="lbl">Lost time last day</span><span>${esc(i.lostTimeLastDay ?? 'still ongoing')}</span></div>
              <div class="field-line"><span class="lbl">Total lost-time days</span><span>${i.lostTimeDays ?? '—'}</span></div>
            `
                : ''
            }
            ${
              i.modifiedDuty
                ? `
              <div class="field-line"><span class="lbl">Modified duty first day</span><span>${esc(i.modifiedDutyFirstDay ?? '—')}</span></div>
              <div class="field-line"><span class="lbl">Modified duty last day</span><span>${esc(i.modifiedDutyLastDay ?? 'still ongoing')}</span></div>
              <div class="field-line"><span class="lbl">Total modified-duty days</span><span>${i.modifiedDutyDays ?? '—'}</span></div>
            `
                : ''
            }
          </div>`
        : ''
    }
  </section>

  <section>
    <h2>Key Metrics — Severity (1–5)</h2>
    <div class="severity-scale">
      ${ratingGroup('Actual severity', i.actualSeverity)}
      ${ratingGroup('Potential severity', i.potentialSeverity)}
    </div>
  </section>

  <section>
    <h2>Injuries (${input.injuries?.length ?? 0})</h2>
    ${injuriesHtml}
  </section>

  <section>
    <h2>Lost time events (${input.lostTimeEvents?.length ?? 0})</h2>
    ${lostTimeHtml}
  </section>

  <section>
    <h2>Investigation</h2>
    ${i.rootCause ? `<p><strong>Root cause</strong></p><div class="narrative">${esc(i.rootCause)}</div>` : '<p><strong>Root cause:</strong> <em class="muted">Not yet determined</em></p>'}
    <p><strong>Contributing factors</strong></p>
    ${factorsHtml}
  </section>

  ${photosHtml}

  ${sigBlock}
  `
}

function checkItem(label: string, on: boolean): string {
  return `<div class="item"><span class="box${on ? ' on' : ''}">${on ? '✓' : ''}</span>${esc(label)}</div>`
}

function ratingGroup(label: string, value: number | null | undefined): string {
  const v = typeof value === 'number' ? value : 0
  return `<div class="group">
    <div class="group-label">${esc(label)}${value == null ? ' <span class="muted">(not rated)</span>' : ''}</div>
    <div class="dots">
      ${[1, 2, 3, 4, 5].map((n) => `<span class="dot${n <= v ? ' on' : ''}">${n}</span>`).join('')}
    </div>
  </div>`
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
