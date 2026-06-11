// Insights aggregates for the journal analytics dashboard. Manager-scoped.

import { and, desc, eq, gte, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { journalEntries, journalEntryTags, orgUnits, people } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getAuthorPersonId, journalScopeWhere } from './_lib'

const insAuthor = alias(people, 'ins_author')

export type Insights = {
  total: number
  submitted: number
  drafts: number
  people: number
  last30: number
  byWeek: { week: string; count: number }[]
  byPerson: { name: string; count: number }[]
  bySite: { name: string; count: number }[]
  byDow: number[] // length 7, Sun..Sat
  topTags: { tag: string; count: number }[]
}

export async function getInsights(ctx: RequestContext): Promise<Insights> {
  const authorPersonId = await getAuthorPersonId(ctx)
  const scope = journalScopeWhere(ctx, authorPersonId)
  const notDeleted = isNull(journalEntries.deletedAt)
  const base = (extra?: SQL): SQL =>
    extra
      ? and(notDeleted, ...(scope ? [scope] : []), extra)!
      : and(notDeleted, ...(scope ? [scope] : []))!

  return ctx.db(async (tx) => {
    const [tot] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        submitted: sql<number>`count(*) filter (where ${journalEntries.status} = 'submitted')::int`,
        drafts: sql<number>`count(*) filter (where ${journalEntries.status} = 'draft')::int`,
        people: sql<number>`count(distinct ${journalEntries.personId})::int`,
        last30: sql<number>`count(*) filter (where ${journalEntries.entryDate} >= current_date - interval '30 days')::int`,
      })
      .from(journalEntries)
      .where(base())

    const byWeekRows = await tx
      .select({
        week: sql<string>`to_char(date_trunc('week', ${journalEntries.entryDate}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .where(base(gte(journalEntries.entryDate, sql`current_date - interval '84 days'`)))
      .groupBy(sql`date_trunc('week', ${journalEntries.entryDate})`)
      .orderBy(sql`date_trunc('week', ${journalEntries.entryDate})`)

    const byPersonRows = await tx
      .select({
        name: sql<string>`coalesce(${insAuthor.lastName} || ', ' || ${insAuthor.firstName}, 'Unassigned')`,
        count: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .leftJoin(insAuthor, eq(insAuthor.id, journalEntries.personId))
      .where(base())
      .groupBy(insAuthor.lastName, insAuthor.firstName)
      .orderBy(desc(sql`count(*)`))
      .limit(10)

    const bySiteRows = await tx
      .select({
        name: sql<string>`coalesce(${orgUnits.name}, 'No site')`,
        count: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .where(base())
      .groupBy(orgUnits.name)
      .orderBy(desc(sql`count(*)`))
      .limit(10)

    const dowRows = await tx
      .select({
        dow: sql<number>`extract(dow from ${journalEntries.entryDate})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .where(base())
      .groupBy(sql`extract(dow from ${journalEntries.entryDate})`)
    const byDow = Array.from({ length: 7 }, () => 0)
    for (const r of dowRows) byDow[Number(r.dow)] = Number(r.count)

    const tagRows = await tx
      .select({ tag: journalEntryTags.tag, count: sql<number>`count(*)::int` })
      .from(journalEntryTags)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryTags.entryId))
      .where(base())
      .groupBy(journalEntryTags.tag)
      .orderBy(desc(sql`count(*)`))
      .limit(12)

    return {
      total: Number(tot?.total ?? 0),
      submitted: Number(tot?.submitted ?? 0),
      drafts: Number(tot?.drafts ?? 0),
      people: Number(tot?.people ?? 0),
      last30: Number(tot?.last30 ?? 0),
      byWeek: byWeekRows.map((r) => ({ week: r.week, count: Number(r.count) })),
      byPerson: byPersonRows.map((r) => ({ name: r.name, count: Number(r.count) })),
      bySite: bySiteRows.map((r) => ({ name: r.name, count: Number(r.count) })),
      byDow,
      topTags: tagRows.map((r) => ({ tag: r.tag, count: Number(r.count) })),
    }
  })
}
