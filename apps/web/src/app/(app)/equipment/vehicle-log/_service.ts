import { revalidatePath } from 'next/cache'
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  syncConnections,
  truckLogEntries,
  type TruckLogEntryMode,
  type TruckLogImportStatus,
} from '@beaconhs/db/schema'
import { unsealSecret, type SealedSecret } from '@beaconhs/sync'
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

export type VehicleLogImportSource = {
  id: string
  name: string
  connectorKey: string
  connectorLabel: string
  status: string
  active: boolean
  monthRowCount: number
  matchedRowCount: number
  matchedDayCount: number
  onDemand: boolean
  description: string | null
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
  importSources: {
    configuredSourceCount: number
    activeSourceCount: number
    monthRowCount: number
    canConfigureSources: boolean
    sources: VehicleLogImportSource[]
  }
  totals: {
    loggedDays: number
    importSourceDays: number
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
  sourceExternalId?: string | null
  importStatus?: TruckLogImportStatus
  importMeta?: Record<string, unknown>
}

export type ApplyVehicleLogImportInput = {
  equipmentItemId: string
  driverPersonId: string
  month: string
  sourceConnectionId?: string | null
}

export type ApplyVehicleLogImportResult = {
  created: number
  updated: number
  conflicts: number
  skipped: number
  pulled: number
  resolved: number
}

type TruckLogRow = typeof truckLogEntries.$inferSelect
type SyncConnectionRow = Pick<
  typeof syncConnections.$inferSelect,
  'id' | 'connectorKey' | 'name' | 'status' | 'config' | 'secrets'
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

function stringValue(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s === '' ? null : s
}

type VehicleLogImportConfig = {
  kind: 'http_monthly'
  url: string
  label: string
  description: string | null
  enabled: boolean
  tokenSecretKey: string
  timeoutMs: number
}

function vehicleLogImportConfig(connection: SyncConnectionRow): VehicleLogImportConfig | null {
  const config = recordValue(connection.config)
  const vehicleLogImport = recordValue(config.vehicleLogImport)
  if (vehicleLogImport.kind !== 'http_monthly') return null

  const url = stringValue(vehicleLogImport.url)
  if (!url) return null

  return {
    kind: 'http_monthly',
    url,
    label: stringValue(vehicleLogImport.label) ?? 'External monthly source',
    description: stringValue(vehicleLogImport.description),
    enabled: vehicleLogImport.enabled !== false,
    tokenSecretKey: stringValue(vehicleLogImport.tokenSecretKey) ?? 'token',
    timeoutMs: Math.max(5_000, Math.min(120_000, Number(vehicleLogImport.timeoutMs ?? 45_000))),
  }
}

function buildImportSources(
  connections: SyncConnectionRow[],
): VehicleLogImportSource[] {
  return connections.flatMap((connection) => {
    const config = vehicleLogImportConfig(connection)
    if (!config) return []
    return {
      id: connection.id,
      name: connection.name || config.label,
      connectorKey: connection.connectorKey,
      connectorLabel: config.label,
      status: connection.status,
      active: connection.status === 'connected' && config.enabled,
      monthRowCount: 0,
      matchedRowCount: 0,
      matchedDayCount: 0,
      onDemand: true,
      description: config.description,
    }
  })
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
    const [driversRaw, vehiclesRaw, sitesRaw, connectionRows] =
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
          .where(inArray(orgUnits.level, ['customer', 'project', 'site']))
          .orderBy(asc(orgUnits.name))
          .limit(5000),
        tx
          .select({
            id: syncConnections.id,
            connectorKey: syncConnections.connectorKey,
            name: syncConnections.name,
            status: syncConnections.status,
            config: syncConnections.config,
            secrets: syncConnections.secrets,
          })
          .from(syncConnections)
          .where(isNull(syncConnections.deletedAt)),
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
    const baseImportSources = buildImportSources(connectionRows)
    const baseImportSourceMeta = {
      configuredSourceCount: baseImportSources.length,
      activeSourceCount: baseImportSources.filter((source) => source.active).length,
      monthRowCount: baseImportSources.reduce((sum, source) => sum + source.monthRowCount, 0),
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
        importSources: { ...baseImportSourceMeta, sources: baseImportSources },
        totals: {
          loggedDays: 0,
          importSourceDays: 0,
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

    const entries = await tx
      .select()
      .from(truckLogEntries)
      .where(
        and(
          eq(truckLogEntries.driverPersonId, selectedDriver.id),
          eq(truckLogEntries.equipmentItemId, selectedVehicle.id),
          gte(truckLogEntries.entryDate, start),
          lt(truckLogEntries.entryDate, endExclusive),
        ),
      )
    const importSources = buildImportSources(connectionRows)
    const importSourceMeta = {
      configuredSourceCount: importSources.length,
      activeSourceCount: importSources.filter((source) => source.active).length,
      monthRowCount: importSources.reduce((sum, source) => sum + source.monthRowCount, 0),
      canConfigureSources: can(ctx, 'admin.integrations.manage'),
    }

    const entryByDate = new Map(entries.map((entry) => [entry.entryDate, entry]))
    const rows: VehicleLogWorkspaceRow[] = []
    let businessKm = 0
    let personalKm = 0
    let totalKm = 0
    let hoursOnSite = 0
    let crewCount = 0
    let importSourceDays = 0
    let pendingActivityDays = 0
    let conflictDays = 0
    for (let day = 1; day <= dim; day++) {
      const date = dateKey(year, month, day)
      const dateObj = new Date(`${date}T00:00:00`)
      const entry = entryDraft(entryByDate.get(date) ?? null, date, mode)
      const activity = null
      if (entry.importStatus === 'imported') importSourceDays += 1
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
      importSources: { ...importSourceMeta, sources: importSources },
      totals: {
        loggedDays: entries.length,
        importSourceDays,
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

type VehicleLogImportEntry = {
  sourceExternalId: string | null
  date: string | null
  customerExternalId: string | null
  customerLegacyId: string | null
  customerCode: string | null
  customerShortform: string | null
  customerName: string | null
  sourceLabel: string | null
  businessKm: number | null
  skipReason: string | null
  raw: Record<string, unknown>
}

type ResolvedImportEntry = VehicleLogImportEntry & {
  date: string
  sourceExternalId: string
  siteOrgUnitId: string
}

type OrgUnitLookupRow = {
  id: string
  code: string | null
  name: string
  metadata: Record<string, unknown>
}

type ImportSetup = {
  driver: {
    id: string
    firstName: string
    lastName: string
    employeeNo: string | null
    externalEmployeeId: string | null
    metadata: Record<string, unknown>
  }
  equipment: {
    id: string
    assetTag: string
    name: string
    metadata: Record<string, unknown>
  }
  connection: SyncConnectionRow
  config: VehicleLogImportConfig
}

function numericValue(value: unknown): number | null {
  return typeof value === 'string' || typeof value === 'number' ? parseNumber(value) : null
}

function metadataExternalId(metadata: unknown): string | null {
  const meta = recordValue(metadata)
  return (
    stringValue(meta.netsuiteId) ??
    stringValue(meta.NetsuiteID) ??
    stringValue(meta.netSuiteId) ??
    stringValue(meta.externalEmployeeId) ??
    stringValue(meta.legacyId)
  )
}

function driverExternalId(driver: ImportSetup['driver']): string | null {
  return (
    stringValue(driver.externalEmployeeId) ??
    metadataExternalId(driver.metadata) ??
    stringValue(driver.employeeNo)
  )
}

function isSealedSecret(value: unknown): value is SealedSecret {
  const record = recordValue(value)
  return Boolean(stringValue(record.ciphertext) && stringValue(record.nonce))
}

function unsealConnectionSecret(connection: SyncConnectionRow, key: string): string | null {
  const sealed = recordValue(connection.secrets)[key]
  if (!isSealedSecret(sealed)) return null
  return unsealSecret(sealed)
}

function readImportEntry(value: unknown): VehicleLogImportEntry {
  const record = recordValue(value)
  return {
    sourceExternalId: stringValue(record.sourceExternalId),
    date: stringValue(record.date),
    customerExternalId: stringValue(record.customerExternalId),
    customerLegacyId: stringValue(record.customerLegacyId),
    customerCode: stringValue(record.customerCode),
    customerShortform: stringValue(record.customerShortform),
    customerName: stringValue(record.customerName),
    sourceLabel: stringValue(record.sourceLabel),
    businessKm: numericValue(record.businessKm),
    skipReason: stringValue(record.skipReason),
    raw: recordValue(record.raw),
  }
}

function sourceStat(stats: Record<string, unknown>, key: string, fallback: number): number {
  const value = numericValue(stats[key])
  return value == null ? fallback : value
}

function normalizeLookupKey(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase()
  return text ? text : null
}

function addLookup(map: Map<string, string>, key: string | null | undefined, id: string) {
  const normalized = normalizeLookupKey(key)
  if (normalized && !map.has(normalized)) map.set(normalized, id)
}

function resolveSiteOrgUnitId(
  entry: VehicleLogImportEntry,
  maps: {
    byCode: Map<string, string>
    byName: Map<string, string>
    byExternalId: Map<string, string>
  },
): string | null {
  const externalId = entry.customerExternalId
  const codeCandidates = [
    entry.customerCode,
    entry.customerLegacyId,
    entry.customerShortform,
    externalId,
    entry.customerLegacyId ? `C2-${entry.customerLegacyId}` : null,
    entry.customerCode ? `C2-${entry.customerCode}` : null,
    externalId ? `C2-${externalId}` : null,
  ]
  for (const code of codeCandidates) {
    const id = maps.byCode.get(normalizeLookupKey(code) ?? '')
    if (id) return id
  }
  for (const external of [entry.customerExternalId, entry.customerLegacyId]) {
    const id = maps.byExternalId.get(normalizeLookupKey(external) ?? '')
    if (id) return id
  }
  return maps.byName.get(normalizeLookupKey(entry.customerName) ?? '') ?? null
}

function buildOrgUnitMaps(rows: OrgUnitLookupRow[]) {
  const byCode = new Map<string, string>()
  const byName = new Map<string, string>()
  const byExternalId = new Map<string, string>()
  for (const row of rows) {
    addLookup(byCode, row.code, row.id)
    addLookup(byName, row.name, row.id)
    const metadata = recordValue(row.metadata)
    for (const key of ['netsuiteId', 'NetsuiteID', 'netSuiteId', 'legacyId', 'externalId']) {
      addLookup(byExternalId, stringValue(metadata[key]), row.id)
    }
  }
  return { byCode, byName, byExternalId }
}

async function loadImportSetup(
  ctx: RequestContext,
  input: ApplyVehicleLogImportInput,
): Promise<ImportSetup> {
  return ctx.db(async (tx) => {
    const [drivers, equipment, connections] = await Promise.all([
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
          externalEmployeeId: people.externalEmployeeId,
          metadata: people.metadata,
        })
        .from(people)
        .where(eq(people.id, input.driverPersonId))
        .limit(1),
      tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
          metadata: equipmentItems.metadata,
        })
        .from(equipmentItems)
        .where(eq(equipmentItems.id, input.equipmentItemId))
        .limit(1),
      tx
        .select({
          id: syncConnections.id,
          connectorKey: syncConnections.connectorKey,
          name: syncConnections.name,
          status: syncConnections.status,
          config: syncConnections.config,
          secrets: syncConnections.secrets,
        })
        .from(syncConnections)
        .where(isNull(syncConnections.deletedAt)),
    ])
    const driver = drivers[0]
    if (!driver) throw new Error('Driver was not found.')
    const vehicle = equipment[0]
    if (!vehicle) throw new Error('Vehicle was not found.')

    const configured = connections
      .map((connection) => ({ connection, config: vehicleLogImportConfig(connection) }))
      .filter((row): row is { connection: SyncConnectionRow; config: VehicleLogImportConfig } =>
        Boolean(row.config),
      )
    const active = configured.filter(
      ({ connection, config }) => connection.status === 'connected' && config.enabled,
    )
    const selected = input.sourceConnectionId
      ? configured.find(({ connection }) => connection.id === input.sourceConnectionId)
      : active.length === 1
        ? active[0]
        : null
    if (!selected) {
      if (active.length > 1) throw new Error('Choose an import source.')
      throw new Error('No active vehicle log import source is configured.')
    }
    if (selected.connection.status !== 'connected' || !selected.config.enabled) {
      throw new Error(`${selected.connection.name} is not active.`)
    }

    return {
      driver: { ...driver, metadata: recordValue(driver.metadata) },
      equipment: { ...vehicle, metadata: recordValue(vehicle.metadata) },
      connection: selected.connection,
      config: selected.config,
    }
  })
}

async function fetchVehicleLogImport(
  setup: ImportSetup,
  input: ApplyVehicleLogImportInput,
): Promise<{
  entries: VehicleLogImportEntry[]
  pulled: number
  resolved: number
  source: Record<string, unknown>
}> {
  const externalId = driverExternalId(setup.driver)
  if (!externalId) {
    throw new Error('The selected driver does not have an external employee ID for this source.')
  }
  const token = unsealConnectionSecret(setup.connection, setup.config.tokenSecretKey)
  if (!token) {
    throw new Error(`${setup.connection.name} is missing its import token.`)
  }

  const response = await fetch(setup.config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      month: input.month,
      employeeExternalId: externalId,
      driver: {
        id: setup.driver.id,
        firstName: setup.driver.firstName,
        lastName: setup.driver.lastName,
        employeeNo: setup.driver.employeeNo,
        externalEmployeeId: externalId,
      },
      equipment: {
        id: setup.equipment.id,
        assetTag: setup.equipment.assetTag,
        name: setup.equipment.name,
      },
    }),
    signal: AbortSignal.timeout(setup.config.timeoutMs),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `${setup.connection.name} import failed (${response.status}): ${text.slice(0, 240)}`,
    )
  }

  const payload = recordValue(await response.json())
  const rawEntries = Array.isArray(payload.entries) ? payload.entries : []
  const entries = rawEntries.map(readImportEntry)
  const stats = recordValue(payload.stats)
  return {
    entries,
    pulled: sourceStat(stats, 'pulled', rawEntries.length),
    resolved: sourceStat(stats, 'resolved', entries.filter((entry) => !entry.skipReason).length),
    source: recordValue(payload.source),
  }
}

function importedMeta(
  entry: ResolvedImportEntry,
  source: Record<string, unknown>,
): Record<string, unknown> {
  return {
    source,
    sourceLabel: entry.sourceLabel,
    customerExternalId: entry.customerExternalId,
    customerLegacyId: entry.customerLegacyId,
    customerCode: entry.customerCode,
    customerShortform: entry.customerShortform,
    customerName: entry.customerName,
    raw: entry.raw,
  }
}

export async function applyVehicleLogImportToVehicleLog(
  ctx: RequestContext,
  input: ApplyVehicleLogImportInput,
): Promise<ApplyVehicleLogImportResult> {
  if (!input.equipmentItemId || !input.driverPersonId) {
    throw new Error('Vehicle and driver are required.')
  }
  const { year, month } = parseMonth(input.month)
  const monthKeyValue = monthKey(year, month)
  const start = dateKey(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)

  const setup = await loadImportSetup(ctx, input)
  const imported = await fetchVehicleLogImport(setup, { ...input, month: monthKeyValue })

  const result = await ctx.db(async (tx) => {
    const [siteRows, existingEntries] = await Promise.all([
      tx
        .select({
          id: orgUnits.id,
          code: orgUnits.code,
          name: orgUnits.name,
          metadata: orgUnits.metadata,
        })
        .from(orgUnits)
        .where(inArray(orgUnits.level, ['customer', 'project', 'site']))
        .limit(5000),
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
    const siteMaps = buildOrgUnitMaps(siteRows.map((row) => ({ ...row, metadata: row.metadata })))
    const byDate = new Map<string, ResolvedImportEntry>()
    let skipped = 0
    for (const entry of imported.entries) {
      if (!entry.date || !ISO_DATE.test(entry.date) || entry.date < start || entry.date >= endExclusive) {
        skipped += 1
        continue
      }
      if (!entry.sourceExternalId) {
        skipped += 1
        continue
      }
      if (entry.skipReason || entry.businessKm == null || entry.businessKm <= 0) {
        skipped += 1
        continue
      }
      const siteOrgUnitId = resolveSiteOrgUnitId(entry, siteMaps)
      if (!siteOrgUnitId) {
        skipped += 1
        continue
      }
      byDate.set(entry.date, {
        ...entry,
        date: entry.date,
        sourceExternalId: entry.sourceExternalId,
        siteOrgUnitId,
      })
    }

    const existingByDate = new Map(existingEntries.map((entry) => [entry.entryDate, entry]))
    let created = 0
    let updated = 0
    let conflicts = 0

    for (const entry of byDate.values()) {
      const existing = existingByDate.get(entry.date)
      const personalKm = existing?.personalKm ?? null
      const kmDriven = computeTotalKm({
        entryMode: 'destination',
        businessKm: entry.businessKm,
        personalKm,
      })
      const values = {
        tenantId: ctx.tenantId,
        equipmentItemId: input.equipmentItemId,
        driverPersonId: input.driverPersonId,
        entryDate: entry.date,
        entryMode: 'destination' as const,
        startOdometer: null,
        endOdometer: null,
        kmDriven,
        businessKm: entry.businessKm,
        personalKm,
        siteOrgUnitId: entry.siteOrgUnitId,
        otherDestination: null,
        hoursOnSite: existing?.hoursOnSite ?? null,
        manpowerCount: existing?.manpowerCount ?? null,
        notes: existing?.notes ?? null,
        sourceConnectionId: setup.connection.id,
        sourceExternalId: entry.sourceExternalId,
        importStatus: 'imported' as const,
        importedAt: new Date(),
        importMeta: importedMeta(entry, imported.source),
        createdByTenantUserId: existing?.createdByTenantUserId ?? ctx.membership?.id ?? null,
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

    return { created, updated, conflicts, skipped, pulled: imported.pulled, resolved: byDate.size }
  })

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: input.equipmentItemId,
    action: 'update',
    summary: `Imported ${result.created + result.updated} vehicle log day(s) from ${setup.connection.name}`,
    after: { ...input, sourceConnectionId: setup.connection.id, ...result },
    metadata: { operation: 'vehicle_log_import' },
  })
  revalidatePath('/equipment/vehicle-log')
  revalidatePath(`/equipment/${input.equipmentItemId}`)
  return result
}

export async function deleteVehicleLogMonth(
  ctx: RequestContext,
  input: ApplyVehicleLogImportInput,
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
