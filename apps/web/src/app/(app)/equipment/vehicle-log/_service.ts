import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { type Database, isUniqueViolation } from '@beaconhs/db'
import {
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  truckLogEntries,
  vehicleLogSettings,
  type TruckLogEntryMode,
  type TruckLogImportStatus,
  type VehicleLogEnabledModes,
} from '@beaconhs/db/schema'
import { assertCan, can, type RequestContext } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { recordAudit } from '@/lib/audit'
import {
  assertCanEditDriverLog,
  vehicleDriverScopeWhere,
  vehicleLogEntryScopeWhere,
} from './_access-policy'
import { resolveVehicleEquipmentWhere } from './_equipment-policy'
import { requireUuidInput } from '@/lib/mutation-input'
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
  totals: {
    loggedDays: number
    importSourceDays: number
    businessKm: number
    personalKm: number
    totalKm: number
  }
}

export type VehicleLogMonthInput = {
  equipmentItemId: string
  driverPersonId: string
  month: string
}

type TruckLogRow = typeof truckLogEntries.$inferSelect
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
    const [driversRaw, vehiclesRaw, sitesRaw, settingsRows] = await Promise.all([
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
        .where(
          and(
            eq(people.status, 'active'),
            isNull(people.deletedAt),
            vehicleDriverScopeWhere(ctx, people.id),
          ),
        )
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

    const requestedDriver =
      opts.driverPersonId ?? (can(ctx, 'equipment.vehicle-log.update.own') ? ctx.personId : null)
    const selectedDriver = requestedDriver
      ? (driversRaw.find((driver) => driver.id === requestedDriver) ?? null)
      : null
    const selectedVehicle = opts.equipmentItemId
      ? (vehiclesRaw.find((v) => v.id === opts.equipmentItemId) ?? null)
      : null
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
        totals: {
          loggedDays: 0,
          importSourceDays: 0,
          businessKm: 0,
          personalKm: 0,
          totalKm: 0,
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
    let importSourceDays = 0
    for (let day = 1; day <= dim; day++) {
      const date = dateKey(year, month, day)
      const dateObj = new Date(`${date}T00:00:00`)
      const entry = entryDraft(entryByDate.get(date) ?? null, date, mode)
      if (entry.importStatus === 'imported') importSourceDays += 1
      businessKm += entry.businessKm ?? 0
      personalKm += entry.personalKm ?? 0
      totalKm += entry.totalKm ?? 0
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
      totals: {
        loggedDays: entries.length,
        importSourceDays,
        businessKm,
        personalKm,
        totalKm,
      },
    }
  })
  return result
}

export async function upsertVehicleLogEntry(ctx: RequestContext, input: SaveVehicleLogEntryInput) {
  const normalized = normalizeVehicleLogEntryInput(input)
  assertCanEditDriverLog(ctx, normalized.driverPersonId)
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
    const { where: vehicleWhere } = await resolveVehicleEquipmentWhere(ctx, tx)
    const [existing] = await tx
      .select({
        id: truckLogEntries.id,
        driverPersonId: truckLogEntries.driverPersonId,
        entryMode: truckLogEntries.entryMode,
        equipmentItemId: truckLogEntries.equipmentItemId,
      })
      .from(truckLogEntries)
      .where(and(eq(truckLogEntries.id, entryId), vehicleLogEntryScopeWhere(ctx, vehicleWhere)))
      .limit(1)
      .for('update')
    if (!existing) throw new Error('Vehicle log entry was not found.')
    assertCanEditDriverLog(ctx, existing.driverPersonId ?? '')

    const normalized = normalizeVehicleLogEntryInput({
      ...input,
      entryMode: existing.entryMode,
    })
    assertCanEditDriverLog(ctx, normalized.driverPersonId)
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
      if (isUniqueViolation(error)) {
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
    },
  })
  revalidateVehicleLogPaths(result.normalized.equipmentItemId, result.normalized.entryDate)
  if (result.existing.equipmentItemId !== result.normalized.equipmentItemId) {
    revalidatePath(`/equipment/${result.existing.equipmentItemId}`)
  }
  revalidatePath(`/equipment/vehicle-log/${entryId}`)
  return entryDraft(result.updated, result.normalized.entryDate, result.normalized.entryMode)
}

export async function deleteVehicleLogMonth(
  ctx: RequestContext,
  input: VehicleLogMonthInput,
): Promise<number> {
  assertCan(ctx, 'equipment.manage')
  const equipmentItemId = requireUuidInput(input.equipmentItemId, 'Vehicle')
  const driverPersonId = requireUuidInput(input.driverPersonId, 'Driver')
  const { year, month } = parseRequiredMonth(input.month)
  const start = dateKey(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const endExclusive = dateKey(next.year, next.month, 1)

  const ids = await ctx.db(async (tx) => {
    const { where: vehicleWhere } = await resolveVehicleEquipmentWhere(ctx, tx)
    const rows = await tx
      .select({ id: truckLogEntries.id })
      .from(truckLogEntries)
      .where(
        and(
          vehicleLogEntryScopeWhere(ctx, vehicleWhere),
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

/** Shared edit authorization for trusted extensions on the selected monthly workspace. */
export async function authorizeVehicleLogTarget(
  ctx: RequestContext,
  input: VehicleLogMonthInput,
): Promise<Record<string, string>> {
  const driverPersonId = requireUuidInput(input.driverPersonId, 'Driver')
  const equipmentItemId = requireUuidInput(input.equipmentItemId, 'Vehicle')
  const parsed = parseRequiredMonth(input.month)
  assertCanEditDriverLog(ctx, driverPersonId)
  await ctx.db(async (tx) => {
    const { where: vehicleWhere } = await resolveVehicleEquipmentWhere(ctx, tx)
    const [driver, vehicle] = await Promise.all([
      tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(eq(people.id, driverPersonId), eq(people.status, 'active'), isNull(people.deletedAt)),
        )
        .limit(1),
      tx
        .select({ id: equipmentItems.id })
        .from(equipmentItems)
        .where(and(eq(equipmentItems.id, equipmentItemId), vehicleWhere))
        .limit(1),
    ])
    if (!driver.length || !vehicle.length) throw new Error('Driver or vehicle is unavailable.')
  })
  return { driverPersonId, equipmentItemId, month: monthKey(parsed.year, parsed.month) }
}
