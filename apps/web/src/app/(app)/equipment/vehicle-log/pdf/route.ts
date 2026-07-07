// Vehicle log monthly PDF — the legacy truck-log sheet through the PDF engine.
// ?vehicle=&driver=&month=[&mode=] renders the tenant's default 'vehicle-log'
// PDF template (/admin/pdf-templates) merged with the month via the flow
// adapter; without a configured template it falls back to the built-in
// legacy-layout sheet below. Both paths render through the same template_pdf
// Chromium pipeline. Exports are audited.

import type { NextRequest } from 'next/server'
import type { OnDemandPdfJobData } from '@beaconhs/jobs'
import { can } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'
import { loadVehicleLogWorkspace, type VehicleLogWorkspace } from '../_service'

export const dynamic = 'force-dynamic'

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function n(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

const CELL = 'padding:4px 6px;border:1px solid #cbd5e1;font-size:11px;'
const NUM = `${CELL}text-align:right;font-variant-numeric:tabular-nums;`
const HEAD = `${CELL}background:#f1f5f9;font-weight:600;text-align:center;text-transform:uppercase;font-size:10px;`

// The built-in monthly sheet — mirrors the legacy Beacon truck-log PDF column
// layout for whichever mode is being viewed.
function builtinMonthHtml(
  workspace: VehicleLogWorkspace,
  labels: {
    driver: string
    vehicle: string
  },
): string {
  const odometer = workspace.mode === 'odometer'
  const siteById = new Map(workspace.sites.map((s) => [s.id, s.label]))

  const headRow = odometer
    ? `<tr>
        <th rowspan="2" style="${HEAD}">Date</th>
        <th colspan="2" style="${HEAD}">Odometer</th>
        <th rowspan="2" style="${HEAD}">Personal km</th>
        <th rowspan="2" style="${HEAD}">Total km</th>
      </tr>
      <tr><th style="${HEAD}">Start</th><th style="${HEAD}">End</th></tr>`
    : `<tr>
        <th rowspan="2" style="${HEAD}">Date</th>
        <th colspan="3" style="${HEAD}">Business</th>
        <th rowspan="2" style="${HEAD}">Personal km</th>
        <th rowspan="2" style="${HEAD}">Total km</th>
      </tr>
      <tr>
        <th style="${HEAD}">Customer / site</th>
        <th style="${HEAD}">Other destination</th>
        <th style="${HEAD}">Km</th>
      </tr>`

  let business = 0
  let personal = 0
  let total = 0
  const body = workspace.rows
    .map(({ day, weekday, isWeekend, entry }) => {
      business += entry.businessKm ?? 0
      personal += entry.personalKm ?? 0
      total += entry.totalKm ?? 0
      const shade = isWeekend ? 'background:#f8fafc;' : ''
      const date = `<td style="${CELL}${shade}white-space:nowrap;">${day} <span style="color:#64748b;">${esc(weekday)}</span></td>`
      const personalCell = `<td style="${NUM}background:#f1f5f9;">${n(entry.personalKm)}</td>`
      const totalCell = `<td style="${NUM}${shade}font-weight:600;">${n(entry.totalKm)}</td>`
      if (odometer) {
        return `<tr>${date}<td style="${NUM}${shade}">${n(entry.startOdometer)}</td><td style="${NUM}${shade}">${n(entry.endOdometer)}</td>${personalCell}${totalCell}</tr>`
      }
      const site = entry.siteOrgUnitId ? (siteById.get(entry.siteOrgUnitId) ?? '') : ''
      return `<tr>${date}<td style="${CELL}${shade}">${esc(site)}</td><td style="${CELL}${shade}">${esc(entry.otherDestination ?? '')}</td><td style="${NUM}${shade}">${n(entry.businessKm)}</td>${personalCell}${totalCell}</tr>`
    })
    .join('')

  const totalsRow = odometer
    ? `<tr>
        <td colspan="3" style="${NUM}background:#e2e8f0;font-weight:700;">Month total</td>
        <td style="${NUM}background:#e2e8f0;font-weight:700;">${personal}</td>
        <td style="${NUM}background:#e2e8f0;font-weight:700;">${total}</td>
      </tr>`
    : `<tr>
        <td colspan="3" style="${NUM}background:#e2e8f0;font-weight:700;">Month total</td>
        <td style="${NUM}background:#e2e8f0;font-weight:700;">${business}</td>
        <td style="${NUM}background:#e2e8f0;font-weight:700;">${personal}</td>
        <td style="${NUM}background:#e2e8f0;font-weight:700;">${total}</td>
      </tr>`

  return `
  <div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
    <h1 style="font-size:18px;margin:0 0 2px;">Vehicle log — ${esc(workspace.month.label)}</h1>
    <p style="font-size:12px;color:#475569;margin:0 0 10px;">
      ${esc(labels.driver)} · ${esc(labels.vehicle)} · ${workspace.mode === 'odometer' ? 'Odometer' : 'Destination'} log
    </p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>${headRow}</thead>
      <tbody>${body}${totalsRow}</tbody>
    </table>
  </div>`
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const ctx = await requireExportContext()
  if (
    !can(ctx, 'equipment.read.all') &&
    !can(ctx, 'equipment.read.site') &&
    !can(ctx, 'equipment.manage')
  ) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const workspace = await loadVehicleLogWorkspace(ctx, {
    month: url.searchParams.get('month'),
    driverPersonId: url.searchParams.get('driver'),
    equipmentItemId: url.searchParams.get('vehicle'),
    mode: url.searchParams.get('mode'),
  })
  if (!workspace.selectedDriverId || !workspace.selectedEquipmentId) {
    return Response.json({ error: 'Choose a driver and vehicle first.' }, { status: 400 })
  }

  const driverLabel =
    workspace.drivers.find((d) => d.id === workspace.selectedDriverId)?.label ?? 'Driver'
  const vehicle = workspace.vehicles.find((v) => v.id === workspace.selectedEquipmentId)
  const vehicleLabel = vehicle
    ? [vehicle.hint, vehicle.label].filter(Boolean).join(' · ')
    : 'Vehicle'
  const anchorEntryId = [...workspace.rows].reverse().find((row) => row.entry.id)?.entry.id ?? null

  const filename = `vehicle-log-${workspace.month.key}-${(vehicle?.hint ?? 'vehicle').toLowerCase()}.pdf`
  const builtin: OnDemandPdfJobData = {
    kind: 'template_pdf',
    tenantId: ctx.tenantId,
    html: builtinMonthHtml(workspace, { driver: driverLabel, vehicle: vehicleLabel }),
    paperSize: 'letter',
    orientation: 'portrait',
    marginMm: 14,
    headerHtml: null,
    footerHtml: 'Page {{page}} of {{pages}}',
    entityType: 'truck_log_entry',
    entityId: anchorEntryId ?? workspace.selectedEquipmentId,
    filename,
  }

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: anchorEntryId ?? workspace.selectedEquipmentId,
    action: 'export',
    summary: `Exported vehicle log PDF for ${workspace.month.key} (${driverLabel} / ${vehicleLabel})`,
    metadata: {
      format: 'pdf',
      month: workspace.month.key,
      driverPersonId: workspace.selectedDriverId,
      equipmentItemId: workspace.selectedEquipmentId,
    },
  })

  // With at least one saved entry the tenant's default 'vehicle-log' PDF
  // template (if configured) renders the month via the flow adapter; the
  // built-in sheet is the fallback. An empty month always uses the built-in.
  if (anchorEntryId) {
    return renderModulePdfResponse(ctx, {
      moduleKey: 'vehicle-log',
      recordId: anchorEntryId,
      builtin,
    })
  }
  return renderOnDemandPdfResponse(builtin)
}
