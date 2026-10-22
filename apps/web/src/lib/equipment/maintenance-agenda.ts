import type { ServiceState } from '@beaconhs/db/equipment-service'

export type MaintenanceKind = 'inspection' | 'reminder' | 'service' | 'warranty' | 'work_order'

export type MaintenanceEntry = {
  key: string
  kind: MaintenanceKind
  itemId: string
  itemName: string
  assetTag: string
  title: string
  detail: string | null
  dueOn: string | null
  startTypeId?: string | null
  scheduleId?: string
  reminderId?: string
  workOrderId?: string
  status?: string
  priority?: string
  servicePlanId?: string
  serviceStatus?: ServiceState['status']
  openedOn?: string
}

export function addMaintenanceDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Repairs have no promised due date in the work-order model. Keep them in
// the working queue without turning their opened dates into overdue dates.
export function maintenanceMatchesPeriod(
  entry: MaintenanceEntry,
  period: string | undefined,
  today: string,
  month: string,
): boolean {
  if (!period) return true
  if (period === 'undated')
    return entry.serviceStatus
      ? entry.serviceStatus === 'needs_setup'
      : entry.kind !== 'work_order' && entry.dueOn === null
  if (period === 'ready')
    return entry.serviceStatus
      ? entry.serviceStatus === 'due' || entry.serviceStatus === 'overdue'
      : entry.dueOn !== null && entry.dueOn <= today
  if (period === 'overdue' && entry.serviceStatus) return entry.serviceStatus === 'overdue'
  if (!entry.dueOn) return false
  if (period === 'overdue') return entry.dueOn < today
  if (period === 'today') return entry.dueOn === today
  if (period === 'week') return entry.dueOn >= today && entry.dueOn <= addMaintenanceDays(today, 7)
  if (period === 'month') return entry.dueOn.startsWith(month)
  return true
}

export function sortMaintenanceEntries(entries: MaintenanceEntry[], today: string) {
  const rank = (entry: MaintenanceEntry) =>
    (
      entry.serviceStatus
        ? entry.serviceStatus === 'due' || entry.serviceStatus === 'overdue'
        : entry.dueOn && entry.dueOn <= today
    )
      ? 0
      : entry.kind === 'work_order'
        ? 1
        : (entry.serviceStatus ? entry.serviceStatus === 'needs_setup' : entry.dueOn === null)
          ? 2
          : 3
  return [...entries].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueOn ?? a.openedOn ?? '').localeCompare(b.dueOn ?? b.openedOn ?? '') ||
      a.assetTag.localeCompare(b.assetTag) ||
      a.key.localeCompare(b.key),
  )
}
