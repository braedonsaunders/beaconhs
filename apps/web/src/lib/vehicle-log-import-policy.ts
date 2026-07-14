import { resolvePublicHost, validateOutboundRequestConfiguration } from '@beaconhs/sync/egress'

export const VEHICLE_LOG_IMPORT_LIMITS = {
  entries: 1_000,
  identifierChars: 255,
  labelChars: 500,
  reasonChars: 1_000,
  rawEntryBytes: 32 * 1_024,
  sourceBytes: 32 * 1_024,
  statsBytes: 8 * 1_024,
} as const

const IDENTIFIER_FIELDS = [
  'sourceExternalId',
  'customerExternalId',
  'customerLegacyId',
  'customerCode',
  'customerShortform',
] as const

type VehicleLogImportDayCandidate = {
  date: string | null
  sourceExternalId: string | null
  businessKm: number | null
  skipReason: string | null
}

type PreparedVehicleLogImportDay<T extends VehicleLogImportDayCandidate> = T & {
  date: string
  sourceExternalId: string
  businessKm: number
}

type VehicleLogOrgMatchCandidate = {
  customerExternalId: string | null
  customerLegacyId: string | null
  customerCode: string | null
  customerShortform: string | null
  customerName: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function jsonBytes(value: unknown, label: string, maxBytes: number): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes.toLocaleString()} byte limit.`)
  }
}

function boundedScalar(value: unknown, label: string, maxChars: number): void {
  if (value === null || value === undefined) return
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} must be text or a number.`)
  }
  if (String(value).trim().length > maxChars) {
    throw new Error(`${label} exceeds the ${maxChars.toLocaleString()} character limit.`)
  }
}

function normalizeLookupKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function addCandidate(set: Set<string>, value: string | null | undefined): void {
  const normalized = normalizeLookupKey(value)
  if (normalized) set.add(normalized)
}

/** Return only the exact normalized identifiers that can satisfy the import matcher. */
export function collectVehicleLogOrgUnitCandidates(entries: VehicleLogOrgMatchCandidate[]): {
  codes: string[]
  names: string[]
  externalIds: string[]
} {
  const codes = new Set<string>()
  const names = new Set<string>()
  const externalIds = new Set<string>()
  for (const entry of entries) {
    const externalId = entry.customerExternalId
    const normalizedLegacyId = normalizeLookupKey(entry.customerLegacyId)
    const normalizedCode = normalizeLookupKey(entry.customerCode)
    const normalizedExternalId = normalizeLookupKey(externalId)
    for (const code of [
      entry.customerCode,
      entry.customerLegacyId,
      entry.customerShortform,
      externalId,
      normalizedLegacyId ? `c2-${normalizedLegacyId}` : null,
      normalizedCode ? `c2-${normalizedCode}` : null,
      normalizedExternalId ? `c2-${normalizedExternalId}` : null,
    ]) {
      addCandidate(codes, code)
    }
    for (const candidate of [entry.customerExternalId, entry.customerLegacyId]) {
      addCandidate(externalIds, candidate)
    }
    addCandidate(names, entry.customerName)
  }
  return {
    codes: [...codes],
    names: [...names],
    externalIds: [...externalIds],
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Enforce the one-row-per-day database invariant before matching. Exact
 * duplicates are counted as skipped; conflicting duplicates fail closed.
 */
export function prepareVehicleLogImportDays<T extends VehicleLogImportDayCandidate>(
  entries: T[],
  start: string,
  endExclusive: string,
): { entries: PreparedVehicleLogImportDay<T>[]; skipped: number } {
  const byDate = new Map<string, { entry: PreparedVehicleLogImportDay<T>; canonical: string }>()
  let skipped = 0
  for (const entry of entries) {
    if (
      !isCalendarDate(entry.date) ||
      entry.date < start ||
      entry.date >= endExclusive ||
      !entry.sourceExternalId ||
      entry.skipReason ||
      entry.businessKm == null ||
      entry.businessKm <= 0
    ) {
      skipped += 1
      continue
    }

    const preparedEntry = {
      ...entry,
      date: entry.date,
      sourceExternalId: entry.sourceExternalId,
      businessKm: entry.businessKm,
    } as PreparedVehicleLogImportDay<T>
    const canonical = canonicalJson(preparedEntry)
    const prior = byDate.get(preparedEntry.date)
    if (prior) {
      if (prior.canonical !== canonical) {
        throw new Error(
          `Vehicle log import returned conflicting entries for ${preparedEntry.date}; only one entry per day is supported.`,
        )
      }
      skipped += 1
      continue
    }
    byDate.set(preparedEntry.date, { entry: preparedEntry, canonical })
  }
  return { entries: [...byDate.values()].map(({ entry }) => entry), skipped }
}

/** Fail closed on an external provider response before it reaches matching or persistence. */
export function assertVehicleLogImportPayload(
  value: unknown,
): asserts value is Record<string, unknown> & { entries: unknown[] } {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error('Vehicle log import response must contain an entries array.')
  }
  if (value.entries.length > VEHICLE_LOG_IMPORT_LIMITS.entries) {
    throw new Error(
      `Vehicle log import returned more than ${VEHICLE_LOG_IMPORT_LIMITS.entries.toLocaleString()} entries.`,
    )
  }
  if (value.source !== undefined) {
    if (!isRecord(value.source)) throw new Error('Vehicle log import source must be an object.')
    jsonBytes(value.source, 'Vehicle log import source', VEHICLE_LOG_IMPORT_LIMITS.sourceBytes)
  }
  if (value.stats !== undefined) {
    if (!isRecord(value.stats)) throw new Error('Vehicle log import stats must be an object.')
    jsonBytes(value.stats, 'Vehicle log import stats', VEHICLE_LOG_IMPORT_LIMITS.statsBytes)
    for (const field of ['pulled', 'resolved'] as const) {
      const stat = value.stats[field]
      if (stat === undefined) continue
      const numeric = typeof stat === 'number' ? stat : Number(stat)
      if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 1_000_000) {
        throw new Error(`Vehicle log import stats ${field} must be a non-negative whole number.`)
      }
    }
  }

  for (const [index, candidate] of value.entries.entries()) {
    if (!isRecord(candidate)) {
      throw new Error(`Vehicle log import entry ${index + 1} must be an object.`)
    }
    for (const field of IDENTIFIER_FIELDS) {
      boundedScalar(
        candidate[field],
        `Vehicle log import entry ${index + 1} ${field}`,
        VEHICLE_LOG_IMPORT_LIMITS.identifierChars,
      )
    }
    boundedScalar(candidate.date, `Vehicle log import entry ${index + 1} date`, 10)
    boundedScalar(
      candidate.customerName,
      `Vehicle log import entry ${index + 1} customerName`,
      VEHICLE_LOG_IMPORT_LIMITS.labelChars,
    )
    boundedScalar(
      candidate.sourceLabel,
      `Vehicle log import entry ${index + 1} sourceLabel`,
      VEHICLE_LOG_IMPORT_LIMITS.labelChars,
    )
    boundedScalar(
      candidate.skipReason,
      `Vehicle log import entry ${index + 1} skipReason`,
      VEHICLE_LOG_IMPORT_LIMITS.reasonChars,
    )
    boundedScalar(candidate.businessKm, `Vehicle log import entry ${index + 1} businessKm`, 64)
    if (candidate.raw !== undefined) {
      if (!isRecord(candidate.raw)) {
        throw new Error(`Vehicle log import entry ${index + 1} raw must be an object.`)
      }
      jsonBytes(
        candidate.raw,
        `Vehicle log import entry ${index + 1} raw`,
        VEHICLE_LOG_IMPORT_LIMITS.rawEntryBytes,
      )
    }
  }
}

/** Validate the persisted, non-secret portion of a vehicle-log import endpoint. */
export function normalizeVehicleLogImportUrl(raw: string): string {
  return validateOutboundRequestConfiguration(raw).url.href
}

/**
 * Resolve the endpoint before decrypting its bearer token. The actual request
 * repeats this check and pins the validated address at the socket boundary.
 */
export async function validateVehicleLogImportEndpoint(raw: string): Promise<string> {
  const url = new URL(normalizeVehicleLogImportUrl(raw))
  await resolvePublicHost(url.hostname, { timeoutMs: 10_000 })
  return url.href
}
