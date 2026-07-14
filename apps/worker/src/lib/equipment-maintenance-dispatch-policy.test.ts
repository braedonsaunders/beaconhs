import { describe, expect, it } from 'vitest'
import {
  chunkEquipmentMaintenance,
  equipmentMaintenanceDeliveryKey,
  EQUIPMENT_MAINTENANCE_BATCH_SIZE,
} from './equipment-maintenance-dispatch-policy'

describe('equipment maintenance dispatch policy', () => {
  it('uses a fixed-size, order-independent delivery identity', () => {
    const tenantId = '25053a39-cf90-4537-947f-c627f510a558'
    const cycles = Array.from({ length: 1_000 }, (_, index) => ({
      kind: index % 2 === 0 ? ('inspection' as const) : ('reminder' as const),
      id: `${index.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
      dueOn: '2026-07-13',
    }))

    const forward = equipmentMaintenanceDeliveryKey(tenantId, cycles)
    const reverse = equipmentMaintenanceDeliveryKey(tenantId, [...cycles].reverse())

    expect(forward).toBe(reverse)
    expect(forward).toMatch(/^equipment-maintenance\|[a-f0-9]{64}$/)
    expect(forward.length).toBeLessThan(100)
  })

  it('splits dispatches into bounded snapshots without dropping entries', () => {
    const values = Array.from(
      { length: EQUIPMENT_MAINTENANCE_BATCH_SIZE * 2 + 1 },
      (_, index) => index,
    )

    const chunks = chunkEquipmentMaintenance(values)

    expect(chunks.map((chunk) => chunk.length)).toEqual([
      EQUIPMENT_MAINTENANCE_BATCH_SIZE,
      EQUIPMENT_MAINTENANCE_BATCH_SIZE,
      1,
    ])
    expect(chunks.flat()).toEqual(values)
  })
})
