import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  ctx: { permissions: new Set(['equipment.read.all']) },
  load: vi.fn(),
  render: vi.fn(async () => new Response('pdf')),
  audit: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => mocks.ctx }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@/lib/module-pdf', () => ({ renderModulePdfResponse: mocks.render }))
vi.mock('@/lib/pdf-route', () => ({ renderOnDemandPdfResponse: mocks.render }))
vi.mock('@/app/(app)/equipment/vehicle-log/_service', () => ({
  loadVehicleLogWorkspace: mocks.load,
}))
import { GET } from '@/app/(app)/equipment/vehicle-log/pdf/route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.ctx.permissions = new Set(['equipment.read.all'])
  mocks.load.mockResolvedValue({
    selectedDriverId: 'driver',
    selectedEquipmentId: 'vehicle',
    drivers: [{ id: 'driver', label: 'Driver' }],
    vehicles: [{ id: 'vehicle', label: 'Truck' }],
    sites: [],
    month: { key: '2026-11', label: 'November 2026' },
    mode: 'destination',
    totals: { businessKm: 0, personalKm: 0, totalKm: 0 },
    rows: [{ day: 1, weekday: 'Sun', isWeekend: true, entry: { id: 'entry' } }],
  })
})
it('allows a scoped reader without bulk-export permission to generate a monthly PDF', async () => {
  const response = await GET(new NextRequest('http://localhost/equipment/vehicle-log/pdf'))
  expect(response.status).toBe(200)
  expect(mocks.render).toHaveBeenCalledWith(
    mocks.ctx,
    expect.objectContaining({
      values: { entry_mode: 'destination', is_odometer: false },
    }),
  )
  expect(mocks.audit).toHaveBeenCalled()
})
it('returns 403 and never loads or renders for a user without vehicle-log access', async () => {
  mocks.ctx.permissions.clear()
  expect((await GET(new NextRequest('http://localhost/equipment/vehicle-log/pdf'))).status).toBe(
    403,
  )
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.render).not.toHaveBeenCalled()
})
it('does not render an out-of-scope driver or vehicle', async () => {
  mocks.load.mockResolvedValue({ selectedDriverId: '', selectedEquipmentId: '' })
  expect((await GET(new NextRequest('http://localhost/equipment/vehicle-log/pdf'))).status).toBe(
    400,
  )
  expect(mocks.render).not.toHaveBeenCalled()
})
