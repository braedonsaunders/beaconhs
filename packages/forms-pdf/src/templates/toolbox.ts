// Toolbox Talk / Daily Journal PDF template.
//
// Mirrors the platform toolbox-journals schema
// (packages/db/src/schema/toolbox-journals.ts). Renders a single journal as
// a formal letterhead-style PDF with:
//   - General (site, foreman, topic, occurred date, status)
//   - Discussion notes / questions raised / action items
//   - Attendee sign-in table (one row per person with signature image)
//   - Photos (capped at 12)

export type ToolboxRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  journal: {
    reference: string
    title: string
    topic?: string | null
    occurredOn: string | Date
    status: string
    locked: boolean
    siteName?: string | null
    foremanName?: string | null
    discussionNotes?: string | null
    questionsRaised?: string | null
    actionItems?: string | null
  }
  attendees: {
    name: string
    jobTitle?: string | null
    signatureDataUrl?: string | null
    signedAt?: string | Date | null
  }[]
  photos: { url: string; caption?: string | null }[]
  generatedAt?: string | Date
}

export function renderToolboxHtml(input: ToolboxRenderInput): string {
  const j = input.journal
  const primary = input.primaryColor ?? '#1f3a5f'
  const occurred = fmtDate(j.occurredOn)
  const generated = fmtDateTime(input.generatedAt ?? new Date())

  const attendeesHtml =
    input.attendees.length === 0
      ? '<p class="muted">No attendees recorded.</p>'
      : `<table class="sign-table">
          <thead><tr>
            <th style="width:32px;">#</th>
            <th>Name</th>
            <th>Job title</th>
            <th style="width:240px;">Signature</th>
            <th style="width:90px;">Signed on</th>
          </tr></thead>
          <tbody>
          ${input.attendees
            .map(
              (a, i) => `<tr>
                <td>${i + 1}</td>
                <td>${esc(a.name)}</td>
                <td>${esc(a.jobTitle ?? '')}</td>
                <td class="sig-cell">${
                  a.signatureDataUrl ? `<img src="${esc(a.signatureDataUrl)}" alt="signature"/>` : ''
                }</td>
                <td>${a.signedAt ? esc(fmtDate(a.signedAt)) : ''}</td>
              </tr>`,
            )
            .join('')}
          </tbody>
        </table>`

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
    .badge.closed { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    .badge.submitted { background: #fef3c7; border-color: #b58500; color: #5a4400; }
    .badge.draft { background: #f3f3f3; }
    h2 { font-size: 11.5pt; letter-spacing: 1px; text-transform: uppercase; color: var(--primary); border-bottom: 1px solid var(--primary); padding-bottom: 2px; margin: 18px 0 8px; }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    .narrative { background: #fafafa; border-left: 3px solid var(--primary); padding: 8px 10px; margin: 6px 0 10px; white-space: pre-wrap; font-family: Georgia, serif; }
    .sign-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9.5pt; }
    .sign-table th, .sign-table td { border: 1px solid #d0d0d0; padding: 5px 7px; text-align: left; vertical-align: middle; }
    .sign-table th { background: #f0f3f8; color: var(--primary); font-weight: 700; }
    .sign-table td.sig-cell { min-height: 36px; height: 38px; }
    .sign-table td.sig-cell img { max-height: 32px; max-width: 100%; object-fit: contain; }
    .muted { color: #888; font-style: italic; font-size: 9.5pt; }
    .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photo-grid figure { margin: 0; border: 1px solid #ddd; padding: 4px; }
    .photo-grid img { max-width: 100%; height: 130px; object-fit: cover; display: block; }
    .photo-grid figcaption { font-size: 8pt; padding-top: 3px; color: #555; }
    .page-break { page-break-before: always; }
  </style>
  <div class="letterhead">
    <div class="left">
      ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(input.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(generated)}<br/>
      Reference <strong>${esc(j.reference)}</strong>
    </div>
  </div>

  <div class="title-block">
    <h1>Toolbox Talk</h1>
    <div class="ref">${esc(j.title)}</div>
  </div>
  <div class="badge-row">
    <span class="badge ${esc(j.status)}">${esc(j.status)}</span>
    ${j.locked ? '<span class="badge">LOCKED</span>' : ''}
  </div>

  <section>
    <h2>General</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Reference</td><td class="val">${esc(j.reference)}</td>
        <td class="lbl">Date</td><td class="val">${esc(occurred)}</td>
      </tr>
      <tr>
        <td class="lbl">Site</td><td class="val">${esc(j.siteName ?? '—')}</td>
        <td class="lbl">Foreman</td><td class="val">${esc(j.foremanName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Topic</td><td class="val">${esc(j.topic ?? '—')}</td>
        <td class="lbl">Attendees</td><td class="val">${input.attendees.length}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>Discussion notes</h2>
    <div class="narrative">${esc(j.discussionNotes ?? '—')}</div>
  </section>

  <section>
    <h2>Questions raised</h2>
    <div class="narrative">${esc(j.questionsRaised ?? '—')}</div>
  </section>

  <section>
    <h2>Action items</h2>
    <div class="narrative">${esc(j.actionItems ?? '—')}</div>
  </section>

  <section>
    <h2>Attendees &amp; sign-off (${input.attendees.length})</h2>
    ${attendeesHtml}
  </section>

  ${photosHtml}
  `
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
