// Augment the discovered analytics catalog with tenant custom-field columns.
// The column SQL + typing is owned by @beaconhs/reports (loadCustomFieldColumns);
// here we only decorate those columns with the semantic flags the BHQL builder
// + studio need (canDimension/canMeasure/…). Custom-field values live in a jsonb
// `metadata` column, so each column carries a server-generated `expr` that the
// compiler resolves through `columnRef`.

import { and, asc, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { formTemplates } from '@beaconhs/db/schema'
import { loadCustomFieldColumns, type ReportEntityColumn } from '@beaconhs/reports'
import { deriveSemanticType, type AnalyticsColumn, type AnalyticsEntity } from '../semantic'
import { discoverEntities, discoverEntityMap, scopedFormAppEntity } from './discover'

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

/** The full studio source catalog: schema-discovered entities (with custom
 *  fields) PLUS one scoped entity per Builder app — the form_responses table
 *  scoped to that template via a baked-in template_id baseFilter, labeled with
 *  the app's own name. Shared by the Insights card studio and the Reports
 *  studio so both pickers present Builder apps identically. Runs under the
 *  caller's tenant-scoped tx (RLS bounds the template list). */
export async function discoverEntitiesWithApps(tx: Database): Promise<AnalyticsEntity[]> {
  const [base, apps] = await Promise.all([
    discoverEntitiesWithCustomFields(tx),
    tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .where(and(isNull(formTemplates.deletedAt)))
      .orderBy(asc(formTemplates.name)),
  ])
  const appEntities = apps
    .map((a) => scopedFormAppEntity(a.id, a.name))
    .filter((e): e is AnalyticsEntity => e != null)
  return [...base, ...appEntities]
}

/** Map form of {@link discoverEntitiesWithApps} for executors. Scoped per-app
 *  keys resolve to entities that CARRY their app title (so a per-app report
 *  prints "Lift Plan", not the generic form_responses label); any scoped key
 *  outside the tenant's current template list still resolves statelessly via
 *  the discoverEntityMap() proxy fallback. */
export async function discoverEntityMapWithApps(
  tx: Database,
): Promise<Record<string, AnalyticsEntity>> {
  const entities = await discoverEntitiesWithApps(tx)
  const own: Record<string, AnalyticsEntity> = Object.fromEntries(entities.map((e) => [e.key, e]))
  const fallback = discoverEntityMap()
  return new Proxy(own, {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) return fallback[prop]
      return target[prop as string]
    },
    has(target, prop) {
      return prop in target || prop in fallback
    },
  })
}
