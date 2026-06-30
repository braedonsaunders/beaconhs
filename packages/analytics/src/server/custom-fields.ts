// Augment the discovered analytics catalog with tenant custom-field columns.
// The column SQL + typing is owned by @beaconhs/reports (loadCustomFieldColumns);
// here we only decorate those columns with the semantic flags the BHQL builder
// + studio need (canDimension/canMeasure/…). Custom-field values live in a jsonb
// `metadata` column, so each column carries a server-generated `expr` that the
// compiler resolves through `columnRef`.

import type { Database } from '@beaconhs/db'
import { loadCustomFieldColumns, type ReportEntityColumn } from '@beaconhs/reports'
import { deriveSemanticType, type AnalyticsColumn, type AnalyticsEntity } from '../semantic'
import { discoverEntities } from './discover'

function decorate(col: ReportEntityColumn): AnalyticsColumn {
  const semanticType = deriveSemanticType(col)
  const isNumber = col.kind === 'number'
  const isTemporal = col.kind === 'date' || col.kind === 'timestamp'
  return {
    ...col,
    semanticType,
    canDimension: true,
    canMeasure: isNumber,
    canBinTemporal: isTemporal,
    canBinNumeric: isNumber,
  }
}

/** Discovered entities with the tenant's active custom-field columns appended.
 *  Only the four custom-field-bearing base tables incur a DB read. */
export async function discoverEntitiesWithCustomFields(tx: Database): Promise<AnalyticsEntity[]> {
  const base = discoverEntities()
  const out: AnalyticsEntity[] = []
  for (const entity of base) {
    const cols = await loadCustomFieldColumns(tx, entity.table)
    if (!cols.length) {
      out.push(entity)
      continue
    }
    const existing = new Set(entity.columns.map((c) => c.key))
    const add = cols.filter((c) => !existing.has(c.key)).map(decorate)
    out.push(add.length ? { ...entity, columns: [...entity.columns, ...add] } : entity)
  }
  return out
}

/** Map form of {@link discoverEntitiesWithCustomFields}. */
export async function discoverEntityMapWithCustomFields(
  tx: Database,
): Promise<Record<string, AnalyticsEntity>> {
  const entities = await discoverEntitiesWithCustomFields(tx)
  return Object.fromEntries(entities.map((e) => [e.key, e]))
}
