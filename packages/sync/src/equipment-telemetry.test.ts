import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeUnityHistory, normalizeUnityVehicles } from './connectors/unity'
import { orderedTelemetryObservations } from './equipment-telemetry'

const at = Date.UTC(2026, 0, 3, 10)
const fixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'source-1',
  name: 'Truck 12',
  vin: 'TEST-VIN',
  assignedDevices: [{ serial: 'device-1', deviceTypeKey: 'AT1' }],
  latestData: {
    timestamp: at,
    gpsWithTimestamp: {
      latitude: { value: 43.25, timestamp: at },
      longitude: { value: -80.5, timestamp: at },
      state: { value: true, timestamp: at },
      speed: { value: 0, timestamp: at },
    },
    ignition: { engineStatus: false },
  },
  ...overrides,
})

describe('Unity telemetry normalization', () => {
  it('preserves verified decimal coordinates, milliseconds and false/zero readings', () => {
    const [asset] = normalizeUnityVehicles([fixture()], 'degrees')
    assert.equal(asset?.lastReportedAt, new Date(at).toISOString())
    assert.deepEqual(asset?.observations, [
      {
        observedAt: new Date(at).toISOString(),
        latitude: 43.25,
        longitude: -80.5,
        speedKph: 0,
        engineOn: false,
      },
    ])
    assert.equal(asset?.gpsValid, true)
    assert.deepEqual(asset?.deviceSerials, ['device-1'])
  })
  it('converts arc minutes only when configured explicitly', () => {
    const raw = fixture()
    raw.latestData.gpsWithTimestamp.latitude.value = 43.25 * 60
    raw.latestData.gpsWithTimestamp.longitude.value = -80.5 * 60
    assert.equal(normalizeUnityVehicles([raw], 'degrees')[0]?.gpsValid, false)
    assert.equal(normalizeUnityVehicles([raw], 'arc_minutes')[0]?.observations[0]?.latitude, 43.25)
  })
  it('does not fabricate a fix for a reporting tracker with invalid or mismatched GPS', () => {
    const raw = fixture()
    raw.latestData.gpsWithTimestamp.state.value = false
    const [invalid] = normalizeUnityVehicles([raw], 'degrees')
    assert.equal(invalid?.lastReportedAt, new Date(at).toISOString())
    assert.equal(invalid?.gpsValid, false)
    assert.equal(invalid?.address, null)
    assert.deepEqual(invalid?.observations, [])
    raw.latestData.gpsWithTimestamp.state.value = true
    raw.latestData.gpsWithTimestamp.longitude.timestamp = at - 1000
    assert.deepEqual(normalizeUnityVehicles([raw], 'degrees')[0]?.observations, [])
  })
  it('keeps never-reported inventory and rejects partial or ambiguous identities', () => {
    assert.equal(
      normalizeUnityVehicles([fixture({ latestData: null })], 'degrees')[0]?.lastReportedAt,
      null,
    )
    assert.throws(() => normalizeUnityVehicles(null, 'degrees'), /complete asset inventory/)
    assert.throws(() => normalizeUnityVehicles([fixture(), fixture()], 'degrees'), /duplicate/)
    assert.throws(() => normalizeUnityVehicles([fixture({ id: '' })], 'degrees'), /identity/)
  })
  it('uses ISO history timestamps and preserves the cursor on malformed/truncated history', () => {
    const from = new Date(at - 1000).toISOString(),
      to = new Date(at + 1000).toISOString()
    const row = {
      timestamp: new Date(at).toISOString(),
      gps: { state: true, latitude: 43.25, longitude: -80.5, speed: 12 },
      ignition: { engineStatus: true },
    }
    assert.equal(normalizeUnityHistory([row], 'degrees', from, to)[0]?.speedKph, 12)
    assert.deepEqual(
      normalizeUnityHistory([{ ...row, gps: { ...row.gps, state: false } }], 'degrees', from, to),
      [],
    )
    assert.deepEqual(
      normalizeUnityHistory(
        [{ ...row, timestamp: new Date(at - 2000).toISOString() }],
        'degrees',
        from,
        to,
      ),
      [],
    )
    assert.throws(
      () => normalizeUnityHistory([{ ...row, timestamp: at }], 'degrees', from, to),
      /timestamp/,
    )
    assert.throws(
      () =>
        normalizeUnityHistory(
          Array.from({ length: 10000 }, () => row),
          'degrees',
          from,
          to,
        ),
      /too large/,
    )
  })
})

describe('provider-neutral observation integrity', () => {
  const point = {
    observedAt: new Date(at).toISOString(),
    latitude: 43,
    longitude: -80,
    speedKph: null,
    engineOn: null,
  }
  it('deduplicates overlapping windows and orders readings independently of source order', () => {
    const later = { ...point, observedAt: new Date(at + 1000).toISOString() }
    assert.deepEqual(orderedTelemetryObservations([later, point, point]), [point, later])
  })
  it('fails closed on contradictory, future, out-of-range or negative-speed readings', () => {
    assert.throws(
      () => orderedTelemetryObservations([point, { ...point, latitude: 44 }]),
      /Conflicting/,
    )
    assert.throws(
      () =>
        orderedTelemetryObservations([
          { ...point, observedAt: new Date(Date.now() + 3600000).toISOString() },
        ]),
      /time/,
    )
    assert.throws(() => orderedTelemetryObservations([{ ...point, latitude: 91 }]), /coordinates/)
    assert.throws(() => orderedTelemetryObservations([{ ...point, speedKph: -1 }]), /speed/)
  })
})
