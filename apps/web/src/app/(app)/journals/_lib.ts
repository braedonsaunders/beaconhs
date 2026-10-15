// Server-only helpers for the Journals module. Not a 'use server' file — these
// are plain functions consumed by the page (server component), the query layer
// and the action layer.

import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { journalEntries, people, tenantUsers } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
export { htmlToText } from '@beaconhs/forms-core'
import { nextReference } from '@/lib/reference'
import { recordScopeWhere } from '@beaconhs/tenant/visibility'

/**
 * Resolve the `people` row for the current user (the journal's subject).
 * Pass the open transaction when there is one, so the lookup shares it.
 */
export async function getAuthorPersonId(
  ctx: RequestContext,
  tx?: Database,
): Promise<string | null> {
  const find = async (db: Database) => {
    const [p] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    return p?.id ?? null
  }
  return tx ? find(tx) : ctx.db(find)
}

/** Next per-tenant reference like JRN-2026-0001 (RLS scopes the counter). */
export async function nextJournalReference(
  tx: Database,
  tenantId: string,
  year: number,
): Promise<string> {
  return nextReference(tx, tenantId, 'journal', year)
}

/**
 * Today as an ISO date (YYYY-MM-DD) in the given IANA timezone (ctx.timezone).
 * Never uses the server clock's date directly — in prod the container runs UTC,
 * so an evening entry would otherwise land on tomorrow's date for the author.
 */
export function todayISO(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Short single-line preview for list cards. */
export function snippetOf(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}
