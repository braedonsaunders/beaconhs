// Journal record visibility, shared by the Journals module (web) and any
// server process that reads journals on a member's behalf (Briefs in the
// worker). Mirrors `moduleScopeWhere` with the journal author resolution.

import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import { journalEntries, people, tenantUsers } from '@beaconhs/db/schema'
import { can, type RequestContext } from './index'
import { recordScopeWhere } from './visibility'

/** Resolve the journal subject first, then its recorded account author in this tenant. */
export function journalAuthorPersonId(): SQL {
  return sql`coalesce(${journalEntries.personId}, (
          select ${people.id} from ${people}
          inner join ${tenantUsers} on ${tenantUsers.userId} = ${people.userId}
            and ${tenantUsers.tenantId} = ${people.tenantId}
          where ${tenantUsers.id} = ${journalEntries.createdByTenantUserId}
            and ${people.tenantId} = ${journalEntries.tenantId}
            and ${people.deletedAt} is null
          limit 1
        ))`
}

/** Can this context read every journal in the tenant (vs site/self scope)? */
export function journalCanReadAll(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'journals.read.all')
}

/** Managers/safety who may browse beyond their own entries (records page gate). */
export function journalCanBrowseAll(ctx: RequestContext): boolean {
  return journalCanReadAll(ctx) || can(ctx, 'journals.read.site')
}

/**
 * Visibility predicate for journal_entries based on the caller's read tier:
 *   read.all  → no extra filter (RLS already bounds to tenant)
 *   read.site → entries in assigned sites, departments, groups, crews or people, UNION own
 *   read.self → only entries authored by, or created by, the caller (default)
 *
 * The caller's OWN entries are visible at every tier — a site-scoped reviewer
 * still sees a journal they wrote at another site or with no site set. This
 * mirrors the generalised `moduleScopeWhere` (see record-visibility model) so
 * journals behave like every other record module.
 */
export function journalScopeWhere(
  ctx: RequestContext,
  authorPersonId: string | null,
): SQL | undefined {
  if (journalCanReadAll(ctx)) return undefined

  if (can(ctx, 'journals.read.site')) {
    return recordScopeWhere(
      { ...ctx, personId: authorPersonId },
      {
        personCol: journalAuthorPersonId(),
        createdByCol: journalEntries.createdByTenantUserId,
        siteCol: journalEntries.siteOrgUnitId,
      },
      false,
    )
  }
  return journalSelfScopeWhere(ctx, authorPersonId)
}

/** A specific author's entries (by subject person and/or the tenant_user who
 *  created them). `false` when neither is known. */
function journalByAuthorWhere(personId: string | null, tenantUserId: string | null): SQL {
  const conds: SQL[] = []
  if (personId) conds.push(eq(journalAuthorPersonId(), personId))
  if (tenantUserId) conds.push(eq(journalEntries.createdByTenantUserId, tenantUserId))
  if (conds.length === 0) return sql`false`
  return conds.length === 1 ? conds[0]! : or(...conds)!
}

/**
 * Visibility for browsing a SPECIFIC author's journals (the records "Open full
 * entry" workspace): the target author's entries, AND-bounded by the viewer's
 * own read tier so an admin never sees beyond their scope (read.all → all of the
 * author's; read.site → the author's within the viewer's assigned data scope).
 */
export function journalAuthorScopeWhere(
  ctx: RequestContext,
  viewerPersonId: string | null,
  target: { personId: string | null; tenantUserId: string | null },
): SQL {
  const byAuthor = journalByAuthorWhere(target.personId, target.tenantUserId)
  const viewer = journalScopeWhere(ctx, viewerPersonId)
  return viewer ? and(byAuthor, viewer)! : byAuthor
}

/**
 * Self-ONLY visibility — the caller's own entries (authored as, or created by,
 * them), regardless of read.all / read.site. The compose workspace (/journals)
 * is always personal; cross-user browsing lives in /journals/records (gated by
 * journalCanBrowseAll). Uses authorTenantUserId so the super-admin sentinel is
 * never compared as a uuid; a context with no person and no membership resolves
 * to `false` (an empty personal workspace), never the whole tenant.
 */
export function journalSelfScopeWhere(ctx: RequestContext, authorPersonId: string | null): SQL {
  const conds: SQL[] = []
  if (authorPersonId) conds.push(eq(journalEntries.personId, authorPersonId))
  const tenantUserId = authorTenantUserId(ctx)
  if (tenantUserId) conds.push(eq(journalEntries.createdByTenantUserId, tenantUserId))
  if (conds.length === 0) return sql`false`
  return conds.length === 1 ? conds[0]! : or(...conds)!
}

/** The tenant_users id to attribute authorship to (null for super-admin view). */
export function authorTenantUserId(ctx: RequestContext): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
}
