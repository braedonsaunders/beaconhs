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
  'tenant_notification_recipients',
  'tenant_plugins',
  'tenant_plugin_secrets',
  'plugin_runs',
  'plugin_events',
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
  ['plugin', 'Admin'],
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
export function discoverEntities(): AnalyticsEntity[] {
  if (CACHE) return CACHE
  const entities: AnalyticsEntity[] = []

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

    entities.push({
      key: table,
      label: overlay.label ?? humanize(table),
      category: overlay.category ?? categoryFor(table),
      description: overlay.description ?? '',
      table,
      columns,
      primary: overlay.primary ?? false,
      relations: relationsFor(value, hide),
    })
  }

  // The reporting VIEWs aren't Drizzle tables — pull the curated ones in.
  // Normalize their (lower-case) report category to match the discovered ones.
  for (const e of buildAnalyticsEntities()) {
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

const FORM_ENTITY_KEY = 'form_responses'
const SCOPED_FORM_RE = /^form_responses:([0-9a-fA-F-]{36})$/

let MAP_CACHE: Record<string, AnalyticsEntity> | null = null
function baseEntityMap(): Record<string, AnalyticsEntity> {
  if (!MAP_CACHE) MAP_CACHE = Object.fromEntries(discoverEntities().map((e) => [e.key, e]))
  return MAP_CACHE
}

/** Build a per-app entity: the real form_responses table scoped to ONE Builder
 *  app via an implicit template_id filter. `label` (the app name) is shown in the
 *  studio source picker; it's omitted for stateless compile/render resolution
 *  (the scope lives entirely in the `form_responses:<templateId>` key). */
export function scopedFormAppEntity(templateId: string, label?: string): AnalyticsEntity | null {
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

/** Entity map for validate/compile. A Proxy resolves `form_responses:<templateId>`
 *  source keys to a scoped per-app entity on demand — so a card saved against one
 *  Builder app re-renders later with NO tenant lookup (the template id is in the
 *  key, the columns come from the static form_responses entity). */
export function discoverEntityMap(): Record<string, AnalyticsEntity> {
  const base = baseEntityMap()
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) {
        const m = SCOPED_FORM_RE.exec(prop)
        if (m) return scopedFormAppEntity(m[1]!) ?? undefined
      }
      return target[prop as string]
    },
    has(target, prop) {
      return prop in target || (typeof prop === 'string' && SCOPED_FORM_RE.test(prop))
    },
  })
}
