import 'server-only'

// Vehicle log FlowSubjectAdapter. The subject row is a single truck_log_entries
// record (a real uuid, so approval gates persist), but the value map carries the
// WHOLE month for that driver + vehicle — month totals plus an `entries`
// collection — because the meaningful vehicle-log document is the legacy
// monthly sheet, not one day. A `{{#each entries}}` table in a PDF/email
// template therefore renders the driver's full month. Field keys mirror
// MODULE_FLOW_PROFILES['vehicle-log'].

import { and, asc, eq, gte, lt } from 'drizzle-orm'
import {
  equipmentItems,
  orgUnits,
  people,
  tenantUsers,
  truckLogEntries,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDate, personName } from '../format'
import type { FlowSubjectAdapter } from '../types'

function monthRange(entryDate: string): { start: string; endExclusive: string; key: string } {
  const [y, m] = entryDate.split('-').map(Number)
  const year = y ?? new Date().getFullYear()
  const month = m ?? 1
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: `${year}-${pad(month)}-01`,
    endExclusive: `${nextYear}-${pad(nextMonth)}-01`,
    key: `${year}-${pad(month)}`,
  }
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function num(value: number | null | undefined): number | '' {
  return value == null ? '' : value
}

export function createVehicleLogFlowAdapter(
  ctx: RequestContext,
  entryId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'vehicle-log',
    subjectId: entryId,
    notifyCategory: 'equipment',
    auditEntityType: 'truck_log_entry',
    deepLink: () => `/equipment/vehicle-log/${entryId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: entryId,
        entityType: 'truck_log_entry',
        heading: 'Vehicle log',
        reference: values.reference,
        subtitle: values.month_label,
        values,
      }),

    async loadValues() {
      const [anchor] = await ctx.db((tx) =>
        tx
          .select({
            row: truckLogEntries,
            vehicleName: equipmentItems.name,
            vehicleTag: equipmentItems.assetTag,
            driverFirst: people.firstName,
            driverLast: people.lastName,
            driverFormal: people.formalName,
            driverEmployeeNo: people.employeeNo,
          })
          .from(truckLogEntries)
          .leftJoin(equipmentItems, eq(equipmentItems.id, truckLogEntries.equipmentItemId))
          .leftJoin(people, eq(people.id, truckLogEntries.driverPersonId))
          .where(eq(truckLogEntries.id, entryId))
          .limit(1),
      )
      if (!anchor) return {}
      const r = anchor.row
      const range = monthRange(r.entryDate)

      const monthRows = await ctx.db((tx) =>
        tx
          .select({ row: truckLogEntries, siteName: orgUnits.name })
          .from(truckLogEntries)
          .leftJoin(orgUnits, eq(orgUnits.id, truckLogEntries.siteOrgUnitId))
          .where(
            and(
              eq(truckLogEntries.driverPersonId, r.driverPersonId),
              eq(truckLogEntries.equipmentItemId, r.equipmentItemId),
              gte(truckLogEntries.entryDate, range.start),
              lt(truckLogEntries.entryDate, range.endExclusive),
            ),
          )
          .orderBy(asc(truckLogEntries.entryDate)),
      )

      let monthBusiness = 0
      let monthPersonal = 0
      let monthTotal = 0
      let monthHours = 0
      const entries = monthRows.map(({ row: e, siteName }) => {
        monthBusiness += e.businessKm ?? 0
        monthPersonal += e.personalKm ?? 0
        monthTotal += e.kmDriven ?? 0
        monthHours += e.hoursOnSite ? Number(e.hoursOnSite) : 0
        const dateObj = new Date(`${e.entryDate}T00:00:00`)
        return {
          date: fmtDate(e.entryDate),
          day: dateObj.getDate(),
          weekday: dateObj.toLocaleDateString(undefined, { weekday: 'short' }),
          site_name: siteName ?? '',
          other_destination: e.otherDestination ?? '',
          start_odometer: num(e.startOdometer),
          end_odometer: num(e.endOdometer),
          business_km: num(e.businessKm),
          personal_km: num(e.personalKm),
          total_km: num(e.kmDriven),
          hours_on_site: e.hoursOnSite ?? '',
          crew_count: num(e.manpowerCount),
          notes: e.notes ?? '',
        }
      })

      const anchorSite = monthRows.find(({ row }) => row.id === entryId)
      const driverName = personName({
        firstName: anchor.driverFirst,
        lastName: anchor.driverLast,
        formalName: anchor.driverFormal,
      })
      const vehicleName = [anchor.vehicleTag, anchor.vehicleName].filter(Boolean).join(' · ')

      return {
        reference: `${anchor.vehicleTag ?? anchor.vehicleName ?? 'Vehicle'} ${range.key}`,
        entry_date: fmtDate(r.entryDate),
        entry_mode: r.entryMode,
        driver_name: driverName,
        driver_employee_no: anchor.driverEmployeeNo ?? '',
        vehicle_name: vehicleName,
        site_name: anchorSite?.siteName ?? '',
        other_destination: r.otherDestination ?? '',
        start_odometer: r.startOdometer,
        end_odometer: r.endOdometer,
        business_km: r.businessKm,
        personal_km: r.personalKm,
        total_km: r.kmDriven,
        hours_on_site: r.hoursOnSite ?? '',
        crew_count: r.manpowerCount,
        notes: r.notes ?? '',
        month_key: range.key,
        month_label: monthLabel(range.key),
        month_days_logged: monthRows.length,
        month_business_km: monthBusiness,
        month_personal_km: monthPersonal,
        month_total_km: monthTotal,
        month_hours_on_site: monthHours.toFixed(2),
        // FK ids for conditions / recipient `field` targets.
        driver_person_id: r.driverPersonId ?? null,
        equipment_item_id: r.equipmentItemId ?? null,
        site_org_unit_id: r.siteOrgUnitId ?? null,
        entries,
      }
    },

    async resolveSubmitter() {
      const [e] = await ctx.db((tx) =>
        tx
          .select({ createdBy: truckLogEntries.createdByTenantUserId })
          .from(truckLogEntries)
          .where(eq(truckLogEntries.id, entryId))
          .limit(1),
      )
      const tuid = e?.createdBy ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },
  }
}
