import { createHash } from 'node:crypto'

export const EQUIPMENT_MAINTENANCE_BATCH_SIZE = 100
export const EQUIPMENT_MAINTENANCE_SOURCE_LIMIT = 5_000

export type EquipmentMaintenanceCycleIdentity = {
  kind: 'inspection' | 'reminder'
  id: string
  dueOn: string
}

/**
 * PostgreSQL indexes the dispatch identity, so it must stay fixed-size even
 * when a tenant has thousands of due records. Sorting makes the identity
 * independent of query/planner ordering.
 */
export function equipmentMaintenanceDeliveryKey(
  tenantId: string,
  cycles: EquipmentMaintenanceCycleIdentity[],
): string {
  if (cycles.length === 0) throw new Error('Equipment maintenance dispatch requires a due cycle.')
  const hash = createHash('sha256')
  hash.update(tenantId)
  for (const cycle of [...cycles].sort((a, b) => {
    const left = `${a.kind}\0${a.id}\0${a.dueOn}`
    const right = `${b.kind}\0${b.id}\0${b.dueOn}`
    return left.localeCompare(right)
  })) {
    hash.update('\0')
    hash.update(cycle.kind)
    hash.update('\0')
    hash.update(cycle.id)
    hash.update('\0')
    hash.update(cycle.dueOn)
  }
  return `equipment-maintenance|${hash.digest('hex')}`
}

export function chunkEquipmentMaintenance<T>(values: T[]): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += EQUIPMENT_MAINTENANCE_BATCH_SIZE) {
    chunks.push(values.slice(index, index + EQUIPMENT_MAINTENANCE_BATCH_SIZE))
  }
  return chunks
}
