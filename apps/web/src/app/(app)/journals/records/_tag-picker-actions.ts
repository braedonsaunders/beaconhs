'use server'

import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { journalEntries, journalEntryTags, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import {
  boundPickerOptions,
  PICKER_RESULT_LIMIT,
  type PickerOptionsResponse,
} from '@/lib/picker-options'
import { parseRemoteSearchInput, remoteSearchTerm } from '@/lib/remote-search-policy'
import { getAuthorPersonId, journalCanBrowseAll, journalScopeWhere } from '../_lib'

async function reviewerScope() {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) throw new Error('Journal records are not available.')
  const authorPersonId = await getAuthorPersonId(ctx)
  return { ctx, scope: journalScopeWhere(ctx, authorPersonId) }
}

/** Search only tags attached to journal records this reviewer may actually open. */
export async function loadJournalRecordTagOptions(input: unknown): Promise<PickerOptionsResponse> {
  const search = parseRemoteSearchInput(input, 'text')
  const { ctx, scope } = await reviewerScope()
  const term = remoteSearchTerm(search.query)

  return ctx.db(async (tx) => {
    const match =
      term || search.selected
        ? or(
            term ? ilike(journalEntryTags.tag, term) : undefined,
            search.selected ? eq(journalEntryTags.tag, search.selected) : undefined,
          )
        : undefined
    const rows = await tx
      .select({ tag: journalEntryTags.tag, count: sql<number>`count(*)::int` })
      .from(journalEntryTags)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryTags.entryId))
      .where(
        and(
          eq(journalEntryTags.tenantId, ctx.tenantId),
          eq(journalEntries.tenantId, ctx.tenantId),
          isNull(journalEntries.deletedAt),
          scope,
          match,
        ),
      )
      .groupBy(journalEntryTags.tag)
      .orderBy(
        ...(search.selected ? [desc(sql`${journalEntryTags.tag} = ${search.selected}`)] : []),
        desc(sql`count(*)`),
        asc(journalEntryTags.tag),
      )
      .limit(PICKER_RESULT_LIMIT + 1)

    return boundPickerOptions(
      rows.map((row) => ({
        value: row.tag,
        label: row.tag.trim().slice(0, 240),
        hint: `${row.count} journal${row.count === 1 ? '' : 's'}`,
      })),
    )
  })
}

/** Search only locations represented by journal records in the reviewer's scope. */
export async function loadJournalRecordSiteOptions(input: unknown): Promise<PickerOptionsResponse> {
  const search = parseRemoteSearchInput(input, 'uuid')
  const { ctx, scope } = await reviewerScope()
  const term = remoteSearchTerm(search.query)

  return ctx.db(async (tx) => {
    const match =
      term || search.selected
        ? or(
            term ? ilike(orgUnits.name, term) : undefined,
            term ? ilike(orgUnits.code, term) : undefined,
            search.selected ? eq(orgUnits.id, search.selected) : undefined,
          )
        : undefined
    const rows = await tx
      .select({
        id: orgUnits.id,
        name: orgUnits.name,
        code: orgUnits.code,
        count: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .innerJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .where(
        and(
          eq(journalEntries.tenantId, ctx.tenantId),
          isNull(journalEntries.deletedAt),
          scope,
          match,
        ),
      )
      .groupBy(orgUnits.id, orgUnits.name, orgUnits.code)
      .orderBy(
        ...(search.selected ? [desc(sql`${orgUnits.id} = ${search.selected}`)] : []),
        desc(sql`count(*)`),
        asc(orgUnits.name),
        asc(orgUnits.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)

    return boundPickerOptions(
      rows.map((row) => ({
        value: row.id,
        label: row.name.trim().slice(0, 240),
        hint: `${row.count} journal${row.count === 1 ? '' : 's'}${row.code ? ` · ${row.code}` : ''}`.slice(
          0,
          120,
        ),
      })),
    )
  })
}

/** Search only authors represented by journal records in the reviewer's scope. */
export async function loadJournalRecordAuthorOptions(
  input: unknown,
): Promise<PickerOptionsResponse> {
  const search = parseRemoteSearchInput(input, 'uuid')
  const { ctx, scope } = await reviewerScope()
  const term = remoteSearchTerm(search.query)

  return ctx.db(async (tx) => {
    const fullName = sql<string>`(${people.firstName} || ' ' || ${people.lastName})`
    const match =
      term || search.selected
        ? or(
            term ? ilike(people.firstName, term) : undefined,
            term ? ilike(people.lastName, term) : undefined,
            term ? ilike(fullName, term) : undefined,
            term ? ilike(people.employeeNo, term) : undefined,
            search.selected ? eq(people.id, search.selected) : undefined,
          )
        : undefined
    const rows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        count: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .innerJoin(people, eq(people.id, journalEntries.personId))
      .where(
        and(
          eq(journalEntries.tenantId, ctx.tenantId),
          isNull(journalEntries.deletedAt),
          scope,
          match,
        ),
      )
      .groupBy(people.id, people.firstName, people.lastName, people.employeeNo)
      .orderBy(
        ...(search.selected ? [desc(sql`${people.id} = ${search.selected}`)] : []),
        desc(sql`count(*)`),
        asc(people.lastName),
        asc(people.firstName),
        asc(people.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)

    return boundPickerOptions(
      rows.map((row) => ({
        value: row.id,
        label: `${row.firstName} ${row.lastName}`.trim().slice(0, 240),
        hint: `${row.count} journal${row.count === 1 ? '' : 's'}${row.employeeNo ? ` · ${row.employeeNo}` : ''}`.slice(
          0,
          120,
        ),
      })),
    )
  })
}
