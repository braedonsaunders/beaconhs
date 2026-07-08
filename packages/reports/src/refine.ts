// Document refinement — makes discovered entities print like documents, not
// database dumps. Applied by the REPORTS layer only (studio picker + every
// executor map); Insights/BHQL and the public API keep the raw catalog.
//
//   • jsonb/array columns (discovery flags them `arrayUnnest`) are DROPPED —
//     raw JSON never belongs in a printed report.
//   • Foreign-key uuid columns with a discovered relation are RESOLVED to the
//     target's display column via a scalar subselect (e.g. site_org_unit_id →
//     the org unit's name). Same column key, so saved plans keep working;
//     label loses the "ID" suffix and the kind becomes text.
//
// Injection safety: every identifier comes from the schema-discovered
// catalog (table names, physical column names, single-column FKs) — never
// from user input.

import type { ReportEntity, ReportEntityColumn } from './entities'

/** Structural mirror of @beaconhs/analytics' AnalyticsRelation — kept local so
 *  this package never depends on analytics (the graph stays one-way). */
type RelationLike = {
  via: string
  target: string
  foreignColumn: string
  label: string
}

type RefinableColumn = ReportEntityColumn & { arrayUnnest?: 'array' | 'jsonb' }
type RefinableEntity = ReportEntity & {
  columns: RefinableColumn[]
  relations?: RelationLike[]
}

/** Physical display-column preference for a relation target, best first. */
const DISPLAY_PREFERENCE = [
  'name',
  'title',
  'display_name',
  'full_name',
  'label',
  'reference',
  'course_name',
  'certification_name',
  'asset_tag',
  'serial_number',
  'key',
  'slug',
  'email',
] as const

const IDENT_RE = /^[a-z_][a-z0-9_]*$/i

function q(ident: string): string {
  return `"${ident}"`
}

/** SQL expression (against alias `_ref`) that best names one row of `target`,
 *  or null when the target has no usable display column. */
function displayExprFor(target: ReportEntity): string | null {
  const physical = new Map<string, string>()
  for (const c of target.columns) {
    if (c.expr) continue // synthetic (cf_*) — not addressable as a plain column
    const name = c.sql ?? c.key
    if (IDENT_RE.test(name)) physical.set(name, name)
  }
  // People-style names read better as "Last, First".
  if (physical.has('last_name') && physical.has('first_name')) {
    return `("_ref".${q('last_name')} || ', ' || "_ref".${q('first_name')})`
  }
  for (const pref of DISPLAY_PREFERENCE) {
    if (physical.has(pref)) return `"_ref".${q(pref)}`
  }
  return null
}

/** Refine one entity: drop jsonb/array columns, resolve FK uuid columns whose
 *  relation target (looked up in `resolveTarget`) has a display column. */
export function refineReportEntityForDocuments(
  entity: ReportEntity,
  resolveTarget: (key: string) => ReportEntity | undefined,
): ReportEntity {
  const e = entity as RefinableEntity
  const relationByVia = new Map<string, RelationLike>()
  for (const r of e.relations ?? []) relationByVia.set(r.via, r)

  let changed = false
  const columns: ReportEntityColumn[] = []
  for (const col of e.columns) {
    if (col.arrayUnnest) {
      changed = true
      continue
    }
    const rel = col.kind === 'uuid' && !col.expr ? relationByVia.get(col.sql ?? col.key) : undefined
    if (!rel || !IDENT_RE.test(rel.via) || !IDENT_RE.test(rel.foreignColumn)) {
      columns.push(col)
      continue
    }
    const target = resolveTarget(rel.target)
    const display = target && IDENT_RE.test(target.table) ? displayExprFor(target) : null
    if (!display) {
      columns.push(col)
      continue
    }
    changed = true
    columns.push({
      key: col.key,
      label: rel.label,
      kind: 'text',
      expr: `(SELECT ${display} FROM ${q(target!.table)} "_ref" WHERE "_ref".${q(rel.foreignColumn)} = ${q(e.table)}.${q(rel.via)})`,
    })
  }
  return changed ? { ...entity, columns } : entity
}

/** Refine a list (the studio's source picker). Targets resolve within the same
 *  list so FK labels line up with what the picker offers. */
export function refineReportEntitiesForDocuments(entities: ReportEntity[]): ReportEntity[] {
  const byKey = new Map(entities.map((e) => [e.key, e]))
  return entities.map((e) => refineReportEntityForDocuments(e, (k) => byKey.get(k)))
}

/** Refine an executor entity map lazily (it may be a Proxy that resolves
 *  scoped per-app keys on demand, so eager enumeration is not an option). */
export function refineEntityMapForDocuments(
  map: Record<string, ReportEntity>,
): Record<string, ReportEntity> {
  const cache = new Map<string, ReportEntity>()
  const resolve = (key: string): ReportEntity | undefined => {
    if (cache.has(key)) return cache.get(key)
    const raw = map[key]
    if (!raw) return undefined
    const refined = refineReportEntityForDocuments(raw, (k) => map[k])
    cache.set(key, refined)
    return refined
  }
  return new Proxy({} as Record<string, ReportEntity>, {
    get(_t, prop) {
      return typeof prop === 'string' ? resolve(prop) : undefined
    },
    has(_t, prop) {
      return typeof prop === 'string' && prop in map
    },
  })
}
