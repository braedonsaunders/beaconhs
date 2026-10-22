// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ map: vi.fn(), remove: vi.fn() }))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('leaflet', () => {
  const control = () => ({ addTo: vi.fn() })
  const layer = () => {
    const value = {
      on: vi.fn(),
      off: vi.fn(),
      addTo: vi.fn(),
      clearLayers: vi.fn(),
      bindPopup: vi.fn(),
    }
    value.on.mockReturnValue(value)
    value.addTo.mockReturnValue(value)
    value.bindPopup.mockReturnValue(value)
    return value
  }
  return {
    map: mocks.map,
    control: { zoom: control, scale: control },
    tileLayer: layer,
    layerGroup: layer,
    marker: layer,
    divIcon: vi.fn(),
  }
})
import { EquipmentTelemetryMap, type EquipmentMapPoint } from './equipment-telemetry-map'
let root: Root
let container: HTMLDivElement
const point: EquipmentMapPoint = {
  id: 'truck',
  label: 'Truck',
  latitude: 43,
  longitude: -80,
  observedAt: '2026-10-22T12:00:00Z',
  observedLabel: '12:00',
  health: 'Reporting',
  href: '/equipment/truck',
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  mocks.map.mockImplementation(() => ({
    fitBounds: vi.fn(),
    setView: vi.fn(),
    getCenter: () => ({ lat: 43, lng: -80 }),
    getZoom: () => 10,
    project: () => ({ x: 100, y: 100 }),
    unproject: () => ({ lat: 43, lng: -80 }),
    on: vi.fn(),
    off: vi.fn(),
    invalidateSize: vi.fn(),
    remove: mocks.remove,
  }))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(points: EquipmentMapPoint[]) {
  await act(async () => {
    root.render(<EquipmentTelemetryMap points={points} embedded />)
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}
it('keeps the live map when a sibling widget navigation sends equivalent data', async () => {
  await render([point])
  expect(mocks.map).toHaveBeenCalledTimes(1)
  await render([{ ...point }])
  expect(mocks.map).toHaveBeenCalledTimes(1)
  expect(mocks.remove).not.toHaveBeenCalled()
  await render([{ ...point, latitude: 44 }])
  expect(mocks.map).toHaveBeenCalledTimes(2)
  expect(mocks.remove).toHaveBeenCalledTimes(1)
})
