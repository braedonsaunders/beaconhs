// Server-only helpers for the Journals module. Not a 'use server' file — these
// are plain functions consumed by the page (server component), the query layer
// and the action layer.

import { and, count, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { journalEntries, people } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'

/** Can this context read every journal in the tenant (vs site/self scope)? */
export function journalCanReadAll(ctx: RequestContext): boolean {
  return ctx.isSuperAdmin || can(ctx, 'journals.read.all')
}

/** Managers/safety who may browse beyond their own entries (records page gate). */
export function journalCanBrowseAll(ctx: RequestContext): boolean {
  return journalCanReadAll(ctx) || can(ctx, 'journals.read.site')
}

/**
 * Visibility predicate for journal_entries based on the caller's scope:
 *   read.all  → no extra filter (RLS already bounds to tenant)
 *   read.site → entries at the caller's scoped sites
 *   read.self → entries authored by, or created by, the caller
 */
export function journalScopeWhere(
  ctx: RequestContext,
  authorPersonId: string | null,
): SQL | undefined {
  if (journalCanReadAll(ctx)) return undefined

  if (can(ctx, 'journals.read.site')) {
    const siteIds = ctx.scopes.flatMap((s) => (s.type === 'sites' ? s.siteIds : []))
    if (siteIds.length > 0) return inArray(journalEntries.siteOrgUnitId, siteIds)
  }

  const conds: SQL[] = []
  if (authorPersonId) conds.push(eq(journalEntries.personId, authorPersonId))
  if (ctx.membership?.id) conds.push(eq(journalEntries.createdByTenantUserId, ctx.membership.id))
  if (conds.length === 0) return sql`false`
  return conds.length === 1 ? conds[0] : or(...conds)
}

/**
 * Self-ONLY visibility — the caller's own entries (authored as, or created by,
 * them), regardless of read.all / read.site. The compose workspace (/journals)
 * is always personal; cross-user browsing lives in /journals/records (gated by
 * journalCanBrowseAll). Uses authorTenantUserId so the super-admin sentinel is
 * never compared as a uuid; a context with no person and no membership resolves
 * to `false` (an empty personal workspace), never the whole tenant.
 */
export function journalSelfScopeWhere(
  ctx: RequestContext,
  authorPersonId: string | null,
): SQL {
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

/** Resolve the `people` row for the current user (the journal's subject). */
export async function getAuthorPersonId(ctx: RequestContext): Promise<string | null> {
  return ctx.db(async (tx) => {
    const [p] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    return p?.id ?? null
  })
}

/** Next per-tenant reference like JRN-2026-0001 (RLS scopes the count). */
export async function nextJournalReference(tx: Database, year: number): Promise<string> {
  const [row] = await tx
    .select({ c: count() })
    .from(journalEntries)
    .where(sql`extract(year from ${journalEntries.entryDate}) = ${year}`)
  return `JRN-${year}-${String(Number(row?.c ?? 0) + 1).padStart(4, '0')}`
}

/** Today as an ISO date (YYYY-MM-DD) in server local time. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Flatten TipTap HTML into readable plaintext for search + AI + snippets. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\s*>/gi, '$&\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Short single-line preview for list cards. */
export function snippetOf(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * True when `s` is a canonical UUID. Used to reject non-id path params so the
 * dynamic `/journals/[id]` route 404s cleanly instead of crashing Postgres on a
 * malformed uuid (e.g. a stray `/journals/<typo>`).
 */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
