// Equipment Work Order PDF template.
//
// Mirrors the platform equipment schema (packages/db/src/schema/equipment.ts).
// Renders a single work order as a formal letterhead-style PDF including:
//   - Reference / status / priority
//   - Linked equipment item summary (asset tag, name, serial, type)
//   - Reporter / opener / assignee
//   - Summary + description (narrative)
//   - Action taken
//   - Cost + dates

export type EquipmentWorkOrderRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  workOrder: {
    reference: string
    status: string
    priority: string
    summary: string
    description?: string | null
    actionTaken?: string | null
    cost?: string | null
    openedAt: string | Date
    closedAt?: string | Date | null
    reportedByName?: string | null
    openedByName?: string | null
    assignedToName?: string | null
  }
  item: {
    assetTag: string
    name: string
    serialNumber?: string | null
    description?: string | null
    typeName?: string | null
    status: string
    currentSiteName?: string | null
    currentHolderName?: string | null
  }
  generatedAt?: string | Date
}

export function renderEquipmentWorkOrderHtml(input: EquipmentWorkOrderRenderInput): string {
  const wo = input.workOrder
  const item = input.item
  const primary = input.primaryColor ?? '#1f3a5f'
  const generated = fmtDateTime(input.generatedAt ?? new Date())
  const opened = fmtDateTime(wo.openedAt)
  const closed = wo.closedAt ? fmtDateTime(wo.closedAt) : null

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
    .badge.priority-high { background: #fee; border-color: #c00; color: #800; }
    .badge.priority-med { background: #fef3c7; border-color: #b58500; color: #5a4400; }
    .badge.priority-low { background: #e2e8f0; color: #334155; }
    .badge.status-closed, .badge.status-verified, .badge.status-repaired { background: #ecfdf5; border-color: #047857; color: #064e3b; }
    .badge.status-cancelled { background: #e2e8f0; color: #334155; }
    .badge.status-open, .badge.status-assigned, .badge.status-in_progress, .badge.status-awaiting_parts { background: #fef3c7; border-color: #b58500; color: #5a4400; }
    h2 { font-size: 11.5pt; letter-spacing: 1px; text-transform: uppercase; color: var(--primary); border-bottom: 1px solid var(--primary); padding-bottom: 2px; margin: 18px 0 8px; }
    section { page-break-inside: avoid; margin-bottom: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .info-table td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 10pt; }
    .info-table td.lbl { width: 22%; font-weight: 600; color: #555; }
    .info-table td.val { width: 28%; }
    .narrative { background: #fafafa; border-left: 3px solid var(--primary); padding: 8px 10px; margin: 6px 0 10px; white-space: pre-wrap; font-family: Georgia, serif; }
    .signoff { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 30px; }
    .signoff .cell { border-top: 1.5px solid #333; padding-top: 4px; font-size: 9pt; color: #555; }
  </style>
  <div class="letterhead">
    <div class="left">
      ${input.tenantLogoUrl ? `<img class="logo" src="${esc(input.tenantLogoUrl)}" alt=""/>` : ''}
      <div class="tenant-name">${esc(input.tenantName)}</div>
    </div>
    <div class="right">
      Generated ${esc(generated)}<br/>
      Reference <strong>${esc(wo.reference)}</strong>
    </div>
  </div>

  <div class="title-block">
    <h1>Equipment Work Order</h1>
    <div class="ref">${esc(wo.summary)}</div>
  </div>
  <div class="badge-row">
    <span class="badge status-${esc(wo.status)}">${esc(wo.status.replace(/_/g, ' '))}</span>
    <span class="badge priority-${esc(wo.priority)}">Priority: ${esc(wo.priority)}</span>
  </div>

  <section>
    <h2>Work Order</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Reference</td><td class="val">${esc(wo.reference)}</td>
        <td class="lbl">Status</td><td class="val">${esc(wo.status.replace(/_/g, ' '))}</td>
      </tr>
      <tr>
        <td class="lbl">Priority</td><td class="val">${esc(wo.priority)}</td>
        <td class="lbl">Cost</td><td class="val">${esc(formatMoney(wo.cost))}</td>
      </tr>
      <tr>
        <td class="lbl">Opened</td><td class="val">${esc(opened)}</td>
        <td class="lbl">Closed</td><td class="val">${closed ? esc(closed) : '—'}</td>
      </tr>
      <tr>
        <td class="lbl">Reported by</td><td class="val">${esc(wo.reportedByName ?? '—')}</td>
        <td class="lbl">Opened by</td><td class="val">${esc(wo.openedByName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Assigned to</td><td class="val" colspan="3">${esc(wo.assignedToName ?? '—')}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>Equipment Item</h2>
    <table class="info-table">
      <tr>
        <td class="lbl">Asset tag</td><td class="val">${esc(item.assetTag)}</td>
        <td class="lbl">Type</td><td class="val">${esc(item.typeName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Name</td><td class="val">${esc(item.name)}</td>
        <td class="lbl">Status</td><td class="val">${esc(item.status.replace(/_/g, ' '))}</td>
      </tr>
      <tr>
        <td class="lbl">Serial #</td><td class="val">${esc(item.serialNumber ?? '—')}</td>
        <td class="lbl">Current site</td><td class="val">${esc(item.currentSiteName ?? '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Description</td><td class="val">${esc(item.description ?? '—')}</td>
        <td class="lbl">Current holder</td><td class="val">${esc(item.currentHolderName ?? '—')}</td>
      </tr>
    </table>
  </section>

  <section>
    <h2>Summary</h2>
    <div class="narrative">${esc(wo.summary)}</div>
  </section>

  ${wo.description ? `<section><h2>Description</h2><div class="narrative">${esc(wo.description)}</div></section>` : ''}
  ${wo.actionTaken ? `<section><h2>Action taken</h2><div class="narrative">${esc(wo.actionTaken)}</div></section>` : ''}

  <section>
    <h2>Sign-off</h2>
    <div class="signoff">
      <div class="cell">Assigned technician — name / signature</div>
      <div class="cell">Supervisor — name / signature</div>
    </div>
  </section>
  `
}

function formatMoney(n: string | null | undefined): string {
  if (n == null) return '—'
  const v = Number(n)
  if (Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
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
