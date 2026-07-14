import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  syncConnections,
  truckLogEntries,
  vehicleLogSettings,
  type TruckLogEntryMode,
  type TruckLogImportStatus,
  type VehicleLogEnabledModes,
} from '@beaconhs/db/schema'
import { secureFetch, unsealSecret, type SealedSecret } from '@beaconhs/sync'
import { can, type RequestContext } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { recordAudit } from '@/lib/audit'
import {
  assertVehicleLogImportPayload,
  collectVehicleLogOrgUnitCandidates,
  normalizeVehicleLogImportUrl,
  prepareVehicleLogImportDays,
  validateVehicleLogImportEndpoint,
} from '@/lib/vehicle-log-import-policy'
import { resolveVehicleEquipmentWhere } from './_equipment-policy'
import { optionalUuidInput, requireUuidInput } from '@/lib/mutation-input'
import {
  normalizeVehicleLogEntryInput,
  type NormalizedVehicleLogEntryInput,
  type SaveVehicleLogEntryInput,
  type VehicleLogMode,
} from './_entry-input'

export type { SaveVehicleLogEntryInput, VehicleLogMode } from './_entry-input'

type VehicleLogSelectorOption = {
  id: string
  label: string
  hint?: string | null
}

type VehicleLogImportSource = {
  id: string
  name: string
  connectorKey: string
  connectorLabel: string
  status: string
  active: boolean
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

type VehicleLogWorkspaceRow = {
  date: string
  day: number
  weekday: string
  isWeekend: boolean
  entry: VehicleLogEntryDraft
}

// Tenant mode configuration resolved for the workspace: which modes the
// segmented toggle offers, and where an unset URL mode lands (per-driver
// metadata override first, then the tenant default).
type VehicleLogModeConfig = {
  enabledModes: VehicleLogMode[]
  defaultMode: VehicleLogMode
}

function parseVehicleLogMode(raw: unknown): VehicleLogMode | null {
  return raw === 'odometer' || raw === 'destination' ? raw : null
}

function modeConfigFromRow(
  row: { enabledModes: VehicleLogEnabledModes; defaultMode: TruckLogEntryMode } | null | undefined,
): VehicleLogModeConfig {
  const enabledModes: VehicleLogMode[] =
    row?.enabledModes === 'destination'
      ? ['destination']
      : row?.enabledModes === 'odometer'
        ? ['odometer']
        : ['destination', 'odometer']
  const preferred = row?.defaultMode ?? 'destination'
  const fallback = enabledModes[0] ?? 'destination'
  return {
    enabledModes,
    defaultMode: enabledModes.includes(preferred) ? preferred : fallback,
  }
}

/** A driver's own default mode (people.metadata.vehicleLogMode), if valid. */
export function driverVehicleLogMode(metadata: unknown): VehicleLogMode | null {
  return parseVehicleLogMode(recordValue(metadata).vehicleLogMode)
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
  /** Modes the tenant has enabled — drives the segmented toggle. */
  modeOptions: VehicleLogMode[]
  selectedDriverId: string
  selectedEquipmentId: string
  drivers: VehicleLogSelectorOption[]
  vehicles: VehicleLogSelectorOption[]
  sites: VehicleLogSelectorOption[]
  rows: VehicleLogWorkspaceRow[]
  importSources: {
    configuredSourceCount: number
    activeSourceCount: number
    canConfigureSources: boolean
    sources: VehicleLogImportSource[]
  }
  totals: {
    loggedDays: number
    importSourceDays: number
    businessKm: number
    personalKm: number
    totalKm: number
    hoursOnSite: number
    crewCount: number
  }
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

function monthKey(year: number, month: number) {
  return `${year}-${pad2(month)}`
}

function parseMonth(raw: string | null | undefined): { year: number; month: number } {
  if (raw && MONTH.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function parseRequiredMonth(raw: unknown): { year: number; month: number } {
  const normalized = typeof raw === 'string' ? raw.trim() : ''
  if (!MONTH.test(normalized)) throw new Error('Vehicle log month is invalid.')
  const [year, month] = normalized.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('Vehicle log month is invalid.')
  }
  return { year, month }
}

function shiftMonth(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta
  const nextYear = Math.floor(total / 12)
  const nextMonth = (total % 12) + 1
  return { year: nextYear, month: nextMonth }
}

function dateKey(year: number, month: number, day: number) {
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

  const rawUrl = stringValue(vehicleLogImport.url)
  if (!rawUrl) return null
  const url = normalizeVehicleLogImportUrl(rawUrl)

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

function buildImportSources(connections: SyncConnectionRow[]): VehicleLogImportSource[] {
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
  // Odometer mode mirrors the legacy simple log: total is strictly end − start.
  // Personal km rides along as its own column and never feeds the total.
  if (input.entryMode === 'odometer') {
    if (
      typeof input.startOdometer === 'number' &&
      typeof input.endOdometer === 'number' &&
      input.endOdometer >= input.startOdometer
    ) {
      return input.endOdometer - input.startOdometer
    }
    return null
  }
  if (input.businessKm != null || input.personalKm != null) {
    return (input.businessKm ?? 0) + (input.personalKm ?? 0)
  }
  return null
}

async function assertManualVehicleLogReferences(
  ctx: RequestContext,
  tx: Database,
  input: Pick<
    NormalizedVehicleLogEntryInput,
    'equipmentItemId' | 'driverPersonId' | 'siteOrgUnitId'
  >,
): Promise<void> {
  const { where: vehicleWhere } = await resolveVehicleEquipmentWhere(ctx, tx)
  const [vehicle] = await tx
    .select({ id: equipmentItems.id })
    .from(equipmentItems)
    .where(and(vehicleWhere, eq(equipmentItems.id, input.equipmentItemId)))
    .limit(1)
  if (!vehicle) throw new Error('Vehicle was not found or is outside your equipment scope.')

  const [driver] = await tx
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.id, input.driverPersonId),
        eq(people.status, 'active'),
        isNull(people.deletedAt),
      ),
    )
    .limit(1)
  if (!driver) throw new Error('Select an active driver.')

  if (input.siteOrgUnitId) {
    const [site] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.id, input.siteOrgUnitId),
          eq(orgUnits.level, 'customer'),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1)
    if (!site) throw new Error('Select an active customer.')
  }
}

function manualEntryFields(input: NormalizedVehicleLogEntryInput) {
  const {
    entryMode,
    startOdometer,
    endOdometer,
    businessKm,
    personalKm,
    siteOrgUnitId,
    otherDestination,
    hoursOnSite,
    manpowerCount,
    notes,
  } = input
  const kmDriven = computeTotalKm({ entryMode, startOdometer, endOdometer, businessKm, personalKm })
  return {
    entryMode,
    startOdometer: entryMode === 'odometer' ? startOdometer : null,
    endOdometer: entryMode === 'odometer' ? endOdometer : null,
    kmDriven,
    businessKm: entryMode === 'destination' ? businessKm : null,
    personalKm,
    siteOrgUnitId,
    otherDestination,
    hoursOnSite,
    manpowerCount,
    notes,
  }
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
  const requestedMode = parseVehicleLogMode(opts.mode)

  const result = await ctx.db(async (tx) => {
    const { where: vehicleWhere } = await resolveVehicleEquipmentWhere(ctx, tx)
    const [driversRaw, vehiclesRaw, sitesRaw, connectionRows, settingsRows] = await Promise.all([
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
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName)),
      tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
          category: equipmentCategories.name,
          typeName: equipmentTypes.name,
        })
        .from(equipmentItems)
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
        .where(vehicleWhere)
        .orderBy(asc(equipmentItems.assetTag)),
      // The Customer / site picker offers TOP-LEVEL locations only (legacy
      // logged against the customer, never a project/site).
      tx
        .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'customer'))
        .orderBy(asc(orgUnits.name)),
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
      tx
        .select({
          enabledModes: vehicleLogSettings.enabledModes,
          defaultMode: vehicleLogSettings.defaultMode,
        })
        .from(vehicleLogSettings)
        .where(eq(vehicleLogSettings.tenantId, ctx.tenantId))
        .limit(1),
    ])
    const modeConfig = modeConfigFromRow(settingsRows[0])

    const drivers = driversRaw.map((p) => ({
      id: p.id,
      label: `${p.lastName}, ${p.firstName}`,
      hint: p.employeeNo ?? p.externalEmployeeId,
    }))
    const vehicles = vehiclesRaw.map((v) => ({
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
      ? (vehiclesRaw.find((v) => v.id === opts.equipmentItemId) ?? null)
      : null
    const importSources = buildImportSources(connectionRows)
    const importSourceMeta = {
      configuredSourceCount: importSources.length,
      activeSourceCount: importSources.filter((source) => source.active).length,
      canConfigureSources: can(ctx, 'admin.integrations.manage'),
    }

    // URL mode wins when enabled; otherwise the driver's own default
    // (people.metadata), then the tenant default. Disabled modes never render.
    const driverDefault = selectedDriver ? driverVehicleLogMode(selectedDriver.metadata) : null
    const mode: VehicleLogMode =
      (requestedMode && modeConfig.enabledModes.includes(requestedMode) ? requestedMode : null) ??
      (driverDefault && modeConfig.enabledModes.includes(driverDefault) ? driverDefault : null) ??
      modeConfig.defaultMode

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
        modeOptions: modeConfig.enabledModes,
        selectedDriverId: selectedDriver?.id ?? '',
        selectedEquipmentId: selectedVehicle?.id ?? '',
        drivers,
        vehicles,
        sites,
        rows: [],
        importSources: { ...importSourceMeta, sources: importSources },
        totals: {
          loggedDays: 0,
          importSourceDays: 0,
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
    const entryByDate = new Map(entries.map((entry) => [entry.entryDate, entry]))
    const rows: VehicleLogWorkspaceRow[] = []
    let businessKm = 0
    let personalKm = 0
    let totalKm = 0
    let hoursOnSite = 0
    let crewCount = 0
    let importSourceDays = 0
    for (let day = 1; day <= dim; day++) {
      const date = dateKey(year, month, day)
      const dateObj = new Date(`${date}T00:00:00`)
      const entry = entryDraft(entryByDate.get(date) ?? null, date, mode)
      if (entry.importStatus === 'imported') importSourceDays += 1
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
      modeOptions: modeConfig.enabledModes,
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
  const normalized = normalizeVehicleLogEntryInput(input)
  const { equipmentItemId, driverPersonId, entryDate, entryMode } = normalized
  const fields = {
    ...manualEntryFields(normalized),
    sourceConnectionId: null,
    sourceExternalId: null,
    importStatus: 'manual' as const,
    importedAt: null,
    importMeta: {},
  }

  const row = await ctx.db(async (tx) => {
    await assertManualVehicleLogReferences(ctx, tx, normalized)

    const [inserted] = await tx
      .insert(truckLogEntries)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId,
        driverPersonId,
        entryDate,
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
    if (inserted) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: inserted.id,
        moduleKey: 'vehicle-log',
        event: 'on_submit',
        occurrenceKey: randomUUID(),
      })
    }
    return inserted
  })
  if (!row) throw new Error('Failed to save vehicle log entry.')

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: row.id,
    action: 'update',
    summary: `Saved vehicle log for ${entryDate}`,
    after: {
      equipmentItemId,
      driverPersonId,
      entryDate,
      kmDriven: fields.kmDriven,
      importStatus: 'manual',
    },
    metadata: { operation: 'upsert' },
  })
  revalidateVehicleLogPaths(equipmentItemId, entryDate)
  return entryDraft(row, entryDate, entryMode)
}

export async function updateVehicleLogEntry(
  ctx: RequestContext,
  entryIdValue: unknown,
  input: SaveVehicleLogEntryInput,
): Promise<VehicleLogEntryDraft> {
  const entryId = requireUuidInput(entryIdValue, 'Vehicle log entry')
  const result = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({
        id: truckLogEntries.id,
        entryMode: truckLogEntries.entryMode,
        equipmentItemId: truckLogEntries.equipmentItemId,
      })
      .from(truckLogEntries)
      .where(eq(truckLogEntries.id, entryId))
      .limit(1)
      .for('update')
    if (!existing) throw new Error('Vehicle log entry was not found.')

    const normalized = normalizeVehicleLogEntryInput({
      ...input,
      entryMode: existing.entryMode,
    })
    await assertManualVehicleLogReferences(ctx, tx, normalized)
    const fields = manualEntryFields(normalized)
    let updated: typeof truckLogEntries.$inferSelect | undefined
    try {
      const rows = await tx
        .update(truckLogEntries)
        .set({
          equipmentItemId: normalized.equipmentItemId,
          driverPersonId: normalized.driverPersonId,
          entryDate: normalized.entryDate,
          ...fields,
        })
        .where(eq(truckLogEntries.id, entryId))
        .returning()
      updated = rows[0]
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new Error(
          'An entry already exists for that vehicle, driver, and date. Edit that entry instead.',
        )
      }
      throw error
    }
    if (!updated) throw new Error('Vehicle log entry was not updated.')
    return { existing, normalized, updated }
  })

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: entryId,
    action: 'update',
    summary: `Updated entry for ${result.normalized.entryDate}`,
    after: {
      equipmentItemId: result.normalized.equipmentItemId,
      driverPersonId: result.normalized.driverPersonId,
      entryDate: result.normalized.entryDate,
      kmDriven: result.updated.kmDriven,
      manpowerCount: result.normalized.manpowerCount,
      hoursOnSite: result.normalized.hoursOnSite,
    },
  })
  revalidateVehicleLogPaths(result.normalized.equipmentItemId, result.normalized.entryDate)
  if (result.existing.equipmentItemId !== result.normalized.equipmentItemId) {
    revalidatePath(`/equipment/${result.existing.equipmentItemId}`)
  }
  revalidatePath(`/equipment/vehicle-log/${entryId}`)
  return entryDraft(result.updated, result.normalized.entryDate, result.normalized.entryMode)
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

function orgUnitLookupPredicates(
  candidates: ReturnType<typeof collectVehicleLogOrgUnitCandidates>,
): SQL[] {
  const predicates: SQL[] = []
  if (candidates.codes.length > 0) {
    predicates.push(inArray(sql<string>`lower(${orgUnits.code})`, candidates.codes))
  }
  if (candidates.names.length > 0) {
    predicates.push(inArray(sql<string>`lower(${orgUnits.name})`, candidates.names))
  }
  if (candidates.externalIds.length > 0) {
    for (const key of ['netsuiteId', 'NetsuiteID', 'netSuiteId', 'legacyId', 'externalId']) {
      predicates.push(
        inArray(
          sql<string>`lower(coalesce(${orgUnits.metadata} ->> ${key}, ''))`,
          candidates.externalIds,
        ),
      )
    }
  }
  return predicates
}

async function loadImportSetup(
  ctx: RequestContext,
  input: ApplyVehicleLogImportInput,
): Promise<ImportSetup> {
  return ctx.db(async (tx) => {
    const connectionWhere = input.sourceConnectionId
      ? and(isNull(syncConnections.deletedAt), eq(syncConnections.id, input.sourceConnectionId))
      : and(
          isNull(syncConnections.deletedAt),
          eq(syncConnections.status, 'connected'),
          sql`${syncConnections.config} -> 'vehicleLogImport' ->> 'kind' = 'http_monthly'`,
          sql`coalesce(${syncConnections.config} -> 'vehicleLogImport' ->> 'enabled', 'true') <> 'false'`,
        )
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
        .where(connectionWhere)
        .limit(input.sourceConnectionId ? 1 : 2),
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
  source: Record<string, unknown>
}> {
  const externalId = driverExternalId(setup.driver)
  if (!externalId) {
    throw new Error('The selected driver does not have an external employee ID for this source.')
  }
  const endpoint = await validateVehicleLogImportEndpoint(setup.config.url)
  const token = unsealConnectionSecret(setup.connection, setup.config.tokenSecretKey)
  if (!token) {
    throw new Error(`${setup.connection.name} is missing its import token.`)
  }

  const body = JSON.stringify({
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
  })
  const response = await secureFetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
    timeoutMs: setup.config.timeoutMs,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 4 * 1024 * 1024,
    maxRedirects: 1,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `${setup.connection.name} import failed (${response.status}): ${text.slice(0, 240)}`,
    )
  }

  const payload: unknown = await response.json()
  assertVehicleLogImportPayload(payload)
  const rawEntries = payload.entries
  const entries = rawEntries.map(readImportEntry)
  const stats = recordValue(payload.stats)
  return {
    entries,
    pulled: sourceStat(stats, 'pulled', rawEntries.length),
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
  const parsedMonth = parseRequiredMonth(input.month)
  const normalizedInput: ApplyVehicleLogImportInput = {
    equipmentItemId: requireUuidInput(input.equipmentItemId, 'Vehicle'),
    driverPersonId: requireUuidInput(input.driverPersonId, 'Driver'),
    month: monthKey(parsedMonth.year, parsedMonth.month),
    sourceConnectionId: optionalUuidInput(input.sourceConnectionId, 'Import source'),
  }
  const { year, month } = parseRequiredMonth(normalizedInput.month)
  const monthKeyValue = monthKey(year, month)
  const start = dateKey(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)

  const setup = await loadImportSetup(ctx, normalizedInput)
  const imported = await fetchVehicleLogImport(setup, {
    ...normalizedInput,
    month: monthKeyValue,
  })
  const prepared = prepareVehicleLogImportDays(imported.entries, start, endExclusive)
  const candidates = collectVehicleLogOrgUnitCandidates(prepared.entries)
  const lookupPredicates = orgUnitLookupPredicates(candidates)

  const result = await ctx.db(async (tx) => {
    const matchingOrgUnits =
      lookupPredicates.length > 0
        ? tx
            .select({
              id: orgUnits.id,
              code: orgUnits.code,
              name: orgUnits.name,
              metadata: orgUnits.metadata,
            })
            .from(orgUnits)
            .where(
              and(
                inArray(orgUnits.level, ['customer', 'project', 'site']),
                or(...lookupPredicates),
              ),
            )
            .orderBy(
              sql`case ${orgUnits.level} when 'site' then 0 when 'project' then 1 else 2 end`,
              asc(orgUnits.name),
              asc(orgUnits.id),
            )
        : Promise.resolve([])
    const [siteRows, existingEntries] = await Promise.all([
      matchingOrgUnits,
      tx
        .select()
        .from(truckLogEntries)
        .where(
          and(
            eq(truckLogEntries.driverPersonId, normalizedInput.driverPersonId),
            eq(truckLogEntries.equipmentItemId, normalizedInput.equipmentItemId),
            gte(truckLogEntries.entryDate, start),
            lt(truckLogEntries.entryDate, endExclusive),
          ),
        ),
    ])
    const siteMaps = buildOrgUnitMaps(siteRows.map((row) => ({ ...row, metadata: row.metadata })))
    const byDate = new Map<string, ResolvedImportEntry>()
    let skipped = prepared.skipped
    for (const entry of prepared.entries) {
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
        equipmentItemId: normalizedInput.equipmentItemId,
        driverPersonId: normalizedInput.driverPersonId,
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

    return { created, updated, skipped, pulled: imported.pulled, resolved: byDate.size }
  })

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: normalizedInput.equipmentItemId,
    action: 'update',
    summary: `Imported ${result.created + result.updated} vehicle log day(s) from ${setup.connection.name}`,
    after: { ...normalizedInput, sourceConnectionId: setup.connection.id, ...result },
    metadata: { operation: 'vehicle_log_import' },
  })
  revalidatePath('/equipment/vehicle-log')
  revalidatePath(`/equipment/${normalizedInput.equipmentItemId}`)
  return result
}

export async function deleteVehicleLogMonth(
  ctx: RequestContext,
  input: ApplyVehicleLogImportInput,
): Promise<number> {
  const equipmentItemId = requireUuidInput(input.equipmentItemId, 'Vehicle')
  const driverPersonId = requireUuidInput(input.driverPersonId, 'Driver')
  const { year, month } = parseRequiredMonth(input.month)
  const start = dateKey(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)

  const ids = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: truckLogEntries.id })
      .from(truckLogEntries)
      .where(
        and(
          eq(truckLogEntries.driverPersonId, driverPersonId),
          eq(truckLogEntries.equipmentItemId, equipmentItemId),
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
      entityId: equipmentItemId,
      action: 'delete',
      summary: `Deleted ${ids.length} vehicle log entries for ${input.month}`,
      before: { equipmentItemId, driverPersonId, month: monthKey(year, month) },
      metadata: { operation: 'delete_month', deletedCount: ids.length },
    })
    revalidateVehicleLogPaths(equipmentItemId, start)
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
