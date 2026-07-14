// Read + mutation helpers for the Journals → Tags admin page.
//
// Tags are free-text: the source of truth for an entry's tags is
// journal_entry_tags, with journal_entries.tags_cache as a denormalised mirror.
// journal_tags holds optional governance metadata (colour + description) and the
// canonical vocabulary. Every mutation here keeps all three consistent.
//
// All statements carry an explicit tenant_id predicate in addition to RLS —
// belt-and-braces, since these are tenant-wide bulk operations keyed by tag text.

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { journalEntries, journalEntryTags, journalTags } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type ManagedTag = {
  name: string
  usage: number
  aiCount: number
  userCount: number
  color: string | null
  description: string | null
  /** True when a journal_tags row exists (governed); false for ad-hoc tags. */
  defined: boolean
}

const norm = (s: string) => s.trim().toLowerCase()

// Correlated subquery that rebuilds an entry's tags_cache from its tag rows.
const recomputedCache = sql`coalesce((select jsonb_agg(t.tag order by t.tag) from ${journalEntryTags} t where t.entry_id = ${journalEntries.id}), '[]'::jsonb)`

type ManagedTagDbRow = {
  name: string
  usage: number | string
  ai_count: number | string
  user_count: number | string
  color: string | null
  description: string | null
  defined: boolean
}

function managedTagsQuery(tenantId: string): SQL {
  return sql`
    with usage as (
      select ${journalEntryTags.tag} as name,
        count(*)::int as usage,
        count(*) filter (where ${journalEntryTags.source} = 'ai')::int as ai_count,
        count(*) filter (where ${journalEntryTags.source} = 'user')::int as user_count
      from ${journalEntryTags}
      where ${journalEntryTags.tenantId} = ${tenantId}
      group by ${journalEntryTags.tag}
    ), defs as (
      select ${journalTags.name} as name, ${journalTags.color} as color,
        ${journalTags.description} as description
      from ${journalTags}
      where ${journalTags.tenantId} = ${tenantId}
    )
    select coalesce(usage.name, defs.name) as name,
      coalesce(usage.usage, 0)::int as usage,
      coalesce(usage.ai_count, 0)::int as ai_count,
      coalesce(usage.user_count, 0)::int as user_count,
      defs.color,
      defs.description,
      (defs.name is not null) as defined
    from usage
    full outer join defs on defs.name = usage.name
  `
}

function mapManagedTag(row: ManagedTagDbRow): ManagedTag {
  return {
    name: row.name,
    usage: Number(row.usage),
    aiCount: Number(row.ai_count),
    userCount: Number(row.user_count),
    color: row.color,
    description: row.description,
    defined: row.defined,
  }
}

/** Searchable, bounded tag page across the used ∪ governed vocabulary. */
export async function listManagedTags(
  ctx: RequestContext,
  options: {
    q?: string
    status?: 'defined' | 'ad_hoc'
    page: number
    perPage: number
  },
): Promise<{ rows: ManagedTag[]; total: number; allTotal: number; totalUses: number }> {
  return ctx.db(async (tx) => {
    const conditions: SQL[] = []
    if (options.q) {
      const term = `%${options.q}%`
      conditions.push(sql`(name ilike ${term} or description ilike ${term})`)
    }
    if (options.status) conditions.push(sql`defined = ${options.status === 'defined'}`)
    const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``
    const managed = managedTagsQuery(ctx.tenantId)
    const [rowResult, countResult, statsResult] = await Promise.all([
      tx.execute<ManagedTagDbRow>(sql`
        with managed as (${managed})
        select * from managed
        ${where}
        order by usage desc, name asc
        limit ${options.perPage}
        offset ${(options.page - 1) * options.perPage}
      `),
      tx.execute<{ total: number | string }>(sql`
        with managed as (${managed})
        select count(*)::int as total from managed ${where}
      `),
      tx.execute<{ total: number | string; uses: number | string }>(sql`
        with managed as (${managed})
        select count(*)::int as total, coalesce(sum(usage), 0)::int as uses from managed
      `),
    ])
    const rows = rowResult as unknown as ManagedTagDbRow[]
    const countRows = countResult as unknown as Array<{ total: number | string }>
    const statsRows = statsResult as unknown as Array<{
      total: number | string
      uses: number | string
    }>
    return {
      rows: rows.map(mapManagedTag),
      total: Number(countRows[0]?.total ?? 0),
      allTotal: Number(statsRows[0]?.total ?? 0),
      totalUses: Number(statsRows[0]?.uses ?? 0),
    }
  })
}

export async function managedTagExists(ctx: RequestContext, value: string): Promise<boolean> {
  const name = norm(value)
  if (!name) return false
  return ctx.db(async (tx) => {
    const result = await tx.execute<{ found: boolean }>(sql`
      with managed as (${managedTagsQuery(ctx.tenantId)})
      select exists(select 1 from managed where name = ${name}) as found
    `)
    return Boolean((result as unknown as Array<{ found: boolean }>)[0]?.found)
  })
}

/** Create or update a tag's governance metadata (colour + description). */
export async function upsertTagMeta(
  ctx: RequestContext,
  input: { name: string; color: string | null; description: string | null },
): Promise<boolean> {
  const name = norm(input.name)
  if (!name) return false
  await ctx.db((tx) =>
    tx
      .insert(journalTags)
      .values({
        tenantId: ctx.tenantId,
        name,
        color: input.color,
        description: input.description,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [journalTags.tenantId, journalTags.name],
        set: { color: input.color, description: input.description, updatedAt: new Date() },
      }),
  )
  return true
}

/**
 * Fold one or more source tags into a target across every entry, then reconcile
 * the cache + definition rows. Used for both rename (one source) and merge.
 * Returns the number of distinct entries touched.
 */
export async function mergeTags(
  ctx: RequestContext,
  sources: string[],
  target: string,
): Promise<number> {
  const tgt = norm(target)
  const srcs = Array.from(new Set(sources.map(norm).filter((s) => s && s !== tgt)))
  if (!tgt || srcs.length === 0) return 0

  return ctx.db(async (tx) => {
    const [touchedRow] = await tx
      .select({ c: sql<number>`count(distinct ${journalEntryTags.entryId})::int` })
      .from(journalEntryTags)
      .where(
        and(
          eq(journalEntryTags.tenantId, ctx.tenantId),
          inArray(journalEntryTags.tag, [...srcs, tgt]),
        ),
      )
    const touchedCount = Number(touchedRow?.c ?? 0)

    // 1) Drop source rows on entries that already carry the target — the
    //    (entry_id, tag) unique index would reject repointing them.
    await tx.execute(sql`
      delete from ${journalEntryTags} src
      where src.tenant_id = ${ctx.tenantId}
        and src.tag in (${sql.join(
          srcs.map((s) => sql`${s}`),
          sql`, `,
        )})
        and exists (
          select 1 from ${journalEntryTags} keep
          where keep.entry_id = src.entry_id and keep.tag = ${tgt}
        )
    `)
    // 2) Repoint the remaining source rows to the target.
    await tx
      .update(journalEntryTags)
      .set({ tag: tgt })
      .where(and(eq(journalEntryTags.tenantId, ctx.tenantId), inArray(journalEntryTags.tag, srcs)))
    // 3) Rebuild the denormalised cache in-database. After repointing, every
    // affected entry carries the target; updating pre-existing target entries
    // again is harmless and avoids materializing an unbounded ID list.
    if (touchedCount > 0) {
      await tx
        .update(journalEntries)
        .set({ tagsCache: recomputedCache })
        .where(
          and(
            eq(journalEntries.tenantId, ctx.tenantId),
            sql`exists (
              select 1 from ${journalEntryTags} target_tag
              where target_tag.tenant_id = ${ctx.tenantId}
                and target_tag.entry_id = ${journalEntries.id}
                and target_tag.tag = ${tgt}
            )`,
          ),
        )
    }
    // 4) Reconcile definition rows: seed the target's metadata from a source if
    //    it has none of its own, then drop the now-merged source definitions.
    const defs = await tx
      .select()
      .from(journalTags)
      .where(and(eq(journalTags.tenantId, ctx.tenantId), inArray(journalTags.name, [...srcs, tgt])))
    const targetDef = defs.find((d) => d.name === tgt)
    const sourceDefs = defs.filter((d) => srcs.includes(d.name))
    if (!targetDef && sourceDefs.length > 0) {
      const seed = sourceDefs.find((d) => d.color || d.description) ?? sourceDefs[0]!
      await tx
        .insert(journalTags)
        .values({
          tenantId: ctx.tenantId,
          name: tgt,
          color: seed.color,
          description: seed.description,
          createdByTenantUserId: ctx.membership?.id ?? null,
        })
        .onConflictDoNothing()
    }
    if (sourceDefs.length > 0) {
      await tx
        .delete(journalTags)
        .where(and(eq(journalTags.tenantId, ctx.tenantId), inArray(journalTags.name, srcs)))
    }
    return touchedCount
  })
}

/** Rename a tag everywhere; if the new name already exists this becomes a merge. */
export async function renameTag(ctx: RequestContext, from: string, to: string): Promise<number> {
  return mergeTags(ctx, [from], to)
}

/** Remove a tag from every entry and drop its definition. */
export async function deleteTag(ctx: RequestContext, name: string): Promise<number> {
  const tag = norm(name)
  if (!tag) return 0
  return ctx.db(async (tx) => {
    const refreshed = await tx.execute<{ id: string }>(sql`
      with removed as (
        delete from ${journalEntryTags}
        where ${journalEntryTags.tenantId} = ${ctx.tenantId}
          and ${journalEntryTags.tag} = ${tag}
        returning ${journalEntryTags.entryId} as entry_id
      )
      update ${journalEntries} entry
      set tags_cache = coalesce((
        select jsonb_agg(t.tag order by t.tag)
        from ${journalEntryTags} t
        where t.entry_id = entry.id
      ), '[]'::jsonb)
      where entry.tenant_id = ${ctx.tenantId}
        and entry.id in (select entry_id from removed)
      returning entry.id
    `)
    await tx
      .delete(journalTags)
      .where(and(eq(journalTags.tenantId, ctx.tenantId), eq(journalTags.name, tag)))
    return (refreshed as unknown as Array<{ id: string }>).length
  })
}
