import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  syncConnections,
  truckLogEntries,
  workActivityEntries,
  type TruckLogEntryMode,
  type TruckLogImportStatus,
} from '@beaconhs/db/schema'
import { getConnector } from '@beaconhs/sync'
import { can, type RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

export type VehicleLogMode = TruckLogEntryMode

export type VehicleLogSelectorOption = {
  id: string
  label: string
  hint?: string | null
}

export type VehicleLogActivity = {
  count: number
  hours: string | null
  businessKm: number | null
  personalKm: number | null
  siteOrgUnitId: string | null
  siteName: string | null
  sourceLabel: string | null
  status: string
}

export type VehicleLogEntryDraft = {
  id: string | null
  entryDate: string
  entryMode: VehicleLogMode
  startOdometer: number | null
  endOdometer: number | null
  businessKm: number | null
  personalKm: number | null
  totalKm: number | null
  siteOrgUnitId: string | null
  otherDestination: string | null
  hoursOnSite: string | null
  manpowerCount: number | null
  notes: string | null
  importStatus: TruckLogImportStatus | null
}

export type VehicleLogWorkspaceRow = {
  date: string
  day: number
  weekday: string
  isWeekend: boolean
  activity: VehicleLogActivity | null
  entry: VehicleLogEntryDraft
}

export type VehicleLogWorkspace = {
  month: {
    key: string
    label: string
    year: number
    month: number
    previousKey: string
    nextKey: string
    start: string
    endExclusive: string
    elapsedDays: number
    daysInMonth: number
  }
  mode: VehicleLogMode
  selectedDriverId: string
  selectedEquipmentId: string
  drivers: VehicleLogSelectorOption[]
  vehicles: VehicleLogSelectorOption[]
  sites: VehicleLogSelectorOption[]
  rows: VehicleLogWorkspaceRow[]
  workActivity: {
    configuredSourceCount: number
    activeSourceCount: number
    monthRowCount: number
    canConfigureSources: boolean
  }
  totals: {
    loggedDays: number
    workActivityDays: number
    pendingActivityDays: number
    conflictDays: number
    businessKm: number
    personalKm: number
    totalKm: number
    hoursOnSite: number
    crewCount: number
  }
}

export type SaveVehicleLogEntryInput = {
  equipmentItemId: string
  driverPersonId: string
  entryDate: string
  entryMode: VehicleLogMode
  startOdometer?: number | null
  endOdometer?: number | null
  businessKm?: number | null
  personalKm?: number | null
  siteOrgUnitId?: string | null
  otherDestination?: string | null
  hoursOnSite?: string | null
  manpowerCount?: number | null
  notes?: string | null
  sourceConnectionId?: string | null
  sourceWorkActivityId?: string | null
  sourceExternalId?: string | null
  importStatus?: TruckLogImportStatus
  importMeta?: Record<string, unknown>
}

export type ApplyWorkActivityInput = {
  equipmentItemId: string
  driverPersonId: string
  month: string
}

export type ApplyWorkActivityResult = {
  created: number
  updated: number
  conflicts: number
  skipped: number
}

type ActivityRow = typeof workActivityEntries.$inferSelect
type TruckLogRow = typeof truckLogEntries.$inferSelect
type SyncConnectionRow = Pick<
  typeof syncConnections.$inferSelect,
  'connectorKey' | 'status' | 'config'
>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export function monthKey(year: number, month: number) {
  return `${year}-${pad2(month)}`
}

export function parseMonth(raw: string | null | undefined): { year: number; month: number } {
  if (raw && MONTH.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function shiftMonth(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  return { year: nextYear, month: nextMonth }
}

export function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function parseHours(value: string | number | null | undefined): string | null {
  const n = parseNumber(value)
  return n == null ? null : n.toFixed(2)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function connectionTargetsWorkActivity(connection: SyncConnectionRow): boolean {
  const connector = getConnector(connection.connectorKey)
  if (!connector?.entities.includes('work_activity')) return false

  const config = recordValue(connection.config)
  if (connection.connectorKey === 'database') {
    const mappings = recordValue(config.mappings)
    const workActivity = recordValue(mappings.work_activity)
    return Boolean(workActivity.table)
  }
  if (connection.connectorKey === 'csv') return config.entity === 'work_activity'
  if (connection.connectorKey === 'nango') {
    const models = recordValue(config.models)
    return Boolean(models.work_activity)
  }
  if (connection.connectorKey === 'netsuite') {
    const entities = recordValue(config.entities)
    return Boolean(entities.work_activity)
  }
  return true
}

function sumHours(values: (string | null)[]): string | null {
  let total = 0
  let seen = false
  for (const value of values) {
    const n = parseNumber(value)
    if (n == null) continue
    total += n
    seen = true
  }
  return seen ? total.toFixed(2) : null
}

function sumNullable(values: (number | null)[]): number | null {
  let total = 0
  let seen = false
  for (const value of values) {
    if (value == null) continue
    total += value
    seen = true
  }
  return seen ? total : null
}

function computeTotalKm(input: {
  entryMode: VehicleLogMode
  startOdometer?: number | null
  endOdometer?: number | null
  businessKm?: number | null
  personalKm?: number | null
}): number | null {
  if (
    input.entryMode === 'odometer' &&
    typeof input.startOdometer === 'number' &&
    typeof input.endOdometer === 'number' &&
    input.endOdometer >= input.startOdometer
  ) {
    return input.endOdometer - input.startOdometer
  }
  if (input.businessKm != null || input.personalKm != null) {
    return (input.businessKm ?? 0) + (input.personalKm ?? 0)
  }
  return null
}

function entryDraft(
  row: TruckLogRow | null,
  date: string,
  mode: VehicleLogMode,
): VehicleLogEntryDraft {
  const entryMode = row?.entryMode ?? mode
  const totalKm = row
    ? (computeTotalKm({
        entryMode,
        startOdometer: row.startOdometer,
        endOdometer: row.endOdometer,
        businessKm: row.businessKm,
        personalKm: row.personalKm,
      }) ?? row.kmDriven)
    : null
  return {
    id: row?.id ?? null,
    entryDate: row?.entryDate ?? date,
    entryMode,
    startOdometer: row?.startOdometer ?? null,
    endOdometer: row?.endOdometer ?? null,
    businessKm: row?.businessKm ?? null,
    personalKm: row?.personalKm ?? null,
    totalKm,
    siteOrgUnitId: row?.siteOrgUnitId ?? null,
    otherDestination: row?.otherDestination ?? null,
    hoursOnSite: row?.hoursOnSite ?? null,
    manpowerCount: row?.manpowerCount ?? null,
    notes: row?.notes ?? null,
    importStatus: row?.importStatus ?? null,
  }
}

function activitySummary(rows: ActivityRow[]): VehicleLogActivity | null {
  if (rows.length === 0) return null
  const siteNames = [...new Set(rows.map((r) => r.siteName).filter(Boolean))]
  const sourceLabels = [...new Set(rows.map((r) => r.sourceLabel ?? r.sourceCode).filter(Boolean))]
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))]
  const siteIds = [...new Set(rows.map((r) => r.siteOrgUnitId).filter(Boolean))]
  return {
    count: rows.length,
    hours: sumHours(rows.map((r) => r.hours)),
    businessKm: sumNullable(rows.map((r) => r.businessKm)),
    personalKm: sumNullable(rows.map((r) => r.personalKm)),
    siteOrgUnitId: siteIds.length === 1 ? (siteIds[0] ?? null) : null,
    siteName:
      siteNames.length === 1
        ? (siteNames[0] ?? null)
        : siteNames.length > 1
          ? 'Multiple sites'
          : null,
    sourceLabel:
      sourceLabels.length === 1
        ? (sourceLabels[0] ?? null)
        : sourceLabels.length > 1
          ? 'Multiple activities'
          : null,
    status: statuses.length === 1 ? (statuses[0] ?? 'ready') : 'mixed',
  }
}

async function listWorkActivitiesForDriver(
  tx: Database,
  driver: { id: string; employeeNo: string | null; externalEmployeeId: string | null },
  start: string,
  endExclusive: string,
) {
  const personMatches = [eq(workActivityEntries.personId, driver.id)]
  if (driver.employeeNo) personMatches.push(eq(workActivityEntries.employeeNo, driver.employeeNo))
  if (driver.externalEmployeeId) {
    personMatches.push(eq(workActivityEntries.externalEmployeeId, driver.externalEmployeeId))
  }
  return tx
    .select()
    .from(workActivityEntries)
    .where(
      and(
        or(...personMatches),
        gte(workActivityEntries.activityDate, start),
        lt(workActivityEntries.activityDate, endExclusive),
      ),
    )
    .orderBy(asc(workActivityEntries.activityDate))
}

export async function loadVehicleLogWorkspace(
  ctx: RequestContext,
  opts: {
    month?: string | null
    driverPersonId?: string | null
    equipmentItemId?: string | null
    mode?: string | null
  },
): Promise<VehicleLogWorkspace> {
  const { year, month } = parseMonth(opts.month)
  const key = monthKey(year, month)
  const next = shiftMonth(year, month, 1)
  const previous = shiftMonth(year, month, -1)
  const start = dateKey(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)
  const dim = daysInMonth(year, month)
  const today = new Date().toISOString().slice(0, 10)
  const elapsedDays =
    today < start ? 0 : today >= endExclusive ? dim : Math.max(1, Number(today.slice(8, 10)))
  const mode: VehicleLogMode = opts.mode === 'odometer' ? 'odometer' : 'destination'

  const result = await ctx.db(async (tx) => {
    const [driversRaw, vehiclesRaw, sitesRaw, connectionRows, workActivityMonthCount] =
      await Promise.all([
        tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            employeeNo: people.employeeNo,
            externalEmployeeId: people.externalEmployeeId,
          })
          .from(people)
          .where(eq(people.status, 'active'))
          .orderBy(asc(people.lastName), asc(people.firstName))
          .limit(1000),
        tx
          .select({
            id: equipmentItems.id,
            assetTag: equipmentItems.assetTag,
            name: equipmentItems.name,
            category: equipmentTypes.category,
            typeName: equipmentTypes.name,
          })
          .from(equipmentItems)
          .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
          .orderBy(asc(equipmentItems.assetTag))
          .limit(1000),
        tx
          .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
          .from(orgUnits)
          .where(eq(orgUnits.level, 'site'))
          .orderBy(asc(orgUnits.name))
          .limit(1000),
        tx
          .select({
            connectorKey: syncConnections.connectorKey,
            status: syncConnections.status,
            config: syncConnections.config,
          })
          .from(syncConnections)
          .where(isNull(syncConnections.deletedAt)),
        tx
          .select({ count: count() })
          .from(workActivityEntries)
          .where(
            and(
              gte(workActivityEntries.activityDate, start),
              lt(workActivityEntries.activityDate, endExclusive),
            ),
          )
          .then((rows) => Number(rows[0]?.count ?? 0)),
      ])

    const drivers = driversRaw.map((p) => ({
      id: p.id,
      label: `${p.lastName}, ${p.firstName}`,
      hint: p.employeeNo ?? p.externalEmployeeId,
    }))
    const vehicleCandidates = vehiclesRaw.filter(
      (v) =>
        (v.category ?? '').toLowerCase().includes('vehicle') ||
        (v.typeName ?? '').toLowerCase().includes('truck'),
    )
    const vehicleRows = vehicleCandidates.length > 0 ? vehicleCandidates : vehiclesRaw
    const vehicles = vehicleRows.map((v) => ({
      id: v.id,
      label: v.name,
      hint: v.assetTag,
    }))
    const sites = sitesRaw.map((s) => ({
      id: s.id,
      label: s.name,
      hint: s.code,
    }))

    const selectedDriver = opts.driverPersonId
      ? (driversRaw.find((d) => d.id === opts.driverPersonId) ?? null)
      : null
    const selectedVehicle = opts.equipmentItemId
      ? (vehicleRows.find((v) => v.id === opts.equipmentItemId) ?? null)
      : null
    const workActivitySources = connectionRows.filter(connectionTargetsWorkActivity)
    const workActivity = {
      configuredSourceCount: workActivitySources.length,
      activeSourceCount: workActivitySources.filter((source) => source.status !== 'disabled')
        .length,
      monthRowCount: workActivityMonthCount,
      canConfigureSources: can(ctx, 'admin.integrations.manage'),
    }

    if (!selectedDriver || !selectedVehicle) {
      return {
        month: {
          key,
          label: monthLabel(year, month),
          year,
          month,
          previousKey: monthKey(previous.year, previous.month),
          nextKey: monthKey(next.year, next.month),
          start,
          endExclusive,
          elapsedDays,
          daysInMonth: dim,
        },
        mode,
        selectedDriverId: selectedDriver?.id ?? '',
        selectedEquipmentId: selectedVehicle?.id ?? '',
        drivers,
        vehicles,
        sites,
        rows: [],
        workActivity,
        totals: {
          loggedDays: 0,
          workActivityDays: 0,
          pendingActivityDays: 0,
          conflictDays: 0,
          businessKm: 0,
          personalKm: 0,
          totalKm: 0,
          hoursOnSite: 0,
          crewCount: 0,
        },
      }
    }

    const [entries, activities] = await Promise.all([
      tx
        .select()
        .from(truckLogEntries)
        .where(
          and(
            eq(truckLogEntries.driverPersonId, selectedDriver.id),
            eq(truckLogEntries.equipmentItemId, selectedVehicle.id),
            gte(truckLogEntries.entryDate, start),
            lt(truckLogEntries.entryDate, endExclusive),
          ),
        ),
      listWorkActivitiesForDriver(tx, selectedDriver, start, endExclusive),
    ])

    const entryByDate = new Map(entries.map((entry) => [entry.entryDate, entry]))
    const activityByDate = new Map<string, ActivityRow[]>()
    for (const activity of activities) {
      const list = activityByDate.get(activity.activityDate) ?? []
      list.push(activity)
      activityByDate.set(activity.activityDate, list)
    }

    const rows: VehicleLogWorkspaceRow[] = []
    let businessKm = 0
    let personalKm = 0
    let totalKm = 0
    let hoursOnSite = 0
    let crewCount = 0
    let workActivityDays = 0
    let pendingActivityDays = 0
    let conflictDays = 0
    for (let day = 1; day <= dim; day++) {
      const date = dateKey(year, month, day)
      const dateObj = new Date(`${date}T00:00:00`)
      const entry = entryDraft(entryByDate.get(date) ?? null, date, mode)
      const activity = activitySummary(activityByDate.get(date) ?? [])
      if (activity) workActivityDays += 1
      if (activity && !entry.id) pendingActivityDays += 1
      if (entry.importStatus === 'conflict') conflictDays += 1
      businessKm += entry.businessKm ?? 0
      personalKm += entry.personalKm ?? 0
      totalKm += entry.totalKm ?? 0
      hoursOnSite += parseNumber(entry.hoursOnSite) ?? 0
      crewCount += entry.manpowerCount ?? 0
      rows.push({
        date,
        day,
        weekday: dateObj.toLocaleDateString(undefined, { weekday: 'short' }),
        isWeekend: dateObj.getDay() === 0 || dateObj.getDay() === 6,
        activity,
        entry,
      })
    }

    return {
      month: {
        key,
        label: monthLabel(year, month),
        year,
        month,
        previousKey: monthKey(previous.year, previous.month),
        nextKey: monthKey(next.year, next.month),
        start,
        endExclusive,
        elapsedDays,
        daysInMonth: dim,
      },
      mode,
      selectedDriverId: selectedDriver.id,
      selectedEquipmentId: selectedVehicle.id,
      drivers,
      vehicles,
      sites,
      rows,
      workActivity,
      totals: {
        loggedDays: entries.length,
        workActivityDays,
        pendingActivityDays,
        conflictDays,
        businessKm,
        personalKm,
        totalKm,
        hoursOnSite,
        crewCount,
      },
    }
  })
  return result
}

export async function upsertVehicleLogEntry(ctx: RequestContext, input: SaveVehicleLogEntryInput) {
  if (!input.equipmentItemId || !input.driverPersonId || !ISO_DATE.test(input.entryDate)) {
    throw new Error('Vehicle, driver and date are required.')
  }
  const entryMode: VehicleLogMode = input.entryMode === 'odometer' ? 'odometer' : 'destination'
  const startOdometer = parseNumber(input.startOdometer)
  const endOdometer = parseNumber(input.endOdometer)
  const businessKm = parseNumber(input.businessKm)
  const personalKm = parseNumber(input.personalKm)
  const kmDriven = computeTotalKm({ entryMode, startOdometer, endOdometer, businessKm, personalKm })
  const hoursOnSite = parseHours(input.hoursOnSite)
  const importStatus = input.importStatus ?? 'manual'
  const now = new Date()

  const fields = {
    entryMode,
    startOdometer: entryMode === 'odometer' ? startOdometer : null,
    endOdometer: entryMode === 'odometer' ? endOdometer : null,
    kmDriven,
    businessKm: entryMode === 'destination' ? businessKm : null,
    personalKm: entryMode === 'destination' ? personalKm : null,
    siteOrgUnitId: input.siteOrgUnitId || null,
    otherDestination: input.otherDestination?.trim() || null,
    hoursOnSite,
    manpowerCount: parseNumber(input.manpowerCount),
    notes: input.notes?.trim() || null,
    sourceConnectionId: input.sourceConnectionId || null,
    sourceWorkActivityId: input.sourceWorkActivityId || null,
    sourceExternalId: input.sourceExternalId || null,
    importStatus,
    importedAt: importStatus === 'manual' ? null : now,
    importMeta: input.importMeta ?? {},
  }

  const row = await ctx.db(async (tx) => {
    const [inserted] = await tx
      .insert(truckLogEntries)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: input.equipmentItemId,
        driverPersonId: input.driverPersonId,
        entryDate: input.entryDate,
        ...fields,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [
          truckLogEntries.tenantId,
          truckLogEntries.equipmentItemId,
          truckLogEntries.driverPersonId,
          truckLogEntries.entryDate,
        ],
        set: fields,
      })
      .returning()
    return inserted
  })
  if (!row) throw new Error('Failed to save vehicle log entry.')

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: row.id,
    action: 'update',
    summary: `Saved vehicle log for ${input.entryDate}`,
    after: {
      equipmentItemId: input.equipmentItemId,
      driverPersonId: input.driverPersonId,
      entryDate: input.entryDate,
      kmDriven,
      importStatus,
    },
    metadata: { operation: 'upsert' },
  })
  revalidateVehicleLogPaths(input.equipmentItemId, input.entryDate)
  return entryDraft(row, input.entryDate, entryMode)
}

type ActivityAggregate = {
  date: string
  rows: ActivityRow[]
  siteOrgUnitId: string | null
  sourceConnectionId: string | null
  sourceWorkActivityId: string | null
  sourceExternalId: string | null
  hoursOnSite: string | null
  businessKm: number | null
  personalKm: number | null
  importMeta: Record<string, unknown>
}

function aggregateActivities(date: string, rows: ActivityRow[]): ActivityAggregate {
  const sourceConnections = [...new Set(rows.map((r) => r.sourceConnectionId))]
  const siteIds = [...new Set(rows.map((r) => r.siteOrgUnitId).filter(Boolean))]
  return {
    date,
    rows,
    siteOrgUnitId: siteIds.length === 1 ? (siteIds[0] ?? null) : null,
    sourceConnectionId: sourceConnections.length === 1 ? (sourceConnections[0] ?? null) : null,
    sourceWorkActivityId: rows.length === 1 ? (rows[0]?.id ?? null) : (rows[0]?.id ?? null),
    sourceExternalId: rows.length === 1 ? (rows[0]?.sourceExternalId ?? null) : `multi:${date}`,
    hoursOnSite: sumHours(rows.map((r) => r.hours)),
    businessKm: sumNullable(rows.map((r) => r.businessKm)),
    personalKm: sumNullable(rows.map((r) => r.personalKm)),
    importMeta: {
      workActivityIds: rows.map((r) => r.id),
      sourceExternalIds: rows.map((r) => r.sourceExternalId),
      sourceLabels: rows.map((r) => r.sourceLabel ?? r.sourceCode).filter(Boolean),
      siteNames: rows.map((r) => r.siteName).filter(Boolean),
    },
  }
}

export async function applyWorkActivityToVehicleLog(
  ctx: RequestContext,
  input: ApplyWorkActivityInput,
): Promise<ApplyWorkActivityResult> {
  if (!input.equipmentItemId || !input.driverPersonId) {
    throw new Error('Vehicle and driver are required.')
  }
  const { year, month } = parseMonth(input.month)
  const start = dateKey(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)

  const result = await ctx.db(async (tx) => {
    const [driver] = await tx
      .select({
        id: people.id,
        employeeNo: people.employeeNo,
        externalEmployeeId: people.externalEmployeeId,
      })
      .from(people)
      .where(eq(people.id, input.driverPersonId))
      .limit(1)
    if (!driver) throw new Error('Driver was not found.')

    const [activities, existingEntries] = await Promise.all([
      listWorkActivitiesForDriver(tx, driver, start, endExclusive),
      tx
        .select()
        .from(truckLogEntries)
        .where(
          and(
            eq(truckLogEntries.driverPersonId, input.driverPersonId),
            eq(truckLogEntries.equipmentItemId, input.equipmentItemId),
            gte(truckLogEntries.entryDate, start),
            lt(truckLogEntries.entryDate, endExclusive),
          ),
        ),
    ])
    const byDate = new Map<string, ActivityRow[]>()
    for (const activity of activities) {
      const list = byDate.get(activity.activityDate) ?? []
      list.push(activity)
      byDate.set(activity.activityDate, list)
    }
    const existingByDate = new Map(existingEntries.map((entry) => [entry.entryDate, entry]))
    let created = 0
    let updated = 0
    let conflicts = 0
    let skipped = 0

    for (const [date, rows] of byDate.entries()) {
      const aggregate = aggregateActivities(date, rows)
      const existing = existingByDate.get(date)
      if (
        existing &&
        (existing.importStatus === 'manual' || existing.importStatus === 'conflict')
      ) {
        await tx
          .update(truckLogEntries)
          .set({ importStatus: 'conflict', importMeta: aggregate.importMeta })
          .where(eq(truckLogEntries.id, existing.id))
        conflicts += 1
        continue
      }

      const kmDriven = computeTotalKm({
        entryMode: 'destination',
        businessKm: aggregate.businessKm,
        personalKm: aggregate.personalKm,
      })
      const values = {
        tenantId: ctx.tenantId,
        equipmentItemId: input.equipmentItemId,
        driverPersonId: input.driverPersonId,
        entryDate: date,
        entryMode: 'destination' as const,
        kmDriven,
        businessKm: aggregate.businessKm,
        personalKm: aggregate.personalKm,
        siteOrgUnitId: aggregate.siteOrgUnitId,
        hoursOnSite: aggregate.hoursOnSite,
        sourceConnectionId: aggregate.sourceConnectionId,
        sourceWorkActivityId: aggregate.sourceWorkActivityId,
        sourceExternalId: aggregate.sourceExternalId,
        importStatus: 'imported' as const,
        importedAt: new Date(),
        importMeta: aggregate.importMeta,
        createdByTenantUserId: ctx.membership?.id ?? null,
      }
      const [row] = await tx
        .insert(truckLogEntries)
        .values(values)
        .onConflictDoUpdate({
          target: [
            truckLogEntries.tenantId,
            truckLogEntries.equipmentItemId,
            truckLogEntries.driverPersonId,
            truckLogEntries.entryDate,
          ],
          set: values,
        })
        .returning({ id: truckLogEntries.id })
      if (!row) skipped += 1
      else if (existing) updated += 1
      else created += 1
    }

    return { created, updated, conflicts, skipped }
  })

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: input.equipmentItemId,
    action: 'update',
    summary: `Imported ${result.created + result.updated} vehicle log day(s) from work activity`,
    after: { ...input, ...result },
    metadata: { operation: 'import' },
  })
  revalidatePath('/equipment/vehicle-log')
  revalidatePath(`/equipment/${input.equipmentItemId}`)
  return result
}

export async function deleteVehicleLogMonth(
  ctx: RequestContext,
  input: ApplyWorkActivityInput,
): Promise<number> {
  if (!input.equipmentItemId || !input.driverPersonId) {
    throw new Error('Vehicle and driver are required.')
  }
  const { year, month } = parseMonth(input.month)
  const start = dateKey(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)

  const ids = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: truckLogEntries.id })
      .from(truckLogEntries)
      .where(
        and(
          eq(truckLogEntries.driverPersonId, input.driverPersonId),
          eq(truckLogEntries.equipmentItemId, input.equipmentItemId),
          gte(truckLogEntries.entryDate, start),
          lt(truckLogEntries.entryDate, endExclusive),
        ),
      )
    if (rows.length === 0) return []
    await tx.delete(truckLogEntries).where(
      inArray(
        truckLogEntries.id,
        rows.map((r) => r.id),
      ),
    )
    return rows.map((r) => r.id)
  })

  if (ids.length > 0) {
    await recordAudit(ctx, {
      entityType: 'truck_log_entry',
      entityId: input.equipmentItemId,
      action: 'delete',
      summary: `Deleted ${ids.length} vehicle log entries for ${input.month}`,
      before: input,
      metadata: { operation: 'delete_month', deletedCount: ids.length },
    })
    revalidateVehicleLogPaths(input.equipmentItemId, start)
  }
  return ids.length
}

function revalidateVehicleLogPaths(equipmentItemId: string, date: string) {
  revalidatePath('/equipment/vehicle-log')
  revalidatePath('/equipment/vehicle-log/summary')
  revalidatePath(`/equipment/${equipmentItemId}`)
  if (ISO_DATE.test(date)) {
    revalidatePath(`/equipment/vehicle-log?month=${date.slice(0, 7)}`)
  }
}
