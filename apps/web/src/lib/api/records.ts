// Which exposed entities support per-record access (GET /api/v1/{entity}/{id}).
// Physical-table entities carry a stable `id` uuid PK; the `report_*` join-baked
// views in the registry do not, so they're list-only.

import { REPORT_ENTITIES, type ReportEntity } from '@beaconhs/reports'

const ID_COLUMN = 'id'

const RECORDABLE = new Set(
  REPORT_ENTITIES.filter((e) => !e.table.startsWith('report_')).map((e) => e.key),
)

export function isRecordable(entityKey: string): boolean {
  return RECORDABLE.has(entityKey)
}

/** The id column to select/filter for an entity, or null for list-only views. */
export function recordIdColumn(entity: ReportEntity): string | null {
  return entity.table.startsWith('report_') ? null : ID_COLUMN
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}
