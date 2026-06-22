// Semantic layer — decorates (never duplicates) the report entity registry with
// the richer metadata the BI builder + viz layer need: a semantic type per
// column, enum value options, fk targets, and derived eligibility flags
// (can this column be a dimension / a measure / temporally binned / numerically
// binned). The report registry stays the single source of truth for WHICH
// columns exist; this overlay only adds meaning on top.
//
// Pure + runtime-free: imports the registry from @beaconhs/reports/entities
// (no drizzle) and only TYPES from @beaconhs/db/schema, so it is safe to import
// from client bundles.

import {
  REPORT_ENTITIES,
  type ReportColumnKind,
  type ReportEntity,
  type ReportEntityColumn,
} from '@beaconhs/reports/entities'
import type { ReportRuleGroup } from '@beaconhs/db/schema'

/** How to interpret a column — drives auto-viz, binning and formatting. */
export type SemanticType =
  | 'dimension' // generic groupable categorical
  | 'category' // enum-like categorical, often with known options
  | 'entity-name' // a human label (person/title) — good axis label
  | 'measure' // additive numeric — default sum/avg target
  | 'temporal' // date/timestamp — drives time bucketing
  | 'pk' // primary key
  | 'fk' // foreign key to another entity
  | 'uuid' // opaque id, not a useful dimension by default
  | 'currency' // numeric money — measure + currency formatting
  | 'percentage' // numeric 0..100 — measure + % formatting
  | 'lat'
  | 'lng'

/** Authored overlay for a single column (everything optional — gaps are
 *  filled by `deriveSemanticType`). */
export type SemanticOverlayEntry = {
  semanticType?: SemanticType
  enumOptions?: { value: string; label: string }[]
  fkTarget?: string
}

export type AnalyticsColumn = ReportEntityColumn & {
  semanticType: SemanticType
  enumOptions?: { value: string; label: string }[]
  fkTarget?: string
  /** An array / jsonb-array column the builder can offer to UNNEST (one row per
   *  element) — e.g. a tags column. Set by discovery; such columns are hidden
   *  from the normal dimension/measure pickers. */
  arrayUnnest?: 'array' | 'jsonb'
  /** Derived eligibility (computed once in `buildAnalyticsEntities`). */
  canDimension: boolean
  canMeasure: boolean
  canBinTemporal: boolean
  canBinNumeric: boolean
}

/** A discovered foreign-key relationship — lets the builder/engine follow a FK
 *  to a field on a related entity ("Journals → Site → Name") without a view.
 *  Only RLS-safe targets are ever recorded (see discover.ts). */
export type AnalyticsRelation = {
  /** Local foreign-key column (physical name) pointing at another entity. */
  via: string
  /** Target entity key (table name) — guaranteed to be a discovered RLS-safe entity. */
  target: string
  /** Target column the FK references (usually 'id'). */
  foreignColumn: string
  /** Human label for the relationship, derived from the FK column name. */
  label: string
}

export type AnalyticsEntity = Omit<ReportEntity, 'columns'> & {
  columns: AnalyticsColumn[]
  /** Featured top-level entity (vs an auto-discovered supporting sub-table). */
  primary?: boolean
  /** Foreign-key relationships to other entities (single-hop, RLS-safe targets). */
  relations?: AnalyticsRelation[]
  /** Implicit predicate ALWAYS AND-ed into every query against this entity. Used
   *  for scoped virtual entities — e.g. a per-app `form_responses:<templateId>`
   *  source is the real form_responses table with a baked-in template_id filter,
   *  so each Builder app is its own data source without a stray UUID filter. */
  baseFilter?: ReportRuleGroup
}

/** Authored annotations keyed by entity → column key. Sparse on purpose: only
 *  the columns whose meaning isn't obvious from `kind` need an entry. */
export const SEMANTIC_OVERLAY: Partial<Record<string, Record<string, SemanticOverlayEntry>>> = {
  training_matrix: {
    coverage_status: {
      semanticType: 'category',
      enumOptions: [
        { value: 'valid', label: 'Valid' },
        { value: 'expiring', label: 'Expiring' },
        { value: 'expired', label: 'Expired' },
        { value: 'missing', label: 'Never taken' },
      ],
    },
  },
}

/** Infer a sensible semantic type from a column's kind + name when the overlay
 *  doesn't specify one. */
export function deriveSemanticType(col: ReportEntityColumn): SemanticType {
  switch (col.kind) {
    case 'uuid':
      if (col.key === 'id') return 'pk'
      if (col.key.endsWith('_id')) return 'fk'
      return 'uuid'
    case 'date':
    case 'timestamp':
      return 'temporal'
    case 'number':
      return 'measure'
    case 'enum':
      return 'category'
    case 'text':
      return /(^|_)(name|title|first_name|last_name)($|_)/.test(col.key)
        ? 'entity-name'
        : 'dimension'
    default:
      return 'dimension'
  }
}

function decorate(col: ReportEntityColumn, overlay?: SemanticOverlayEntry): AnalyticsColumn {
  const semanticType = overlay?.semanticType ?? deriveSemanticType(col)
  const kind: ReportColumnKind = col.kind
  const isNumber = kind === 'number'
  const isTemporal = kind === 'date' || kind === 'timestamp'
  return {
    ...col,
    semanticType,
    enumOptions: overlay?.enumOptions,
    fkTarget: overlay?.fkTarget,
    // A primary key is unique → useless to group by; everything else is fair game.
    canDimension: semanticType !== 'pk',
    // count/count_distinct work on anything, but sum/avg/min/max need a number.
    canMeasure: isNumber,
    canBinTemporal: isTemporal,
    canBinNumeric: isNumber && semanticType !== 'percentage',
  }
}

export function buildAnalyticsEntities(): AnalyticsEntity[] {
  return REPORT_ENTITIES.map((entity) => {
    const overlay = SEMANTIC_OVERLAY[entity.key]
    return {
      ...entity,
      columns: entity.columns.map((col) => decorate(col, overlay?.[col.key])),
    }
  })
}

export const ANALYTICS_ENTITIES: AnalyticsEntity[] = buildAnalyticsEntities()

export const ANALYTICS_ENTITY_MAP: Record<string, AnalyticsEntity> = Object.fromEntries(
  ANALYTICS_ENTITIES.map((e) => [e.key, e]),
)

export function analyticsEntity(key: string): AnalyticsEntity | null {
  return ANALYTICS_ENTITY_MAP[key] ?? null
}

export function analyticsColumn(entity: AnalyticsEntity, key: string): AnalyticsColumn | null {
  return entity.columns.find((c) => c.key === key) ?? null
}
