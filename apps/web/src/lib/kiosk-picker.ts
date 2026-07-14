import { normalizeKioskPin } from '@beaconhs/db'
import { isUuid } from './list-params'
import { parseRemoteSearchInput, type RemoteSearchInput } from './remote-search-policy'

const KIOSK_PICKER_KINDS = ['person', 'site', 'crew'] as const

type KioskPickerKind = (typeof KIOSK_PICKER_KINDS)[number]

type KioskPickerInput = {
  tenantId: string
  pin: string
  kind: KioskPickerKind
  search: RemoteSearchInput
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Kiosk request is invalid.')
  }
  const record = value as Record<string, unknown>
  const allowed = new Set(keys)
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('Kiosk request is invalid.')
  }
  return record
}

function kioskAccess(record: Record<string, unknown>): { tenantId: string; pin: string } {
  if (typeof record.tenantId !== 'string' || !isUuid(record.tenantId)) {
    throw new Error('Kiosk request is invalid.')
  }
  if (typeof record.pin !== 'string') throw new Error('Kiosk request is invalid.')
  const pin = normalizeKioskPin(record.pin)
  if (!pin) throw new Error('Kiosk PIN must be 4–12 digits.')
  return { tenantId: record.tenantId.toLowerCase(), pin }
}

export function parseKioskUnlockInput(value: unknown): { tenantId: string; pin: string } {
  return kioskAccess(exactRecord(value, ['tenantId', 'pin']))
}

export function parseKioskPickerInput(value: unknown): KioskPickerInput {
  const record = exactRecord(value, ['tenantId', 'pin', 'kind', 'query', 'selected'])
  const access = kioskAccess(record)
  if (
    typeof record.kind !== 'string' ||
    !(KIOSK_PICKER_KINDS as readonly string[]).includes(record.kind)
  ) {
    throw new Error('Kiosk option type is invalid.')
  }
  return {
    ...access,
    kind: record.kind as KioskPickerKind,
    search: parseRemoteSearchInput({ query: record.query, selected: record.selected }, 'uuid'),
  }
}
