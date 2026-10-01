import { describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@beaconhs/events', () => ({ recordModuleFlowEvent: vi.fn() }))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn() }))
vi.mock('./_equipment-policy', () => ({
  resolveVehicleEquipmentWhere: vi.fn().mockResolvedValue({ where: undefined }),
}))
import { authorizeVehicleLogTarget } from './_service'
const self = '12f93dc0-2e7e-4895-a7bc-8571156609df'
const other = '22f93dc0-2e7e-4895-a7bc-8571156609df'
const input = { driverPersonId: self, equipmentItemId: other, month: '2026-10' }
function context(permissions: string[], available = true) {
  const rows = available ? [{ id: self }] : []
  const query = { from: () => query, where: () => query, limit: () => Promise.resolve(rows) }
  const db = vi.fn(async (fn) => fn({ select: () => query }))
  return {
    ctx: {
      permissions: new Set(permissions),
      personId: self,
      isSuperAdmin: false,
      db,
    } as unknown as RequestContext,
    db,
  }
}
describe('vehicle-log extension target authorization', () => {
  it('allows own-log editors without granting equipment management', async () => {
    const { ctx } = context(['equipment.vehicle-log.update.own'])
    expect(await authorizeVehicleLogTarget(ctx, input)).toEqual(input)
  })
  it('blocks readers and forged drivers before any plugin or database work', async () => {
    const reader = context(['equipment.read.all'])
    await expect(authorizeVehicleLogTarget(reader.ctx, input)).rejects.toThrow('permission')
    expect(reader.db).not.toHaveBeenCalled()
    const editor = context(['equipment.vehicle-log.update.own'])
    await expect(
      authorizeVehicleLogTarget(editor.ctx, { ...input, driverPersonId: other }),
    ).rejects.toThrow('permission')
    expect(editor.db).not.toHaveBeenCalled()
  })
  it('rejects unavailable targets and invalid months instead of invoking an extension', async () => {
    const { ctx } = context(['equipment.manage'], false)
    await expect(authorizeVehicleLogTarget(ctx, input)).rejects.toThrow('unavailable')
    await expect(authorizeVehicleLogTarget(ctx, { ...input, month: '2026-13' })).rejects.toThrow(
      'invalid',
    )
  })
})
