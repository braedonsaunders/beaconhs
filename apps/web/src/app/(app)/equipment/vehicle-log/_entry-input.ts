import {
  optionalNumberInput,
  optionalTextInput,
  optionalUuidInput,
  requiredDateInput,
  requireEnumInput,
  requireRecordInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'

export const VEHICLE_LOG_MODES = ['destination', 'odometer'] as const
export type VehicleLogMode = (typeof VEHICLE_LOG_MODES)[number]

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
}

export type NormalizedVehicleLogEntryInput = {
  equipmentItemId: string
  driverPersonId: string
  entryDate: string
  entryMode: VehicleLogMode
  startOdometer: number | null
  endOdometer: number | null
  businessKm: number | null
  personalKm: number | null
  siteOrgUnitId: string | null
  otherDestination: string | null
  hoursOnSite: string | null
  manpowerCount: number | null
  notes: string | null
}

const KM_BOUNDS = { min: 0, max: 2_147_483_647, integer: true } as const

export function normalizeVehicleLogEntryInput(value: unknown): NormalizedVehicleLogEntryInput {
  const input = requireRecordInput(value, 'Vehicle log request')
  const startOdometer = optionalNumberInput(input.startOdometer, 'Start odometer', KM_BOUNDS)
  const endOdometer = optionalNumberInput(input.endOdometer, 'End odometer', KM_BOUNDS)
  if (startOdometer != null && endOdometer != null && endOdometer < startOdometer) {
    throw new Error('End odometer cannot be less than start odometer.')
  }
  const hours = optionalNumberInput(input.hoursOnSite, 'Hours on site', {
    min: 0,
    max: 24,
    maxScale: 2,
  })

  return {
    equipmentItemId: requireUuidInput(input.equipmentItemId, 'Equipment item'),
    driverPersonId: requireUuidInput(input.driverPersonId, 'Driver'),
    entryDate: requiredDateInput(input.entryDate, 'Entry date'),
    entryMode: requireEnumInput(input.entryMode, VEHICLE_LOG_MODES, 'Entry mode'),
    startOdometer,
    endOdometer,
    businessKm: optionalNumberInput(input.businessKm, 'Business km', KM_BOUNDS),
    personalKm: optionalNumberInput(input.personalKm, 'Personal km', KM_BOUNDS),
    siteOrgUnitId: optionalUuidInput(input.siteOrgUnitId, 'Customer or site'),
    otherDestination: optionalTextInput(input.otherDestination, 'Other destination', 500),
    hoursOnSite: hours == null ? null : hours.toFixed(2),
    manpowerCount: optionalNumberInput(input.manpowerCount, 'Crew count', {
      min: 0,
      max: 100_000,
      integer: true,
    }),
    notes: optionalTextInput(input.notes, 'Notes', 5_000),
  }
}
