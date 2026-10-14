import { sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { z } from 'zod'
import type { Database } from '@beaconhs/db'
import type { BriefFact } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { ResolvedBriefWindow } from '../window'

/** One record a source hands to the writer (and keeps as evidence). */
export type BriefSourceRecord = {
  id: string
  /** In-app path to open the record. */
  path: string
  /** Local date (YYYY-MM-DD) the record is about. */
  date: string
  title: string
  author: string | null
  department: string | null
  site: string | null
  status: string | null
  /** Full text the writer reads (already bounded by the source). */
  text: string
}

export type BriefSourceScope = {
  /** Limit to records belonging to this department (split schedules). */
  departmentId: string | null
}

type BriefSourceCollection = {
  records: BriefSourceRecord[]
  facts: BriefFact[]
  /** Records that matched but were left out to stay within the record cap. */
  truncated: number
}

export type BriefSourceParamField =
  | { key: string; label: string; kind: 'boolean'; help?: string }
  | {
      key: string
      label: string
      kind: 'multi'
      options: Array<{ value: string; label: string }>
      help?: string
    }

export type BriefSourceDefinition<P extends Record<string, unknown>> = {
  key: string
  label: string
  description: string
  /** Citation prefix the writer sees, e.g. 'J' → J1, J2… */
  citationPrefix: string
  params: z.ZodType<P>
  defaultParams: P
  /** Studio controls for the authorable params (API callers may set more). */
  paramFields: BriefSourceParamField[]
  /** Whether this member may use the source at all (read tier ≥ self). */
  canRead(ctx: RequestContext): boolean
  collect(args: {
    ctx: RequestContext
    tx: Database
    window: ResolvedBriefWindow
    params: P
    scope: BriefSourceScope
    limit: number
  }): Promise<BriefSourceCollection>
}

/** Plain text bounded for the writer: collapsed whitespace, hard length cap. */
export function boundedText(value: string | null | undefined, max = 1_500): string {
  const clean = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function personName(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const name = [first, last].filter(Boolean).join(' ').trim()
  return name || null
}

// Correlated lookups use aliased raw identifiers: Drizzle renders column
// chunks unqualified on join-free selects, so a bare `people.department_id`
// inside a subquery could bind to the outer table instead.

/** The department of the person linked to a tenant user (null when unlinked). */
export function tenantUserDepartmentSql(tenantUserCol: PgColumn | SQL): SQL<string | null> {
  return sql<string | null>`(
    select bp.department_id from people bp
    inner join tenant_users btu on btu.user_id = bp.user_id and btu.tenant_id = bp.tenant_id
    where btu.id = ${tenantUserCol} and bp.deleted_at is null
    limit 1
  )`
}

/** Display name of the person linked to a tenant user, else the member's display name. */
export function tenantUserNameSql(tenantUserCol: PgColumn | SQL): SQL<string | null> {
  return sql<string | null>`(
    select coalesce(
      nullif(btrim(coalesce(bp.first_name, '') || ' ' || coalesce(bp.last_name, '')), ''),
      btu.display_name
    )
    from tenant_users btu
    left join people bp on bp.user_id = btu.user_id and bp.tenant_id = btu.tenant_id
      and bp.deleted_at is null
    where btu.id = ${tenantUserCol}
    limit 1
  )`
}

export function departmentNameSql(departmentIdExpr: PgColumn | SQL): SQL<string | null> {
  return sql<
    string | null
  >`(select bd.name from departments bd where bd.id = ${departmentIdExpr} limit 1)`
}

export function siteNameSql(siteCol: PgColumn | SQL): SQL<string | null> {
  return sql<string | null>`(select bo.name from org_units bo where bo.id = ${siteCol} limit 1)`
}

/** Local YYYY-MM-DD of a timestamp column in the window's timezone. */
export function localDateSql(column: PgColumn | SQL, timeZone: string): SQL<string> {
  return sql<string>`to_char(${column} at time zone ${timeZone}, 'YYYY-MM-DD')`
}

/** Count rows per label, most frequent first. */
export function tally(values: Array<string | null>, unknown = 'Unassigned') {
  const counts = new Map<string, number>()
  for (const value of values) {
    const label = value?.trim() || unknown
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, value: String(count) }))
}

export const ENUM_LABEL = (value: string | null | undefined): string | null =>
  value ? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null
