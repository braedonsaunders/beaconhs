// Row predicates for journal mutations. Plain server module (not 'use server')
// shared by the Journals actions and the `journals` record saver, so every
// write path applies the same author/visibility scope.

import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { journalEntries } from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import {
  journalCanReadAll,
  journalSelfScopeWhere,
  journalScopeWhere,
} from '@beaconhs/tenant/journal-scope'
import { isUuid } from '@/lib/list-params'
import { getAuthorPersonId } from './_lib'
import { journalMutationScope, type JournalMutation } from './_mutation-policy'

/** Visibility-scoped WHERE for a single live entry (tenant + author/site/self).
 *  Always excludes soft-deleted entries — a deleted journal is not editable. */
export async function journalReadWhere(
  ctx: RequestContext,
  id: string,
  tx?: Database,
): Promise<SQL> {
  if (!isUuid(id)) return sql`false`
  const authorPersonId = journalCanReadAll(ctx) ? null : await getAuthorPersonId(ctx, tx)
  const scope = journalScopeWhere(ctx, authorPersonId)
  return and(eq(journalEntries.id, id), isNull(journalEntries.deletedAt), scope)!
}

/**
 * Mutations cannot reuse the read predicate blindly: `journals.update.own`
 * remains own-only even when a custom role also has site/all read access.
 * `journals.assign` is the explicit permission that widens writes to the
 * caller's normal read scope. Edits additionally require an unlocked draft
 * unless `requireDraft` is false (delete, unlock, and the record saver, which
 * tells "not yours" apart from "submitted").
 */
export async function journalMutationWhere(
  ctx: RequestContext,
  id: string,
  mutation: JournalMutation,
  options: { requireDraft?: boolean; tx?: Database } = {},
): Promise<SQL> {
  if (!isUuid(id)) return sql`false`
  const scope = journalMutationScope(ctx, mutation)
  if (scope === 'none') return sql`false`
  const owned =
    scope === 'read_scope'
      ? await journalReadWhere(ctx, id, options.tx)
      : and(
          eq(journalEntries.id, id),
          isNull(journalEntries.deletedAt),
          journalSelfScopeWhere(ctx, await getAuthorPersonId(ctx, options.tx)),
        )!
  return mutation === 'edit' && options.requireDraft !== false
    ? and(owned, eq(journalEntries.status, 'draft'), isNull(journalEntries.lockedAt))!
    : owned
}

/** A real calendar date in strict `YYYY-MM-DD` form. */
export function isJournalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
