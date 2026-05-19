// PPE Issue Report PDF template.
//
// Mirrors the platform PPE schema (packages/db/src/schema/ppe.ts).
// Renders a single ppe_issue_report row as a formal letterhead-style PDF
// including the linked PPE item summary, reporter, status, and resolution.

export type PpeIssueRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  issueReport: {
    description: string
    status: string
    resolution?: string | null
    reportedAt: string | Date
    resolvedAt?: string | Date | null
    reportedByName?: string | null
  }
  item: {
    serialNumber?: string | null
    size?: string | null
    status: string
    typeName?: string | null
    category?: string | null
    currentHolderName?: string | null
    purchaseDate?: string | Date | null
    expiresOn?: string | Date | null
  }
  generatedAt?: string | Date
}

export function renderPpeIssueHtml(input: PpeIssueRenderInput): string {
  const r = input.issueReport
  const item = input.item
  const primary = input.primaryColor ?? '#1f3a5f'
  const generated = fmtDateTime(input.generatedAt ?? new Date())
  const reported = fmtDateTime(r.reportedAt)
  const resolved = r.resolvedAt ? fmtDateTime(r.resolvedAt) : null

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
    .badge.status-resolved, .badge.status-replaced { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    .badge.status-open { background: #fee; border-color: #c00; color: #800; }
    h2 { font-size: 11.5pt; letter-spacing: 1px; text-transform: uppercase; color: var(--primary); border-bottom: 1px solid var(--primary); padding-bottom: 2px; margin: 18px 0 8px; }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    .narrative { background: #fafafa; border-left: 3px solid var(--primary); padding: 8px 10px; margin: 6px 0 10px; white-space: pre-wrap; font-family: Georgia, serif; }
    .resolved-block { background: #ecfdf5; border-left: 3px solid #047857; padding: 8px 10px; margin: 6px 0 10px; }
  </style>
  <div class="letterhead">
    <div class="left">
      ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(input.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(generated)}<br/>
      Reported ${esc(reported)}
    </div>
  </div>

  <div class="title-block">
    <h1>PPE Issue Report</h1>
    <div class="ref">${esc(item.typeName ?? 'PPE Item')}${item.serialNumber ? ` · ${esc(item.serialNumber)}` : ''}</div>
  </div>
  <div class="badge-row">
    <span class="badge status-${esc(r.status)}">${esc(r.status)}</span>
  </div>

  <section>
    <h2>Report</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Reported</td><td class="val">${esc(reported)}</td>
        <td class="lbl">Status</td><td class="val">${esc(r.status)}</td>
      </tr>
      <tr>
        <td class="lbl">Reported by</td><td class="val">${esc(r.reportedByName ?? '—')}</td>
        <td class="lbl">Resolved</td><td class="val">${resolved ? esc(resolved) : '—'}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>PPE Item</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Type</td><td class="val">${esc(item.typeName ?? '—')}</td>
        <td class="lbl">Category</td><td class="val">${esc(item.category ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Serial #</td><td class="val">${esc(item.serialNumber ?? '—')}</td>
        <td class="lbl">Size</td><td class="val">${esc(item.size ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Item status</td><td class="val">${esc(item.status.replace(/_/g, ' '))}</td>
        <td class="lbl">Current holder</td><td class="val">${esc(item.currentHolderName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Purchase date</td><td class="val">${item.purchaseDate ? esc(fmtDate(item.purchaseDate)) : '—'}</td>
        <td class="lbl">Expires on</td><td class="val">${item.expiresOn ? esc(fmtDate(item.expiresOn)) : '—'}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>Description</h2>
    <div class="narrative">${esc(r.description)}</div>
  </section>

  ${
    r.resolution
      ? `<section>
          <h2>Resolution</h2>
          <div class="resolved-block">${esc(r.resolution)}</div>
        </section>`
      : ''
  }
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
