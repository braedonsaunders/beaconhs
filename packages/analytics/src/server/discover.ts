// Dynamic entity discovery — introspects the Drizzle schema so EVERY tenant-scoped
// table is automatically queryable in Insights with ZERO hand-maintenance. Add a
// table or column to the schema and it shows up in the builder on the next reload.
//
// Server-only (imports the drizzle schema + drizzle-orm runtime). Memoized for the
// process. The curated overlay only adds nice labels/categories on top of what's
// discovered — it never gates what's available.

import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '@beaconhs/db/schema'
import { TENANT_SCOPED_TABLES } from '@beaconhs/db/rls'
import type { ReportColumnKind } from '@beaconhs/reports/entities'
import {
  buildAnalyticsEntities,
  deriveSemanticType,
  type AnalyticsColumn,
  type AnalyticsEntity,
  type AnalyticsRelation,
  type SemanticType,
} from '../semantic'

/** Columns never worth exposing in the builder. */
const HIDDEN_COLUMNS = new Set(['tenant_id'])

/** SECURITY BOUNDARY: only tables registered for RLS are queryable. They are
 *  tenant-isolated by FORCE ROW LEVEL SECURITY, so a tenant session can only ever
 *  read its own rows. Anything NOT here — the `tenants` registry, the Better-Auth
 *  user/session tables, any global table — has no tenant_id + no RLS and must
 *  NEVER be exposed (querying `tenants` would leak every tenant on the server). */
const RLS_SAFE = new Set<string>(TENANT_SCOPED_TABLES)

/** RLS-safe but not analytical business data (system / admin / meta) — hidden so
 *  the builder shows real data, not internal plumbing. */
const EXCLUDE_TABLES = new Set<string>([
  'tenant_users',
  'roles',
  'role_assignments',
  'attachments',
  'audit_log',
  'api_keys',
  'notifications',
  'notification_preferences',
  'webpush_subscriptions',
  'ai_conversations',
  'ai_messages',
  'user_dashboard_layouts',
  'tenant_nav_config',
  'kiosk_scans',
  'email_log',
  'data_sources',
  'data_source_rows',
  'sync_connections',
  'sync_crosswalk',
  'sync_runs',
  'report_schedules',
  'report_runs',
  'domain_event_outbox',
  'domain_event_effects',
  // The BI tables themselves aren't analytical data.
  'insight_dashboards',
  'insight_cards',
  'insight_dashboard_pins',
])

type Overlay = {
  label?: string
  description?: string
  category?: string
  primary?: boolean
  hide?: string[]
}

/** Nice labels / categories / "primary" flags for the headline tables. Everything
 *  else is auto-labelled. (forms → "Builder apps" per the rebrand.) */
const OVERLAY: Record<string, Overlay> = {
  incidents: { label: 'Incidents', category: 'Incidents', primary: true },
  corrective_actions: {
    label: 'Corrective actions',
    category: 'Corrective actions',
    primary: true,
  },
  people: { label: 'People', category: 'People & org', primary: true },
  journal_entries: { label: 'Journals', category: 'Journals', primary: true },
  training_records: { label: 'Training records', category: 'Training', primary: true },
  inspection_records: { label: 'Inspections', category: 'Inspections', primary: true },
  documents: { label: 'Documents', category: 'Documents', primary: true },
  equipment_items: { label: 'Equipment', category: 'Equipment', primary: true },
  ppe_items: { label: 'PPE', category: 'PPE', primary: true },
  hazid_assessments: { label: 'Hazard assessments', category: 'Hazard assessments', primary: true },
  compliance_obligations: {
    label: 'Compliance obligations',
    category: 'Compliance',
    primary: true,
  },
  compliance_status: { label: 'Compliance status', category: 'Compliance', primary: true },
  form_responses: {
    label: 'Builder apps',
    description: 'Submitted Builder app responses across every app / form template.',
    category: 'Builder apps',
    primary: true,
  },
  org_units: { label: 'Locations & org units', category: 'People & org', primary: true },
  training_skill_assignments: { label: 'Skill assignments', category: 'Training', primary: true },
}

/** Table-name prefix → category for everything not in the overlay. */
const PREFIX_CATEGORY: [string, string][] = [
  ['incident_', 'Incidents'],
  ['ca_', 'Corrective actions'],
  ['training_', 'Training'],
  ['hazid_', 'Hazard assessments'],
  ['form_', 'Builder apps'],
  ['ppe_', 'PPE'],
  ['equipment_', 'Equipment'],
  ['truck_', 'Equipment'],
  ['document_', 'Documents'],
  ['inspection_', 'Inspections'],
  ['journal_', 'Journals'],
  ['compliance_', 'Compliance'],
  ['person_', 'People & org'],
  ['people_', 'People & org'],
  ['customer_', 'People & org'],
  ['role', 'People & org'],
  ['insight_', 'Insights'],
  ['report_', 'Reports'],
  ['safe_distance', 'Tools'],
  ['kiosk', 'Tools'],
  ['notification', 'Notifications'],
  ['webpush', 'Notifications'],
  ['email_', 'Notifications'],
  ['api_', 'Admin'],
  ['audit', 'Admin'],
  ['tenant_', 'Admin'],
  ['data_source', 'Admin'],
  ['sync_', 'Admin'],
  ['ai_', 'AI'],
  ['job_title', 'People & org'],
]

function humanize(name: string): string {
  const t = name
    .replace(/_/g, ' ')
    .replace(/\bid\b/g, 'ID')
    .trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function categoryFor(table: string): string {
  for (const [p, c] of PREFIX_CATEGORY) if (table.startsWith(p)) return c
  return 'Other data'
}

/** Extract single-column foreign keys as relationships the builder/engine can
 *  follow. SECURITY: a relation is recorded ONLY when its target table is itself
 *  RLS-safe and not excluded — so you can never join your way into `tenants`,
 *  the global Better-Auth `users` table, or any non-tenant-isolated table. The
 *  caller post-filters to targets that ended up as discovered entities. */
function relationsFor(value: PgTable, hide: Set<string>): AnalyticsRelation[] {
  const rels: AnalyticsRelation[] = []
  let foreignKeys: ReturnType<typeof getTableConfig>['foreignKeys']
  try {
    foreignKeys = getTableConfig(value).foreignKeys
  } catch {
    return rels
  }
  const seen = new Set<string>()
  for (const fk of foreignKeys) {
    const ref = fk.reference()
    if (ref.columns.length !== 1 || ref.foreignColumns.length !== 1) continue // single-col FKs only
    const via = ref.columns[0]!.name
    const foreignColumn = ref.foreignColumns[0]!.name
    const target = getTableName(ref.foreignTable)
    if (hide.has(via) || seen.has(via)) continue
    if (!RLS_SAFE.has(target) || EXCLUDE_TABLES.has(target)) continue
    seen.add(via)
    rels.push({ via, target, foreignColumn, label: humanize(via.replace(/_id$/, '')) })
  }
  return rels
}

/** Map a Drizzle column to a report column kind, or null to skip it. */
function kindOf(col: {
  columnType?: unknown
  dataType?: unknown
  enumValues?: unknown
}): ReportColumnKind | null {
  if (Array.isArray(col.enumValues) && col.enumValues.length) return 'enum'
  const ct = String(col.columnType ?? '')
  const dt = String(col.dataType ?? '')
  if (/UUID/i.test(ct)) return 'uuid'
  if (/Timestamp/i.test(ct)) return 'timestamp'
  if (/Date/i.test(ct)) return 'date'
  if (/Boolean/i.test(ct) || dt === 'boolean') return 'enum'
  if (dt === 'buffer') return null
  // Array / jsonb columns are exposed as text but only for UNNEST (see the loop
  // in discoverEntities, which flags them + hides them from normal pickers).
  if (dt === 'array' || dt === 'json') return 'text'
  if (
    dt === 'number' ||
    dt === 'bigint' ||
    /Integer|Numeric|Real|Double|Serial|Smallint/i.test(ct)
  ) {
    return 'number'
  }
  if (/Text|Varchar|Char/i.test(ct) || dt === 'string') return 'text'
  return null
}

function flagsFor(kind: ReportColumnKind, semanticType: SemanticType) {
  const isNumber = kind === 'number'
  const isTemporal = kind === 'date' || kind === 'timestamp'
  return {
    canDimension: semanticType !== 'pk',
    canMeasure: isNumber,
    canBinTemporal: isTemporal,
    canBinNumeric: isNumber && semanticType !== 'percentage',
  }
}

let CACHE: AnalyticsEntity[] | null = null

/** All queryable entities, discovered from the schema + the curated overlay +
 *  the hand-built reporting VIEWs (training matrix, skills roster). Memoized. */
function discoverSchemaEntities(): AnalyticsEntity[] {
  if (CACHE) return CACHE
  const entities: AnalyticsEntity[] = []
  const curatedEntities = buildAnalyticsEntities()
  const curatedByTable = new Map(
    curatedEntities
      .filter((entity) => !entity.table.startsWith('report_'))
      .map((entity) => [entity.table, entity]),
  )

  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue
    const table = getTableName(value)
    // Security gate: only RLS-registered (tenant-isolated) tables, minus the
    // system/meta tables that aren't analytical data.
    if (!RLS_SAFE.has(table) || EXCLUDE_TABLES.has(table)) continue
    const overlay = OVERLAY[table] ?? {}
    const hide = new Set([...HIDDEN_COLUMNS, ...(overlay.hide ?? [])])

    const columns: AnalyticsColumn[] = []
    for (const col of Object.values(getTableColumns(value)) as Array<{
      name: string
      columnType?: unknown
      dataType?: unknown
      enumValues?: unknown
    }>) {
      if (hide.has(col.name)) continue
      const kind = kindOf(col)
      if (!kind) continue
      const dt = String(col.dataType ?? '')
      const arrayUnnest: 'array' | 'jsonb' | undefined =
        dt === 'array' ? 'array' : dt === 'json' ? 'jsonb' : undefined
      const base = { key: col.name, label: humanize(col.name), kind }
      const semanticType: SemanticType =
        col.name === 'id'
          ? 'pk'
          : Array.isArray(col.enumValues) && col.enumValues.length
            ? 'category'
            : deriveSemanticType(base)
      const enumOptions =
        Array.isArray(col.enumValues) && col.enumValues.length
          ? (col.enumValues as string[]).map((v) => ({ value: v, label: humanize(v) }))
          : undefined
      // Array/jsonb columns are usable only via UNNEST — flag them and keep them
      // out of the plain dimension/measure/bin pickers.
      const overrides = arrayUnnest
        ? {
            arrayUnnest,
            canDimension: false,
            canMeasure: false,
            canBinTemporal: false,
            canBinNumeric: false,
          }
        : {}
      columns.push({
        ...base,
        semanticType,
        enumOptions,
        ...flagsFor(kind, semanticType),
        ...overrides,
      })
    }
    if (columns.length === 0) continue

    const curated = curatedByTable.get(table)
    const curatedColumns = new Map(curated?.columns.map((column) => [column.key, column]) ?? [])
    const mergedColumns = columns.map((column) => {
      const authored = curatedColumns.get(column.key)
      return authored ? { ...column, ...authored } : column
    })
    const curatedCategory = curated
      ? curated.category.charAt(0).toUpperCase() + curated.category.slice(1)
      : null

    entities.push({
      key: table,
      label: curated?.label ?? overlay.label ?? humanize(table),
      category: curatedCategory ?? overlay.category ?? categoryFor(table),
      description: curated?.description ?? overlay.description ?? '',
      table,
      columns: mergedColumns,
      primary: overlay.primary ?? false,
      relations: relationsFor(value, hide),
      ...(curated?.defaultSort ? { defaultSort: curated.defaultSort } : {}),
      ...(curated?.softDelete ? { softDelete: true } : {}),
    })
  }

  // The reporting VIEWs aren't Drizzle tables — pull the curated ones in.
  // Normalize their (lower-case) report category to match the discovered ones.
  for (const e of curatedEntities) {
    if (e.table.startsWith('report_')) {
      const category = e.category.charAt(0).toUpperCase() + e.category.slice(1)
      entities.push({ ...e, category, primary: true })
    }
  }

  // Drop relations whose target didn't end up as a discovered entity (e.g. an
  // RLS-safe but column-less table) — the engine only ever joins real entities.
  const keys = new Set(entities.map((e) => e.key))
  for (const e of entities) {
    if (e.relations?.length) e.relations = e.relations.filter((r) => keys.has(r.target))
  }

  // Primary entities first, then alphabetical within category.
  entities.sort(
    (a, b) =>
      Number(b.primary ?? false) - Number(a.primary ?? false) ||
      a.category.localeCompare(b.category) ||
      a.label.localeCompare(b.label),
  )

  CACHE = entities
  return entities
}

/**
 * Public analytics catalog.
 *
 * Builder storage is deliberately absent. A caller may only add a scoped
 * `form_responses:<templateId>` entity after it has authorized that template.
 * Keeping the raw tables out here also prevents relation traversal from
 * smuggling a query into form plumbing.
 */
export function discoverEntities(): AnalyticsEntity[] {
  const safe = discoverSchemaEntities().filter((entity) => !entity.table.startsWith('form_'))
  const keys = new Set(safe.map((entity) => entity.key))
  return safe.map((entity) => ({
    ...entity,
    relations: entity.relations?.filter((relation) => keys.has(relation.target)),
  }))
}

const FORM_ENTITY_KEY = 'form_responses'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let MAP_CACHE: Record<string, AnalyticsEntity> | null = null
function baseEntityMap(): Record<string, AnalyticsEntity> {
  if (!MAP_CACHE) MAP_CACHE = Object.fromEntries(discoverSchemaEntities().map((e) => [e.key, e]))
  return MAP_CACHE
}

/** Build a per-app entity: the real form_responses table scoped to ONE Builder
 *  app via an implicit template_id filter. `label` (the app name) is shown in the
 *  studio source picker. The scope lives in the
 *  `form_responses:<templateId>` key and its implicit template filter. */
export function scopedFormAppEntity(templateId: string, label?: string): AnalyticsEntity | null {
  if (!UUID_RE.test(templateId)) return null
  const base = baseEntityMap()[FORM_ENTITY_KEY]
  if (!base) return null
  return {
    ...base,
    key: `${FORM_ENTITY_KEY}:${templateId}`,
    label: label ?? base.label,
    description: label ? `Submitted responses for the “${label}” app.` : base.description,
    primary: false,
    baseFilter: {
      combinator: 'and',
      rules: [{ field: 'template_id', op: 'eq', value: templateId }],
    },
  }
}

/** Safe default entity map for validation/compilation. Builder app entities are
 *  intentionally absent and must be injected by an authorization-aware caller. */
export function discoverEntityMap(): Record<string, AnalyticsEntity> {
  return Object.fromEntries(discoverEntities().map((entity) => [entity.key, entity]))
}

/**
 * Narrowly trusted addition for code-owned system cards. Never use this for a
 * stored/custom query: it intentionally exposes a tenant-wide aggregate source.
 */
export function addTrustedSystemFormEntity(
  entityMap: Record<string, AnalyticsEntity>,
): Record<string, AnalyticsEntity> {
  const formResponses = baseEntityMap()[FORM_ENTITY_KEY]
  return formResponses ? { ...entityMap, [FORM_ENTITY_KEY]: formResponses } : { ...entityMap }
}
