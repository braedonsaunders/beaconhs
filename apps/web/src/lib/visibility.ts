// Configurable record-visibility resolver.
//
// Turns a user's role-assignment scopes (RoleScope) into a WHERE predicate over
// a record's "owner" columns, so a limited user sees only: their own records ·
// own + a hand-picked set of people · a department (people in chosen departments
// and/or groups) · specific sites · or everybody. Each record list calls this
// inside its query and ANDs the result into its filters.
//
// Super-admins and anyone holding a `tenant` scope see everything (returns
// undefined). Department membership is read from people.departmentId and group
// membership from the denormalised people.groupIds cache, so no extra joins are
// needed.

import { eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { people } from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import { can, type RequestContext } from '@beaconhs/tenant'

export type RecordOwnerColumns = {
  /** Person the record is about/assigned to (holder, owner, assignee, author). */
  personCol?: PgColumn
  /** tenant_users id of whoever created the record. */
  createdByCol?: PgColumn
  /** The record's site/org unit, for the `sites` scope. */
  siteCol?: PgColumn
}

/** A safe, parameterised `array['a','b']::text[]` literal. */
function textArray(ids: string[]): SQL {
  return sql`array[${sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  )}]::text[]`
}

async function resolveMyPersonId(ctx: RequestContext, tx: Database): Promise<string | null> {
  const [p] = await tx
    .select({ id: people.id })
    .from(people)
    .where(eq(people.userId, ctx.userId))
    .limit(1)
  return p?.id ?? null
}

/**
 * Build the visibility predicate for a record list from the caller's scopes.
 * Returns `undefined` (no filter) for super-admins and tenant-scoped users;
 * otherwise unions own records with every scope the user holds. A user whose
 * scopes resolve to nothing sees an empty list — never the whole tenant.
 *
 * Call inside the list query's `ctx.db((tx) => …)` so the people sub-selects run
 * under the same RLS-bounded transaction.
 */
export async function recordVisibilityWhere(
  ctx: RequestContext,
  tx: Database,
  cols: RecordOwnerColumns,
): Promise<SQL | undefined> {
  if (ctx.isSuperAdmin) return undefined
  const scopes = ctx.scopes
  if (scopes.some((s) => s.type === 'tenant')) return undefined

  const conds: SQL[] = []

  // Always include the caller's own records (as subject and/or creator).
  if (cols.personCol) {
    const mine = await resolveMyPersonId(ctx, tx)
    if (mine) conds.push(eq(cols.personCol, mine))
  }
  const myUserId = ctx.membership?.id
  if (cols.createdByCol && myUserId && myUserId !== 'super-admin') {
    conds.push(eq(cols.createdByCol, myUserId))
  }

  for (const s of scopes) {
    if (s.type === 'sites' && cols.siteCol && s.siteIds.length > 0) {
      conds.push(inArray(cols.siteCol, s.siteIds))
    } else if (s.type === 'people' && cols.personCol && s.personIds.length > 0) {
      conds.push(inArray(cols.personCol, s.personIds))
    } else if (s.type === 'crews' && cols.personCol && s.crewIds.length > 0) {
      conds.push(
        inArray(
          cols.personCol,
          tx.select({ id: people.id }).from(people).where(inArray(people.crewId, s.crewIds)),
        ),
      )
    } else if (s.type === 'team' && cols.personCol) {
      const member: SQL[] = []
      if (s.departmentIds.length > 0) member.push(inArray(people.departmentId, s.departmentIds))
      if (s.groupIds.length > 0)
        member.push(sql`jsonb_exists_any(${people.groupIds}, ${textArray(s.groupIds)})`)
      const memberWhere = or(...member)
      if (memberWhere) {
        conds.push(
          inArray(cols.personCol, tx.select({ id: people.id }).from(people).where(memberWhere)),
        )
      }
    }
  }

  // No scope grants anything → see nothing (defensive; never fall through to all).
  if (conds.length === 0) return sql`false`
  return conds.length === 1 ? conds[0] : or(...conds)
}

// ---------------------------------------------------------------------------
// Tiered per-module record visibility (the "most people see only their own"
// model). Permission-driven (not scope-driven like recordVisibilityWhere above):
// each record module declares `<prefix>.read.{all,site,self}` keys, and these
// helpers turn the caller's tier into a list predicate (`moduleScopeWhere`) or a
// single-record guard (`canSeeRecord`). Generalises the Journals approach
// (journals/_lib.ts `journalScopeWhere`) to every record module.
// ---------------------------------------------------------------------------

export type VisibilityTier = 'all' | 'site' | 'self'

/**
 * The record-visibility tier this context holds for a module, from its tiered
 * read permissions: `<prefix>.read.all` (or super-admin) → all; `.read.site` →
 * site; otherwise self (the safe default — a role with no read tier still only
 * ever sees its own records, never the whole tenant).
 */
export function resolveVisibilityTier(ctx: RequestContext, prefix: string): VisibilityTier {
  if (ctx.isSuperAdmin || can(ctx, `${prefix}.read.all`)) return 'all'
  if (can(ctx, `${prefix}.read.site`)) return 'site'
  return 'self'
}

function mySiteIds(ctx: RequestContext): string[] {
  return ctx.scopes.flatMap((s) => (s.type === 'sites' ? s.siteIds : []))
}

function myTenantUserId(ctx: RequestContext): string | null {
  const id = ctx.membership?.id
  return !id || id === 'super-admin' ? null : id
}

export type ModuleScopeCols = {
  /** Permission-key prefix, e.g. 'incidents' | 'ca' | 'hazid' | 'inspections' | 'forms.response'. */
  prefix: string
  /** tenant_users columns identifying who owns/created/submitted the record. */
  ownerCols?: PgColumn[]
  /** The record's site/org-unit column, for the `site` tier. */
  siteCol?: PgColumn
  /** A person column when the viewer can also be the record's SUBJECT. */
  personCol?: PgColumn
}

/** The "this record is mine" conditions: an owner column equals me, or I'm the subject. */
async function ownPredicates(
  ctx: RequestContext,
  tx: Database,
  cols: ModuleScopeCols,
): Promise<SQL[]> {
  const conds: SQL[] = []
  const tuId = myTenantUserId(ctx)
  if (tuId && cols.ownerCols) for (const c of cols.ownerCols) conds.push(eq(c, tuId))
  if (cols.personCol) {
    const pid = await resolveMyPersonId(ctx, tx)
    if (pid) conds.push(eq(cols.personCol, pid))
  }
  return conds
}

/**
 * List predicate enforcing the caller's read tier for a module. AND this into a
 * list query's WHERE. Returns:
 *   all  → undefined (no extra filter; RLS already bounds to tenant)
 *   site → records at the caller's scoped sites, unioned with their own
 *   self → records the caller owns/created or is the subject of (else `false`)
 * Call inside `ctx.db((tx) => …)` so the person sub-select runs under the same tx.
 */
export async function moduleScopeWhere(
  ctx: RequestContext,
  tx: Database,
  cols: ModuleScopeCols,
): Promise<SQL | undefined> {
  const tier = resolveVisibilityTier(ctx, cols.prefix)
  if (tier === 'all') return undefined

  const ownConds = await ownPredicates(ctx, tx, cols)

  if (tier === 'site' && cols.siteCol) {
    const sites = mySiteIds(ctx)
    if (sites.length > 0) return or(inArray(cols.siteCol, sites), ...ownConds)
    // read.site but no site scope assigned → fall through to own-only.
  }

  if (ownConds.length === 0) return sql`false`
  return ownConds.length === 1 ? ownConds[0] : or(...ownConds)
}

export type RecordOwnership = {
  prefix: string
  /** tenant_users ids that own/created/submitted the record (nullish ignored). */
  ownerIds?: (string | null | undefined)[]
  siteId?: string | null
  /** person id the record is about, compared to the caller's person. */
  personId?: string | null
}

/**
 * Detail-page guard mirroring `moduleScopeWhere` for a single loaded record —
 * `notFound()` when this returns false. Closes the read-by-guessing-the-URL gap:
 * all → always; site → record at one of my sites (or mine); self → mine only.
 */
export async function canSeeRecord(
  ctx: RequestContext,
  tx: Database,
  rec: RecordOwnership,
): Promise<boolean> {
  const tier = resolveVisibilityTier(ctx, rec.prefix)
  if (tier === 'all') return true
  if (tier === 'site' && rec.siteId && mySiteIds(ctx).includes(rec.siteId)) return true

  const tuId = myTenantUserId(ctx)
  if (tuId && rec.ownerIds?.some((o) => o === tuId)) return true
  if (rec.personId) {
    const pid = await resolveMyPersonId(ctx, tx)
    if (pid && pid === rec.personId) return true
  }
  return false
}
