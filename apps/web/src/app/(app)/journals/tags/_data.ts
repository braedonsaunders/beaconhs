// Read + mutation helpers for the Journals → Tags admin page.
//
// Tags are free-text: the source of truth for an entry's tags is
// journal_entry_tags, with journal_entries.tags_cache as a denormalised mirror.
// journal_tags holds optional governance metadata (colour + description) and the
// canonical vocabulary. Every mutation here keeps all three consistent.
//
// All statements carry an explicit tenant_id predicate in addition to RLS —
// belt-and-braces, since these are tenant-wide bulk operations keyed by tag text.

import { and, eq, inArray, sql } from 'drizzle-orm'
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

/** Every tag in the tenant — used (with counts + source split) ∪ defined. */
export async function listManagedTags(ctx: RequestContext): Promise<ManagedTag[]> {
  return ctx.db(async (tx) => {
    const usageRows = await tx
      .select({
        tag: journalEntryTags.tag,
        usage: sql<number>`count(*)::int`,
        ai: sql<number>`count(*) filter (where ${journalEntryTags.source} = 'ai')::int`,
        usr: sql<number>`count(*) filter (where ${journalEntryTags.source} = 'user')::int`,
      })
      .from(journalEntryTags)
      .where(eq(journalEntryTags.tenantId, ctx.tenantId))
      .groupBy(journalEntryTags.tag)

    const defs = await tx
      .select({
        name: journalTags.name,
        color: journalTags.color,
        description: journalTags.description,
      })
      .from(journalTags)
      .where(eq(journalTags.tenantId, ctx.tenantId))

    const map = new Map<string, ManagedTag>()
    for (const u of usageRows) {
      map.set(u.tag, {
        name: u.tag,
        usage: Number(u.usage),
        aiCount: Number(u.ai),
        userCount: Number(u.usr),
        color: null,
        description: null,
        defined: false,
      })
    }
    for (const d of defs) {
      const existing = map.get(d.name)
      if (existing) {
        existing.color = d.color
        existing.description = d.description
        existing.defined = true
      } else {
        map.set(d.name, {
          name: d.name,
          usage: 0,
          aiCount: 0,
          userCount: 0,
          color: d.color,
          description: d.description,
          defined: true,
        })
      }
    }
    return [...map.values()].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
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
    // Entries carrying any source or the target — their cache needs rebuilding.
    const touched = await tx
      .select({ id: journalEntryTags.entryId })
      .from(journalEntryTags)
      .where(
        and(eq(journalEntryTags.tenantId, ctx.tenantId), inArray(journalEntryTags.tag, [...srcs, tgt])),
      )
    const entryIds = Array.from(new Set(touched.map((r) => r.id)))

    // 1) Drop source rows on entries that already carry the target — the
    //    (entry_id, tag) unique index would reject repointing them.
    await tx.execute(sql`
      delete from ${journalEntryTags} src
      where src.tenant_id = ${ctx.tenantId}
        and src.tag in (${sql.join(srcs.map((s) => sql`${s}`), sql`, `)})
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
    // 3) Rebuild the denormalised cache for each touched entry.
    if (entryIds.length > 0) {
      await tx
        .update(journalEntries)
        .set({ tagsCache: recomputedCache })
        .where(and(eq(journalEntries.tenantId, ctx.tenantId), inArray(journalEntries.id, entryIds)))
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
    return entryIds.length
  })
}

/** Rename a tag everywhere; if the new name already exists this becomes a merge. */
export async function renameTag(
  ctx: RequestContext,
  from: string,
  to: string,
): Promise<number> {
  return mergeTags(ctx, [from], to)
}

/** Remove a tag from every entry and drop its definition. */
export async function deleteTag(ctx: RequestContext, name: string): Promise<number> {
  const tag = norm(name)
  if (!tag) return 0
  return ctx.db(async (tx) => {
    const touched = await tx
      .select({ id: journalEntryTags.entryId })
      .from(journalEntryTags)
      .where(and(eq(journalEntryTags.tenantId, ctx.tenantId), eq(journalEntryTags.tag, tag)))
    const entryIds = Array.from(new Set(touched.map((r) => r.id)))

    await tx
      .delete(journalEntryTags)
      .where(and(eq(journalEntryTags.tenantId, ctx.tenantId), eq(journalEntryTags.tag, tag)))
    if (entryIds.length > 0) {
      await tx
        .update(journalEntries)
        .set({ tagsCache: recomputedCache })
        .where(and(eq(journalEntries.tenantId, ctx.tenantId), inArray(journalEntries.id, entryIds)))
    }
    await tx
      .delete(journalTags)
      .where(and(eq(journalTags.tenantId, ctx.tenantId), eq(journalTags.name, tag)))
    return entryIds.length
  })
}
