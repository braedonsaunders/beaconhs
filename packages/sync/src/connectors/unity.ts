import { secureFetch } from '../egress'
import type {
  Connector,
  ConnectorRunContext,
  EquipmentTelemetryAsset,
  EquipmentTelemetryObservation,
} from '../types'

const BASE = 'https://api.fleetcomplete.com'
const INVENTORY_QUERY = `query BeaconEquipmentTelemetry {
  getVehicles {
    id name fleetId vin isDeleted deactivated
    assignedDevices { serial deviceTypeKey }
    latestData {
      timestamp
      gpsWithTimestamp {
        latitude { value timestamp } longitude { value timestamp }
        state { value timestamp } speed { value timestamp }
      }
      ignition { engineStatus }
      address { address city region country }
    }
  }
}`
const HISTORY_QUERY = `query BeaconEquipmentHistory($id: UUID!, $from: DateTime!, $to: DateTime!) {
  getSnapshots(vehicleId: $id, from: $from, to: $to) {
    timestamp gps { state latitude longitude speed } ignition { engineStatus }
  }
}`

type Json = Record<string, unknown>
function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function milliseconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && value <= Date.now() + 300_000
    ? date.toISOString()
    : null
}
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value))
    return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 300_000
    ? date.toISOString()
    : null
}
function observation(
  at: string | null,
  gps: Json,
  engine: unknown,
  divisor: number,
): EquipmentTelemetryObservation | null {
  if (
    !at ||
    gps.state !== true ||
    typeof gps.latitude !== 'number' ||
    typeof gps.longitude !== 'number'
  )
    return null
  const latitude = gps.latitude / divisor
  const longitude = gps.longitude / divisor
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null
  return {
    observedAt: at,
    latitude,
    longitude,
    speedKph:
      typeof gps.speed === 'number' && Number.isFinite(gps.speed) && gps.speed >= 0
        ? gps.speed
        : null,
    engineOn: typeof engine === 'boolean' ? engine : null,
  }
}

// TELUS's live responses are decimal degrees despite the public Gps type's
// arc-minute description. Units are an explicit connection setting, never
// guessed from coordinate magnitude (both representations can be in range).
export function normalizeUnityVehicles(
  input: unknown,
  units: 'degrees' | 'arc_minutes',
): EquipmentTelemetryAsset[] {
  if (!Array.isArray(input)) throw new Error('Unity did not return a complete asset inventory.')
  const seen = new Set<string>()
  return input.map((raw) => {
    const v = object(raw)
    const externalId = optionalText(v.id)
    const name = optionalText(v.name)
    if (!externalId || !name || seen.has(externalId))
      throw new Error('Unity returned an invalid or duplicate asset identity.')
    seen.add(externalId)
    const latest = object(v.latestData)
    const gps = object(latest.gpsWithTimestamp)
    const lat = object(gps.latitude),
      lng = object(gps.longitude),
      state = object(gps.state)
    const at = lat.timestamp === lng.timestamp ? milliseconds(lat.timestamp) : null
    const lastReportedAt = milliseconds(latest.timestamp)
    const point =
      lastReportedAt && at && at <= lastReportedAt
        ? observation(
            at,
            {
              latitude: lat.value,
              longitude: lng.value,
              state: state.value,
              speed: object(gps.speed).value,
            },
            object(latest.ignition).engineStatus,
            units === 'arc_minutes' ? 60 : 1,
          )
        : null
    const devices = Array.isArray(v.assignedDevices) ? v.assignedDevices.map(object) : []
    const address = object(latest.address)
    return {
      externalId,
      name,
      vin: optionalText(v.vin),
      deviceSerials: devices.flatMap((d) =>
        optionalText(d.serial) ? [String(d.serial).trim()] : [],
      ),
      deviceModels: [
        ...new Set(
          devices.flatMap((d) =>
            optionalText(d.deviceTypeKey) ? [String(d.deviceTypeKey).trim()] : [],
          ),
        ),
      ],
      deactivated: v.deactivated === true || v.isDeleted === true,
      lastReportedAt,
      gpsValid: point !== null,
      address: point
        ? [address.address, address.city, address.region, address.country]
            .flatMap((x) => (optionalText(x) ? [String(x).trim()] : []))
            .join(', ') || null
        : null,
      observations: point ? [point] : [],
    }
  })
}

export function normalizeUnityHistory(
  input: unknown,
  units: 'degrees' | 'arc_minutes',
  from: string,
  to: string,
): EquipmentTelemetryObservation[] {
  if (!Array.isArray(input)) throw new Error('Unity did not return an asset history array.')
  if (input.length >= 10_000)
    throw new Error('Unity history is too large. Reduce the history window before retrying.')
  return input.flatMap((raw) => {
    const row = object(raw),
      at = isoDate(row.timestamp)
    if (!at)
      throw new Error(
        'Unity returned an invalid history timestamp. The history cursor was preserved.',
      )
    if (at < from || at > to) return []
    const point = observation(
      at,
      object(row.gps),
      object(row.ignition).engineStatus,
      units === 'arc_minutes' ? 60 : 1,
    )
    return point ? [point] : []
  })
}

async function client(ctx: ConnectorRunContext) {
  const username = ctx.secrets.username,
    password = ctx.secrets.password
  if (!username || !password) throw new Error('Unity username and password are required.')
  const credentials = { username, password }
  let token = '',
    expiresAt = 0
  async function login() {
    const response = await secureFetch(`${BASE}/login/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(credentials),
      timeoutMs: 30_000,
    })
    if (!response.ok)
      throw new Error(
        `Unity authentication failed (HTTP ${response.status}). Check the integration account credentials.`,
      )
    const data = object(await response.json())
    if (typeof data.access_token !== 'string' || !data.access_token)
      throw new Error('Unity authentication returned no access token.')
    token = data.access_token
    const lifetime =
      typeof data.expires_in === 'number' && data.expires_in > 60 ? data.expires_in : 300
    expiresAt = Date.now() + Math.min(lifetime - 30, 240) * 1000
  }
  await login()
  const identityResponse = await secureFetch(`${BASE}/login/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 30_000,
  })
  if (!identityResponse.ok)
    throw new Error(`Unity fleet lookup failed (HTTP ${identityResponse.status}).`)
  const identities: unknown = await identityResponse.json()
  if (!Array.isArray(identities)) throw new Error('Unity returned an invalid fleet list.')
  const userId = optionalText(ctx.config.userId)
  const choices = identities.map(object).filter((x) => optionalText(x.userId))
  const selected = userId
    ? choices.find((x) => x.userId === userId)
    : choices.length === 1
      ? choices[0]
      : null
  if (!selected)
    throw new Error(
      'Select a Unity fleet user ID from the API account. Automatic selection requires exactly one fleet.',
    )
  const selectedId = String(selected.userId)
  return async (query: string, variables: Json = {}): Promise<Json> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (Date.now() >= expiresAt) await login()
      const response = await secureFetch(`${BASE}/graphql`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          userId: selectedId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        timeoutMs: 60_000,
        maxResponseBytes: 16 * 1024 * 1024,
      })
      if (response.status === 401 && attempt < 3) {
        await login()
        continue
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retry = Number(response.headers.get('retry-after'))
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Number.isFinite(retry) && retry > 0
              ? Math.min(retry * 1000, 15_000)
              : (attempt + 1) * 2000,
          ),
        )
        continue
      }
      if (!response.ok) throw new Error(`Unity data request failed (HTTP ${response.status}).`)
      const envelope = object(await response.json())
      // Never log raw vendor messages or payloads: they can contain secrets
      // or precise locations. Partial GraphQL data is not a full inventory.
      if (Array.isArray(envelope.errors) && envelope.errors.length > 0)
        throw new Error(
          'Unity returned GraphQL errors. The pull was not applied; check the API account permissions and query support.',
        )
      if (!envelope.data || typeof envelope.data !== 'object')
        throw new Error('Unity returned no data.')
      return object(envelope.data)
    }
    throw new Error('Unity request retries exhausted.')
  }
}

export const unityConnector: Connector = {
  key: 'unity',
  name: 'Fleet Complete / Powerfleet Unity',
  kind: 'native',
  entities: ['equipment'],
  supportsEquipmentTelemetry: true,
  description:
    'Connect tracker positions and history to existing equipment. Equipment records and manual custody stay under their current owner.',
  configFields: [
    {
      key: 'userId',
      label: 'Fleet user ID',
      type: 'text',
      help: 'Optional when the API account can access exactly one fleet.',
    },
    {
      key: 'coordinateUnits',
      label: 'Coordinate units',
      type: 'select',
      options: [
        { value: 'degrees', label: 'Decimal degrees (verified for TELUS Unity)' },
        { value: 'arc_minutes', label: 'Arc minutes' },
      ],
      help: 'Choose the units returned by your API. Never change this without checking a known location.',
    },
    {
      key: 'historyWindowHours',
      label: 'History window (hours)',
      type: 'number',
      help: '1–24 hours per run. Default 24. Subsequent runs overlap ten minutes and resume after outages.',
    },
    {
      key: 'staleAfterMinutes',
      label: 'Tracker stale after (minutes)',
      type: 'number',
      help: 'Default 1440 (24 hours). Match the tracker reporting schedule; a successful sync does not make an old position fresh.',
    },
  ],
  secretFields: [
    { key: 'username', label: 'API account username', required: true },
    { key: 'password', label: 'API account password', required: true },
  ],
  async test(ctx) {
    const query = await client(ctx)
    const data = await query('{getVehicles{id name}}')
    if (!Array.isArray(data.getVehicles)) throw new Error('Unity returned no inventory.')
    return { ok: true, message: `Connected. ${data.getVehicles.length} assets available.` }
  },
  async pull(ctx) {
    const units = ctx.config.coordinateUnits ?? 'degrees'
    if (units !== 'degrees' && units !== 'arc_minutes')
      throw new Error('Choose valid Unity coordinate units.')
    const window = ctx.config.historyWindowHours ?? 24
    if (typeof window !== 'number' || !Number.isInteger(window) || window < 1 || window > 24)
      throw new Error('History window must be a whole number from 1 to 24 hours.')
    const now = new Date()
    const previous = isoDate(ctx.since?.collectedThrough)
    const from = new Date(
      previous ? new Date(previous).getTime() - 10 * 60_000 : now.getTime() - window * 3600_000,
    ).toISOString()
    const to = new Date(
      Math.min(now.getTime(), new Date(from).getTime() + window * 3600_000),
    ).toISOString()
    const query = await client(ctx)
    const inventory = await query(INVENTORY_QUERY)
    const assets = normalizeUnityVehicles(inventory.getVehicles, units)
    if (assets.length === 0)
      throw new Error(
        'Unity returned an empty inventory. Existing tracker assignments were preserved.',
      )
    for (const asset of assets) {
      if (asset.deactivated || !asset.lastReportedAt || asset.lastReportedAt < from) continue
      const history = await query(HISTORY_QUERY, { id: asset.externalId, from, to })
      const points = normalizeUnityHistory(history.getSnapshots, units, from, to)
      const inventoryFix = asset.observations[0]?.observedAt
      asset.observations.push(...points)
      const newest = points.reduce<string | null>(
        (at, point) => (!at || point.observedAt > at ? point.observedAt : at),
        null,
      )
      if (newest && (!inventoryFix || newest > inventoryFix)) asset.address = null
      if (newest && newest > asset.lastReportedAt) {
        asset.lastReportedAt = newest
        asset.gpsValid = true
        asset.address = null
      }
    }
    ctx.log(
      'info',
      `Retrieved ${assets.length} tracker assets and their available location history.`,
    )
    return {
      records: [],
      equipmentTelemetry: assets,
      authoritativeEntities: [],
      mode: 'incremental',
      nextCursor: { collectedThrough: to },
    }
  },
}
