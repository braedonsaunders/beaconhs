// Vehicle log monthly PDF through the shared monthly template and PDF engine.
// ?vehicle=&driver=&month=[&mode=] renders the tenant's default 'vehicle-log'
// PDF template (/admin/pdf-templates) merged with the month via the flow
// adapter; without a configured template it falls back to the built-in
// stock monthly template. Both paths render through the same template_pdf
// Chromium pipeline. Exports are audited.

import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import type { NextRequest } from 'next/server'
import type { OnDemandPdfJobData } from '@beaconhs/jobs'
import { canReadVehicleLog } from '../_access-policy'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'
import { loadVehicleLogWorkspace } from '../_service'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (isRouterPrefetch(req)) return new Response(null, { status: 204 })

  const url = new URL(req.url)
  const ctx = await requireRequestContext()
  if (!canReadVehicleLog(ctx)) {
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
    html: renderTemplate(
      expandRepeatMarkers(
        MODULE_PDF_TEMPLATE_SEEDS.find((t) => t.key === 'vehicle-log-month-pdf')!.html,
      ),
      {
        month_key: workspace.month.key,
        month_label: workspace.month.label,
        driver_name: driverLabel,
        vehicle_name: vehicleLabel,
        is_odometer: workspace.mode === 'odometer',
        month_business_km: workspace.totals.businessKm,
        month_personal_km: workspace.totals.personalKm,
        month_total_km: workspace.totals.totalKm,
        entries: workspace.rows.map(({ day, weekday, isWeekend, entry }) => ({
          day,
          weekday,
          is_weekend: isWeekend,
          site_name: workspace.sites.find((s) => s.id === entry.siteOrgUnitId)?.label ?? '',
          other_destination: entry.otherDestination ?? '',
          start_odometer: entry.startOdometer ?? '',
          end_odometer: entry.endOdometer ?? '',
          business_km: entry.businessKm ?? '',
          personal_km: entry.personalKm ?? '',
          total_km: entry.totalKm ?? '',
        })),
      },
      { escapeHtml: true },
    ),
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
      values: { is_odometer: workspace.mode === 'odometer', entry_mode: workspace.mode },
      fallback: builtin,
    })
  }
  return renderOnDemandPdfResponse(builtin)
}
