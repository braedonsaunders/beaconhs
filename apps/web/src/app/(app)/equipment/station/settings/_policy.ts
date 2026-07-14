import { isUuid } from '../../../../../lib/list-params'

export type StationSettingsInput = {
  defaultCheckInOrgUnitId: string | null
  stationPin: string | null
  clearStationPin: boolean
  scanMode: 'toggle' | 'explicit'
  requireHolderOnCheckout: boolean
  requireConditionOnCheckin: boolean
  soundEnabled: boolean
}

function recordInput(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allow = new Set(allowed)
  if (Object.keys(record).some((key) => !allow.has(key))) {
    throw new Error(`${label} is invalid.`)
  }
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`)
  return value
}

export function parseStationSettingsInput(value: unknown): StationSettingsInput {
  const input = recordInput(value, 'Station settings')
  exactKeys(
    input,
    [
      'defaultCheckInOrgUnitId',
      'stationPin',
      'clearStationPin',
      'scanMode',
      'requireHolderOnCheckout',
      'requireConditionOnCheckin',
      'soundEnabled',
    ],
    'Station settings',
  )

  const rawHome = input.defaultCheckInOrgUnitId
  const home = rawHome == null || rawHome === '' ? null : rawHome
  if (home !== null && (typeof home !== 'string' || !isUuid(home))) {
    throw new Error('Default check-in location is invalid.')
  }

  const rawPin = input.stationPin
  if (rawPin !== null && typeof rawPin !== 'string') throw new Error('Kiosk PIN is invalid.')
  const pin = typeof rawPin === 'string' ? rawPin.trim() : null
  if (pin && !/^\d{4,12}$/.test(pin)) throw new Error('Kiosk PIN must be 4–12 digits.')

  const clearStationPin = bool(input.clearStationPin, 'Clear kiosk PIN setting')
  if (clearStationPin && pin) {
    throw new Error('Choose either a new kiosk PIN or disable the kiosk, not both.')
  }
  if (input.scanMode !== 'toggle' && input.scanMode !== 'explicit') {
    throw new Error('Station scan mode is invalid.')
  }

  return {
    defaultCheckInOrgUnitId: typeof home === 'string' ? home.toLowerCase() : null,
    stationPin: pin || null,
    clearStationPin,
    scanMode: input.scanMode,
    requireHolderOnCheckout: bool(input.requireHolderOnCheckout, 'Holder requirement'),
    requireConditionOnCheckin: bool(input.requireConditionOnCheckin, 'Condition requirement'),
    soundEnabled: bool(input.soundEnabled, 'Sound setting'),
  }
}

export function parseStationBaseLocationInput(value: unknown): {
  id: string
  isBase: boolean
} {
  const input = recordInput(value, 'Base location update')
  exactKeys(input, ['id', 'isBase'], 'Base location update')
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!isUuid(id)) throw new Error('Location is invalid.')
  return { id: id.toLowerCase(), isBase: bool(input.isBase, 'Base location setting') }
}
