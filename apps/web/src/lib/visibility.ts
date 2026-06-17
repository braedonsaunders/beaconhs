// Configurable record-visibility resolver.
//
// Turns a user's role-assignment scopes (RoleScope) into a WHERE predicate over
// a record's "owner" columns, so a limited user sees only: their own records ·
// own + a hand-picked set of people · a department (people in chosen divisions
// and/or groups) · specific sites · or everybody. Each record list calls this
// inside its query and ANDs the result into its filters.
//
// Super-admins and anyone holding a `tenant` scope see everything (returns
// undefined). Division/group membership is read from the denormalised
// people.divisionIds / people.groupIds caches, so no extra joins are needed.

import { eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { people } from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'

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
      if (s.divisionIds.length > 0)
        member.push(sql`jsonb_exists_any(${people.divisionIds}, ${textArray(s.divisionIds)})`)
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
