// Read layer for the Journals workspace. Plain server functions (ctx, …) shared
// by the page (SSR) and the action layer (client refetch). No 'use server'.

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  attachments,
  journalEntries,
  journalEntryPhotos,
  journalEntryTags,
  journalTags,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { getTenantAiConfig } from '@/lib/ai-config'
import { publicUrl } from '@beaconhs/storage'
import { can, type RequestContext } from '@beaconhs/tenant'
import {
  authorTenantUserId,
  getAuthorPersonId,
  htmlToText,
  isUuid,
  journalAuthorScopeWhere,
  journalCanBrowseAll,
  journalCanReadAll,
  journalScopeWhere,
  journalSelfScopeWhere,
  nextJournalReference,
  snippetOf,
  todayISO,
} from './_lib'
import type {
  AuthorRef,
  GroupBy,
  HeatmapCell,
  JournalEntryDetail,
  JournalFilters,
  JournalListItem,
  JournalOption,
  JournalRecordsFacets,
  JournalSort,
  OnThisDayItem,
  TagSuggestion,
  TreeNode,
  WorkspaceData,
} from './_types'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const authorPerson = alias(people, 'journal_author')

function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${MONTHS_ABBR[Number(m) - 1]} ${Number(d)}`
}

function treeSnippet(body: string | null | undefined): string {
  // body_text is usually plain, but migrated entries hold HTML — strip tags.
  const s = htmlToText(body).replace(/\s+/g, ' ').trim()
  return s.length > 46 ? `${s.slice(0, 45)}…` : s
}

/**
 * Combine scope + filters into the WHERE clause for journal_entries.
 * `selfOnly` forces the caller's own entries regardless of read.all/site — used
 * by the personal compose workspace; the Records browser leaves it false.
 * `targetAuthor` (records "Open full entry" workspace) scopes to ONE author's
 * entries, viewer-bounded — it takes precedence over `selfOnly`.
 */
function entryWhere(
  ctx: RequestContext,
  filters: JournalFilters,
  authorPersonId: string | null,
  selfOnly = false,
  targetAuthor?: AuthorRef | null,
): SQL | undefined {
  // Soft-deleted entries are invisible everywhere (list, tree, counts, export).
  const conds: SQL[] = [isNull(journalEntries.deletedAt)]
  const scope = targetAuthor
    ? journalAuthorScopeWhere(ctx, authorPersonId, targetAuthor)
    : selfOnly
      ? journalSelfScopeWhere(ctx, authorPersonId)
      : journalScopeWhere(ctx, authorPersonId)
  if (scope) conds.push(scope)

  if (filters.q) {
    const term = `%${filters.q}%`
    const ft = sql`${journalEntries.searchVector} @@ plainto_tsquery('english', ${filters.q})`
    conds.push(or(ft, ilike(journalEntries.title, term), ilike(journalEntries.bodyText, term))!)
  }
  if (filters.site) conds.push(eq(journalEntries.siteOrgUnitId, filters.site))
  if (filters.person) conds.push(eq(journalEntries.personId, filters.person))
  if (filters.status) conds.push(eq(journalEntries.status, filters.status))
  if (filters.definition) conds.push(eq(journalEntries.definition, filters.definition))
  if (filters.from) conds.push(gte(journalEntries.entryDate, filters.from))
  if (filters.to) conds.push(lte(journalEntries.entryDate, filters.to))
  if (filters.tag) {
    conds.push(
      sql`exists (select 1 from ${journalEntryTags} t where t.entry_id = ${journalEntries.id} and t.tag = ${filters.tag})`,
    )
  }
  if (filters.mine && authorPersonId) {
    const mineConds: SQL[] = [eq(journalEntries.personId, authorPersonId)]
    // authorTenantUserId guards the super-admin sentinel (never a uuid).
    const tenantUserId = authorTenantUserId(ctx)
    if (tenantUserId) mineConds.push(eq(journalEntries.createdByTenantUserId, tenantUserId))
    conds.push(mineConds.length === 1 ? mineConds[0]! : or(...mineConds)!)
  }
  return conds.length === 0 ? undefined : and(...conds)
}

export async function listMetaOptions(
  ctx: RequestContext,
): Promise<{ sites: JournalOption[]; people: JournalOption[] }> {
  return ctx.db(async (tx) => {
    const sites = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(asc(orgUnits.name))
      .limit(500)
    const ppl = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(1000)
    return {
      sites,
      people: ppl.map((p) => ({
        id: p.id,
        name: `${p.lastName}, ${p.firstName}`,
        hint: p.employeeNo ?? undefined,
      })),
    }
  })
}

/**
 * Tags for the entry picker: those in use (within the reader's scope, most-used
 * first) with their governed colour, followed by defined-but-unused tags so
 * admin-curated vocabulary is offered before anyone has applied it.
 */
export async function listTagSuggestions(
  ctx: RequestContext,
  scope: SQL | undefined,
): Promise<TagSuggestion[]> {
  return ctx.db(async (tx) => {
    const used = await tx
      .select({ tag: journalEntryTags.tag, n: sql<number>`count(*)::int` })
      .from(journalEntryTags)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryTags.entryId))
      .where(scope)
      .groupBy(journalEntryTags.tag)
      .orderBy(desc(sql`count(*)`), asc(journalEntryTags.tag))
      .limit(200)

    const defs = await tx
      .select({ name: journalTags.name, color: journalTags.color })
      .from(journalTags)
      .where(eq(journalTags.tenantId, ctx.tenantId))
    const colorByName = new Map(defs.map((d) => [d.name, d.color]))

    const seen = new Set<string>()
    const out: TagSuggestion[] = []
    for (const r of used) {
      seen.add(r.tag)
      out.push({ name: r.tag, color: colorByName.get(r.tag) ?? null })
    }
    for (const d of [...defs].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!seen.has(d.name)) out.push({ name: d.name, color: d.color })
    }
    return out
  })
}

/** Cards for list / export views. `selfOnly` restricts to the caller's own entries. */
export async function listEntries(
  ctx: RequestContext,
  filters: JournalFilters,
  paging: { limit?: number; offset?: number; sort?: JournalSort; dir?: 'asc' | 'desc' } = {},
  selfOnly = false,
): Promise<JournalListItem[]> {
  const authorPersonId = await getAuthorPersonId(ctx)
  const limit = Math.min(paging.limit ?? 50, 5000)
  const offset = paging.offset ?? 0
  const dir = paging.dir === 'asc' ? asc : desc
  const orderBy =
    paging.sort === 'author'
      ? [dir(authorPerson.lastName), dir(authorPerson.firstName)]
      : paging.sort === 'site'
        ? [dir(orgUnits.name)]
        : paging.sort === 'status'
          ? [dir(journalEntries.status)]
          : paging.sort === 'reference'
            ? [dir(journalEntries.reference)]
            : [dir(journalEntries.entryDate), desc(journalEntries.updatedAt)]

  return ctx.db(async (tx) => {
    const where = entryWhere(ctx, filters, authorPersonId, selfOnly)
    const rows = await tx
      .select({
        e: journalEntries,
        siteName: orgUnits.name,
        firstName: authorPerson.firstName,
        lastName: authorPerson.lastName,
      })
      .from(journalEntries)
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .leftJoin(authorPerson, eq(authorPerson.id, journalEntries.personId))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset)

    const ids = rows.map((r) => r.e.id)
    const thumbs = await firstPhotoThumbs(tx, ids)
    const photoCounts = await photoCountsByEntry(tx, ids)

    return rows.map(
      (r): JournalListItem => ({
        id: r.e.id,
        reference: r.e.reference,
        title: r.e.title,
        snippet: snippetOf(htmlToText(r.e.bodyText)),
        entryDate: r.e.entryDate,
        status: r.e.status,
        definition: r.e.definition,
        siteName: r.siteName ?? null,
        authorName: r.firstName ? `${r.firstName} ${r.lastName ?? ''}`.trim() : null,
        tags: r.e.tagsCache ?? [],
        photoCount: photoCounts[r.e.id] ?? 0,
        thumbUrl: thumbs[r.e.id] ?? null,
        updatedAt: r.e.updatedAt.toISOString(),
      }),
    )
  })
}

/** Total entries matching the filters (for the records browser's count + paging). */
export async function countEntries(ctx: RequestContext, filters: JournalFilters): Promise<number> {
  const authorPersonId = await getAuthorPersonId(ctx)
  return ctx.db(async (tx) => {
    const where = entryWhere(ctx, filters, authorPersonId)
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(where)
    return Number(row?.n ?? 0)
  })
}

/**
 * Scoped filter facets for the records list: status counts plus the most-used
 * sites and authors within the caller's visibility scope (so the chips never
 * leak names the caller can't see). Reflects scope only, not the active
 * filters, so selecting one facet doesn't make the others vanish.
 */
export async function listRecordsFacets(ctx: RequestContext): Promise<JournalRecordsFacets> {
  const authorPersonId = await getAuthorPersonId(ctx)
  const scope = and(isNull(journalEntries.deletedAt), journalScopeWhere(ctx, authorPersonId))
  return ctx.db(async (tx) => {
    const statusRows = await tx
      .select({ status: journalEntries.status, n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(scope)
      .groupBy(journalEntries.status)
    const statusCounts: Record<string, number> = {}
    for (const r of statusRows) statusCounts[r.status] = Number(r.n)

    const siteRows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name, n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .innerJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .where(scope)
      .groupBy(orgUnits.id, orgUnits.name)
      .orderBy(desc(sql`count(*)`), asc(orgUnits.name))
      .limit(15)

    const peopleRows = await tx
      .select({
        id: authorPerson.id,
        firstName: authorPerson.firstName,
        lastName: authorPerson.lastName,
        n: sql<number>`count(*)::int`,
      })
      .from(journalEntries)
      .innerJoin(authorPerson, eq(authorPerson.id, journalEntries.personId))
      .where(scope)
      .groupBy(authorPerson.id, authorPerson.firstName, authorPerson.lastName)
      .orderBy(desc(sql`count(*)`), asc(authorPerson.lastName))
      .limit(15)

    return {
      statusCounts,
      sites: siteRows.map((s) => ({ id: s.id, name: s.name, count: Number(s.n) })),
      people: peopleRows.map((p) => ({
        id: p.id,
        name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || '—',
        count: Number(p.n),
      })),
    }
  })
}

async function firstPhotoThumbs(
  tx: Parameters<Parameters<RequestContext['db']>[0]>[0],
  entryIds: string[],
): Promise<Record<string, string>> {
  if (entryIds.length === 0) return {}
  const rows = await tx
    .select({
      entryId: journalEntryPhotos.entryId,
      r2Key: attachments.r2Key,
      sortOrder: journalEntryPhotos.sortOrder,
    })
    .from(journalEntryPhotos)
    .innerJoin(attachments, eq(attachments.id, journalEntryPhotos.attachmentId))
    .where(inArray(journalEntryPhotos.entryId, entryIds))
    .orderBy(asc(journalEntryPhotos.sortOrder))
  const out: Record<string, string> = {}
  for (const r of rows) if (!out[r.entryId]) out[r.entryId] = publicUrl(r.r2Key)
  return out
}

async function photoCountsByEntry(
  tx: Parameters<Parameters<RequestContext['db']>[0]>[0],
  entryIds: string[],
): Promise<Record<string, number>> {
  if (entryIds.length === 0) return {}
  const rows = await tx
    .select({ entryId: journalEntryPhotos.entryId, c: sql<number>`count(*)::int` })
    .from(journalEntryPhotos)
    .where(inArray(journalEntryPhotos.entryId, entryIds))
    .groupBy(journalEntryPhotos.entryId)
  return Object.fromEntries(rows.map((r) => [r.entryId, Number(r.c)]))
}

/** Full entry for the editor pane. */
export async function getEntry(
  ctx: RequestContext,
  id: string,
): Promise<JournalEntryDetail | null> {
  if (!isUuid(id)) return null
  const authorPersonId = await getAuthorPersonId(ctx)
  return ctx.db(async (tx) => {
    const scope = journalScopeWhere(ctx, authorPersonId)
    const [row] = await tx
      .select({
        e: journalEntries,
        siteName: orgUnits.name,
        firstName: authorPerson.firstName,
        lastName: authorPerson.lastName,
      })
      .from(journalEntries)
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .leftJoin(authorPerson, eq(authorPerson.id, journalEntries.personId))
      .where(and(eq(journalEntries.id, id), isNull(journalEntries.deletedAt), scope))
      .limit(1)
    if (!row) return null

    const tagRows = await tx
      .select({ tag: journalEntryTags.tag })
      .from(journalEntryTags)
      .where(eq(journalEntryTags.entryId, id))
      .orderBy(asc(journalEntryTags.tag))

    const photoRows = await tx
      .select({
        id: journalEntryPhotos.id,
        caption: journalEntryPhotos.caption,
        r2Key: attachments.r2Key,
      })
      .from(journalEntryPhotos)
      .innerJoin(attachments, eq(attachments.id, journalEntryPhotos.attachmentId))
      .where(eq(journalEntryPhotos.entryId, id))
      .orderBy(asc(journalEntryPhotos.sortOrder))

    return {
      id: row.e.id,
      reference: row.e.reference,
      title: row.e.title,
      bodyHtml: row.e.bodyHtml ?? '',
      bodyText: row.e.bodyText ?? '',
      summary: row.e.summary,
      entryDate: row.e.entryDate,
      status: row.e.status,
      definition: row.e.definition,
      siteOrgUnitId: row.e.siteOrgUnitId,
      supervisorPersonId: row.e.supervisorPersonId,
      personId: row.e.personId,
      createdByTenantUserId: row.e.createdByTenantUserId,
      tags: tagRows.map((t) => t.tag),
      photos: photoRows.map((p) => ({
        id: p.id,
        url: publicUrl(p.r2Key),
        caption: p.caption,
      })),
      authorName: row.firstName ? `${row.firstName} ${row.lastName ?? ''}`.trim() : null,
      siteName: row.siteName ?? null,
      updatedAt: row.e.updatedAt.toISOString(),
      submittedAt: row.e.submittedAt ? row.e.submittedAt.toISOString() : null,
      locked: Boolean(row.e.lockedAt),
    }
  })
}

type TreeRow = {
  id: string
  entryDate: string
  snippet: string
  status: 'draft' | 'submitted' | 'archived'
  siteName: string | null
  authorName: string | null
}

/** Build the auto-generated sidebar tree for the chosen grouping. */
export async function buildTree(
  ctx: RequestContext,
  groupBy: GroupBy,
  filters: JournalFilters,
  selfOnly = false,
  targetAuthor?: AuthorRef | null,
): Promise<TreeNode[]> {
  const authorPersonId = await getAuthorPersonId(ctx)
  const where = entryWhere(ctx, filters, authorPersonId, selfOnly, targetAuthor)

  const rows: TreeRow[] = await ctx.db(async (tx) => {
    const base = await tx
      .select({
        id: journalEntries.id,
        entryDate: journalEntries.entryDate,
        bodyText: journalEntries.bodyText,
        status: journalEntries.status,
        siteName: orgUnits.name,
        firstName: authorPerson.firstName,
        lastName: authorPerson.lastName,
      })
      .from(journalEntries)
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .leftJoin(authorPerson, eq(authorPerson.id, journalEntries.personId))
      .where(where)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.updatedAt))
      .limit(2000)
    return base.map((r) => ({
      id: r.id,
      entryDate: r.entryDate,
      snippet: treeSnippet(r.bodyText),
      status: r.status,
      siteName: r.siteName ?? null,
      authorName: r.firstName ? `${r.firstName} ${r.lastName ?? ''}`.trim() : null,
    }))
  })

  if (groupBy === 'topic') return treeByTopic(ctx, where)
  if (groupBy === 'site') return treeByKey(rows, (r) => r.siteName ?? 'No site')
  return treeByDate(rows)
}

function leaf(r: TreeRow): TreeNode {
  return {
    key: r.id,
    label: r.snippet || dayLabel(r.entryDate),
    count: 1,
    entryId: r.id,
    entryDate: r.entryDate,
    draft: r.status === 'draft',
  }
}

function treeByDate(rows: TreeRow[]): TreeNode[] {
  const years = new Map<string, Map<string, Map<string, TreeRow[]>>>()
  for (const r of rows) {
    const [y, m] = r.entryDate.split('-')
    if (!years.has(y!)) years.set(y!, new Map())
    const months = years.get(y!)!
    if (!months.has(m!)) months.set(m!, new Map())
    const days = months.get(m!)!
    if (!days.has(r.entryDate)) days.set(r.entryDate, [])
    days.get(r.entryDate)!.push(r)
  }
  const out: TreeNode[] = []
  for (const [y, months] of years) {
    const monthNodes: TreeNode[] = []
    let yearCount = 0
    for (const [m, days] of months) {
      const dayNodes: TreeNode[] = []
      let monthCount = 0
      for (const [iso, entries] of days) {
        monthCount += entries.length
        if (entries.length === 1) {
          dayNodes.push({ ...leaf(entries[0]!), label: dayLabel(iso) })
        } else {
          dayNodes.push({
            key: `d-${iso}`,
            label: dayLabel(iso),
            count: entries.length,
            children: entries.map(leaf),
          })
        }
      }
      yearCount += monthCount
      monthNodes.push({
        key: `${y}-${m}`,
        label: MONTHS[Number(m) - 1]!,
        count: monthCount,
        children: dayNodes,
      })
    }
    out.push({ key: y, label: y, count: yearCount, children: monthNodes })
  }
  return out
}

function treeByKey(rows: TreeRow[], keyOf: (r: TreeRow) => string): TreeNode[] {
  const groups = new Map<string, TreeRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, entries]) => ({
      key: `g-${k}`,
      label: k,
      count: entries.length,
      children: entries.map(leaf),
    }))
}

async function treeByTopic(ctx: RequestContext, where: SQL | undefined): Promise<TreeNode[]> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        tag: journalEntryTags.tag,
        id: journalEntries.id,
        bodyText: journalEntries.bodyText,
        entryDate: journalEntries.entryDate,
        status: journalEntries.status,
      })
      .from(journalEntryTags)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryTags.entryId))
      .where(where)
      .orderBy(asc(journalEntryTags.tag), desc(journalEntries.entryDate))
      .limit(4000)
    const groups = new Map<string, TreeNode[]>()
    for (const r of rows) {
      if (!groups.has(r.tag)) groups.set(r.tag, [])
      groups.get(r.tag)!.push({
        key: `${r.tag}:${r.id}`,
        label: treeSnippet(r.bodyText) || dayLabel(r.entryDate),
        count: 1,
        entryId: r.id,
        entryDate: r.entryDate,
        draft: r.status === 'draft',
      })
    }
    return Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([tag, children]) => ({
        key: `t-${tag}`,
        label: tag,
        count: children.length,
        children,
      }))
  })
}

async function heatmap(ctx: RequestContext, where: SQL | undefined): Promise<HeatmapCell[]> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ date: journalEntries.entryDate, c: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(
        where
          ? and(where, gte(journalEntries.entryDate, sql`current_date - interval '365 days'`))
          : gte(journalEntries.entryDate, sql`current_date - interval '365 days'`),
      )
      .groupBy(journalEntries.entryDate)
    return rows.map((r) => ({ date: r.date, count: Number(r.c) }))
  })
}

async function onThisDay(ctx: RequestContext, where: SQL | undefined): Promise<OnThisDayItem[]> {
  return ctx.db(async (tx) => {
    const cond = sql`to_char(${journalEntries.entryDate}, 'MM-DD') = to_char(current_date, 'MM-DD') and extract(year from ${journalEntries.entryDate}) < extract(year from current_date)`
    const rows = await tx
      .select({
        id: journalEntries.id,
        entryDate: journalEntries.entryDate,
        title: journalEntries.title,
        bodyText: journalEntries.bodyText,
        firstName: authorPerson.firstName,
        lastName: authorPerson.lastName,
      })
      .from(journalEntries)
      .leftJoin(authorPerson, eq(authorPerson.id, journalEntries.personId))
      .where(where ? and(where, cond) : cond)
      .orderBy(desc(journalEntries.entryDate))
      .limit(10)
    const thisYear = new Date().getFullYear()
    return rows.map((r) => ({
      id: r.id,
      entryDate: r.entryDate,
      title: r.title,
      authorName: r.firstName ? `${r.firstName} ${r.lastName ?? ''}`.trim() : null,
      snippet: treeSnippet(r.bodyText),
      yearsAgo: thisYear - Number(r.entryDate.slice(0, 4)),
    }))
  })
}

/**
 * Everything the sidebar needs in one payload. Self-scoped by default (the
 * personal compose workspace). When `targetAuthor` is set (records "Open full
 * entry"), the tree/heatmap/counts scope to THAT author's journals instead,
 * viewer-bounded — so an admin browses a worker's log in the same UI.
 */
export async function getWorkspaceData(
  ctx: RequestContext,
  groupBy: GroupBy,
  filters: JournalFilters,
  targetAuthor?: AuthorRef | null,
): Promise<WorkspaceData> {
  const authorPersonId = await getAuthorPersonId(ctx)
  const selfOnly = !targetAuthor
  const where = entryWhere(ctx, filters, authorPersonId, selfOnly, targetAuthor)
  const scopeOnly = and(
    isNull(journalEntries.deletedAt),
    targetAuthor
      ? journalAuthorScopeWhere(ctx, authorPersonId, targetAuthor)
      : journalSelfScopeWhere(ctx, authorPersonId),
  )

  const [tree, hm, otd, options, tagSuggestions, counts] = await Promise.all([
    buildTree(ctx, groupBy, filters, selfOnly, targetAuthor),
    heatmap(ctx, scopeOnly),
    onThisDay(ctx, scopeOnly),
    listMetaOptions(ctx),
    listTagSuggestions(ctx, scopeOnly),
    ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          drafts: sql<number>`count(*) filter (where ${journalEntries.status} = 'draft')::int`,
          mine: authorPersonId
            ? sql<number>`count(*) filter (where ${journalEntries.personId} = ${authorPersonId})::int`
            : sql<number>`0`,
        })
        .from(journalEntries)
        .where(where)
      return row
    }),
  ])

  return {
    tree,
    heatmap: hm,
    onThisDay: otd,
    counts: {
      total: Number(counts?.total ?? 0),
      drafts: Number(counts?.drafts ?? 0),
      mine: Number(counts?.mine ?? 0),
    },
    sites: options.sites,
    people: options.people,
    tagSuggestions,
    canReadAll: journalCanReadAll(ctx),
    canBrowseAll: journalCanBrowseAll(ctx),
    canManage: ctx.isSuperAdmin || can(ctx, 'journals.assign'),
    aiEnabled: (await getTenantAiConfig(ctx)) !== null,
  }
}

/** Resolve the author's entry for a date (default today in the user's timezone),
 *  creating a draft if none. */
export async function getOrCreateEntryForDate(
  ctx: RequestContext,
  dateISO?: string,
): Promise<string | null> {
  const authorPersonId = await getAuthorPersonId(ctx)
  const tenantUserId = authorTenantUserId(ctx)
  // No linked person and no tenant membership (e.g. a memberless super-admin):
  // there is no identity to own the entry, and an ownerless lookup would match
  // ANY user's entry for the date. Refuse rather than open someone else's journal.
  if (!authorPersonId && !tenantUserId) return null
  const today = dateISO ?? todayISO(ctx.timezone)
  return ctx.db(async (tx) => {
    // Most-recent live entry on this date authored by / created by this user.
    const ownership: SQL[] = []
    if (authorPersonId) ownership.push(eq(journalEntries.personId, authorPersonId))
    if (tenantUserId) ownership.push(eq(journalEntries.createdByTenantUserId, tenantUserId))

    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.entryDate, today),
          isNull(journalEntries.deletedAt),
          ownership.length === 1 ? ownership[0]! : or(...ownership)!,
        ),
      )
      .orderBy(desc(journalEntries.updatedAt))
      .limit(1)
    if (existing) return existing.id

    const reference = await nextJournalReference(tx, ctx.tenantId, Number(today.slice(0, 4)))
    const [created] = await tx
      .insert(journalEntries)
      .values({
        tenantId: ctx.tenantId,
        reference,
        personId: authorPersonId,
        createdByTenantUserId: tenantUserId,
        entryDate: today,
        status: 'draft',
      })
      .returning({ id: journalEntries.id })
    return created?.id ?? null
  })
}
