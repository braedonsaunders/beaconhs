// Tenant custom fields → report columns. Custom-field VALUES live on each
// record's `metadata` jsonb under the `custom` namespace (see
// @beaconhs/forms-core). This module turns the active definitions for an entity
// into synthetic `ReportEntityColumn`s whose `expr` reads the value straight
// out of jsonb — so they flow through the reports engine, the public API and
// the BHQL/insights engine like any other column, with no schema change.
//
// Injection safety: the field `key` is a strict slug (validated at write time
// by the custom-field designer), and we re-assert that shape here before
// interpolating it into the jsonb path; everything else is fixed SQL.

import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { customFieldDefinitions } from '@beaconhs/db/schema'
import type { ReportColumnKind, ReportEntity, ReportEntityColumn } from './entities'

/** Report-entity physical table → custom-field entity kind. Only base tables
 *  that carry a `metadata` jsonb column can host custom fields. */
const TABLE_TO_KIND: Record<string, 'equipment' | 'ppe' | 'person' | 'location'> = {
  equipment_items: 'equipment',
  ppe_items: 'ppe',
  people: 'person',
  org_units: 'location',
}

/** Prefix on synthetic custom-field column keys, so they never collide with a
 *  base column key and are recognisable in stored query plans. */
export const CUSTOM_COLUMN_PREFIX = 'cf_'

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/

type CustomFieldRow = { key: string; label: string; fieldType: string }

function kindFor(fieldType: string): ReportColumnKind {
  switch (fieldType) {
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'datetime':
      return 'timestamp'
    default:
      return 'text'
  }
}

/** SQL expression reading + typing the value out of `metadata.custom.<key>`. */
function exprFor(table: string, key: string, fieldType: string): string {
  const text = `"${table}"."metadata"->'custom'->>'${key}'`
  switch (fieldType) {
    case 'number':
      return `(${text})::numeric`
    case 'date':
      return `(${text})::date`
    case 'datetime':
      return `(${text})::timestamptz`
    case 'multi_select':
      // Stored as a jsonb string array — flatten to a readable comma list.
      return `(SELECT string_agg(value, ', ') FROM jsonb_array_elements_text(coalesce("${table}"."metadata"->'custom'->'${key}', '[]'::jsonb)) AS value)`
    default:
      return `(${text})`
  }
}

/** Map a list of custom-field definitions to synthetic report columns. Pure —
 *  the caller supplies already-loaded definitions. Invalid keys are skipped. */
export function buildCustomFieldColumns(
  table: string,
  defs: CustomFieldRow[],
): ReportEntityColumn[] {
  return defs
    .filter((d) => KEY_RE.test(d.key))
    .map((d) => ({
      key: `${CUSTOM_COLUMN_PREFIX}${d.key}`,
      label: d.label,
      kind: kindFor(d.fieldType),
      expr: exprFor(table, d.key, d.fieldType),
    }))
}

/** The custom-field entity kind a report entity maps to, or null. */
export function customFieldKindForTable(table: string): string | null {
  return TABLE_TO_KIND[table] ?? null
}

/** Load active custom-field columns for an entity's table under the caller's
 *  (already tenant-scoped) tx. Returns [] for tables without custom fields. */
export async function loadCustomFieldColumns(
  tx: Database,
  table: string,
): Promise<ReportEntityColumn[]> {
  const kind = TABLE_TO_KIND[table]
  if (!kind) return []
  const rows = await tx
    .select({
      key: customFieldDefinitions.key,
      label: customFieldDefinitions.label,
      fieldType: customFieldDefinitions.fieldType,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.entityKind, kind),
        eq(customFieldDefinitions.isActive, true),
        isNull(customFieldDefinitions.deletedAt),
      ),
    )
    .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label))
  return buildCustomFieldColumns(table, rows)
}

/** Return a copy of the entity with its tenant custom-field columns appended
 *  (deduped against existing keys). Unchanged when there are none. */
export async function augmentReportEntityWithCustomFields(
  tx: Database,
  entity: ReportEntity,
): Promise<ReportEntity> {
  const cols = await loadCustomFieldColumns(tx, entity.table)
  if (!cols.length) return entity
  const existing = new Set(entity.columns.map((c) => c.key))
  const add = cols.filter((c) => !existing.has(c.key))
  if (!add.length) return entity
  return { ...entity, columns: [...entity.columns, ...add] }
}

/** Augment every custom-field-bearing entity in a map in one pass. Returns a
 *  `ReportEntity` map suitable for the reports executor + public API. The
 *  BHQL/insights engine uses its own decorating augment (it needs the richer
 *  AnalyticsColumn shape); this one only carries the base column fields the
 *  reports executor reads (key/label/kind/expr). */
export async function augmentEntityMapWithCustomFields(
  tx: Database,
  map: Record<string, ReportEntity>,
): Promise<Record<string, ReportEntity>> {
  const out: Record<string, ReportEntity> = { ...map }
  for (const key of Object.keys(out)) {
    const entity = out[key]!
    if (!TABLE_TO_KIND[entity.table]) continue
    out[key] = await augmentReportEntityWithCustomFields(tx, entity)
  }
  // Delegate misses back to the source map. discoverEntityMap() is a Proxy
  // that resolves scoped virtual keys (per-Builder-app
  // `form_responses:<templateId>` sources) on demand — a plain spread copies
  // only own keys and would drop that, breaking saved per-app reports.
  return new Proxy(out, {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) return map[prop]
      return target[prop as string]
    },
    has(target, prop) {
      return prop in target || prop in map
    },
  })
}
