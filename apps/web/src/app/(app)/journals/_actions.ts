'use server'

// Server actions for the Journals workspace: entry mutations, AI analysis,
// photos, and thin data-fetch wrappers the client calls on interaction.
// Every mutation runs inside ctx.db() (tenant + RLS), records an audit row, and
// is scope-checked via scopedWhere() so a self-scoped user can't touch others'
// entries even though RLS only bounds to the tenant.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import {
  attachments,
  journalEntries,
  journalEntryPhotos,
  journalEntryTags,
} from '@beaconhs/db/schema'
import { describePhoto, extractEntryMeta } from '@beaconhs/ai'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { presignGet } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig, getTenantAutoJournalAi } from '@/lib/ai-config'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { emitJournalEntrySubmitted } from '@beaconhs/integrations'
import {
  getAuthorPersonId,
  htmlToText,
  journalCanBrowseAll,
  journalCanReadAll,
  journalScopeWhere,
} from './_lib'
import { buildTree, getEntry, getOrCreateEntryForDate, getWorkspaceData } from './_data'
import { sendJournalEntryEmail } from './_send-email'
import type {
  AuthorRef,
  EntryMetaResult,
  EntryPatch,
  GroupBy,
  JournalEntryDetail,
  JournalFilters,
  TreeNode,
  WorkspaceData,
} from './_types'

type ActionOk<T = {}> = { ok: true } & T
type ActionErr = { ok: false; error: string }

/** Visibility-scoped WHERE for a single live entry (tenant + author/site/self).
 *  Always excludes soft-deleted entries — a deleted journal is not editable. */
async function scopedWhere(ctx: RequestContext, id: string): Promise<SQL> {
  const authorPersonId = journalCanReadAll(ctx) ? null : await getAuthorPersonId(ctx)
  const scope = journalScopeWhere(ctx, authorPersonId)
  return and(eq(journalEntries.id, id), isNull(journalEntries.deletedAt), scope)!
}

// ---- create -----------------------------------------------------------------

const NO_AUTHOR_IDENTITY =
  'Your account is not linked to a person or membership in this tenant, so it cannot own a journal.'

export async function createTodayEntry(): Promise<ActionOk<{ id: string }> | ActionErr> {
  const ctx = await requireRequestContext()
  const id = await getOrCreateEntryForDate(ctx)
  if (!id) return { ok: false, error: NO_AUTHOR_IDENTITY }
  revalidatePath('/journals')
  return { ok: true, id }
}

export async function createEntryForDate(
  dateISO: string,
): Promise<ActionOk<{ id: string }> | ActionErr> {
  const ctx = await requireRequestContext()
  const id = await getOrCreateEntryForDate(ctx, dateISO)
  if (!id) return { ok: false, error: NO_AUTHOR_IDENTITY }
  revalidatePath('/journals')
  return { ok: true, id }
}

// ---- update (autosave) ------------------------------------------------------

export async function updateEntry(input: {
  id: string
  patch: EntryPatch
}): Promise<ActionOk<{ updatedAt: string }> | ActionErr> {
  const ctx = await requireRequestContext()
  const { id, patch } = input

  const values: Record<string, unknown> = {}
  if (patch.title !== undefined) values.title = patch.title?.slice(0, 300) ?? null
  if (patch.bodyHtml !== undefined) {
    // Server-side sanitisation — this action accepts arbitrary strings, so never
    // trust the client editor. Shared allow-list sanitiser (same as Documents)
    // strips scripts/event handlers while keeping every TipTap node and mark.
    const clean = sanitizeDocumentHtml(patch.bodyHtml)
    values.bodyHtml = clean
    values.bodyText = htmlToText(clean)
  }
  if (patch.definition !== undefined) values.definition = patch.definition
  if (patch.siteOrgUnitId !== undefined) values.siteOrgUnitId = patch.siteOrgUnitId || null
  if (patch.supervisorPersonId !== undefined)
    values.supervisorPersonId = patch.supervisorPersonId || null
  if (patch.entryDate !== undefined && patch.entryDate) values.entryDate = patch.entryDate
  if (Object.keys(values).length === 0) return { ok: false, error: 'Nothing to update.' }

  const where = await scopedWhere(ctx, id)
  const [row] = await ctx.db((tx) =>
    tx
      .update(journalEntries)
      .set(values)
      .where(where)
      .returning({ updatedAt: journalEntries.updatedAt }),
  )
  if (!row) return { ok: false, error: 'Entry not found.' }
  // Autosave is high-frequency — the client owns optimistic state, so we skip
  // revalidatePath here to avoid thrashing the route cache.
  return { ok: true, updatedAt: row.updatedAt.toISOString() }
}

export async function submitEntry(id: string): Promise<ActionOk | ActionErr> {
  const ctx = await requireRequestContext()
  const where = await scopedWhere(ctx, id)
  // Draft guard: re-submitting (double-click, replayed request) must not reset
  // submittedAt or re-fire flows / integrations / AI for the same submission.
  const [row] = await ctx.db((tx) =>
    tx
      .update(journalEntries)
      .set({ status: 'submitted', submittedAt: new Date() })
      .where(and(where, eq(journalEntries.status, 'draft')))
      .returning({ reference: journalEntries.reference }),
  )
  if (!row) {
    const [existing] = await ctx.db((tx) =>
      tx.select({ id: journalEntries.id }).from(journalEntries).where(where).limit(1),
    )
    return {
      ok: false,
      error: existing ? 'This entry has already been submitted.' : 'Entry not found.',
    }
  }
  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: id,
    action: 'publish',
    summary: `Submitted ${row.reference}`,
  })
  // Fire any "on submit" journal Flows (email/notify/CAPA/approval). Guarded.
  await runModuleFlows(ctx, { moduleKey: 'journals', event: 'on_submit', subjectId: id })
  await emitJournalEntrySubmitted(ctx, {
    id,
    reference: row.reference,
    status: 'submitted',
    submittedAt: new Date(),
  }).catch(() => {})
  // Background categorisation: when enabled (Admin → AI → Automation), summarise
  // and tag the submitted entry so logs stay organised without the worker doing
  // it. Best-effort — never block a submit on AI.
  try {
    if (await getTenantAutoJournalAi(ctx)) await applyEntryAi(ctx, id)
  } catch {
    /* ignore AI failures on submit */
  }
  revalidatePath('/journals')
  return { ok: true }
}

export async function deleteEntry(id: string): Promise<ActionOk | ActionErr> {
  const ctx = await requireRequestContext()
  const where = await scopedWhere(ctx, id)
  const [row] = await ctx.db((tx) =>
    tx
      .update(journalEntries)
      .set({ deletedAt: new Date() })
      .where(where)
      .returning({ reference: journalEntries.reference }),
  )
  if (!row) return { ok: false, error: 'Entry not found.' }
  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: id,
    action: 'delete',
    summary: `Deleted ${row.reference}`,
  })
  await runModuleFlows(ctx, { moduleKey: 'journals', event: 'on_delete', subjectId: id })
  revalidatePath('/journals')
  return { ok: true }
}

// ---- tags -------------------------------------------------------------------

export async function setEntryTags(input: {
  id: string
  tags: string[]
}): Promise<ActionOk | ActionErr> {
  const ctx = await requireRequestContext()
  const where = await scopedWhere(ctx, input.id)
  const clean = Array.from(
    new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, 20)

  const done = await ctx.db(async (tx) => {
    const [e] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(where)
      .limit(1)
    if (!e) return false
    await tx.delete(journalEntryTags).where(eq(journalEntryTags.entryId, input.id))
    if (clean.length > 0) {
      await tx.insert(journalEntryTags).values(
        clean.map((tag) => ({
          tenantId: ctx.tenantId,
          entryId: input.id,
          tag,
          source: 'user' as const,
        })),
      )
    }
    await tx.update(journalEntries).set({ tagsCache: clean }).where(eq(journalEntries.id, input.id))
    return true
  })
  if (!done) return { ok: false, error: 'Entry not found.' }
  revalidatePath('/journals')
  return { ok: true }
}

// ---- AI ---------------------------------------------------------------------

/**
 * Core AI extract + store for one entry: summarise the body and refresh the
 * AI-sourced tags. Returns the meta, or null when AI is unconfigured / the entry
 * is empty or missing. Shared by the manual action and the auto-on-submit path.
 */
async function applyEntryAi(ctx: RequestContext, id: string): Promise<EntryMetaResult | null> {
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) return null

  const where = await scopedWhere(ctx, id)
  const [entry] = await ctx.db((tx) =>
    tx.select({ bodyText: journalEntries.bodyText }).from(journalEntries).where(where).limit(1),
  )
  if (!entry) return null

  const meta = await extractEntryMeta(aiConfig, entry.bodyText ?? '')
  if (!meta) return null

  await ctx.db(async (tx) => {
    await tx
      .update(journalEntries)
      .set({
        summary: meta.summary,
        aiMeta: { lastRunAt: new Date().toISOString(), tier: 'fast' },
      })
      .where(eq(journalEntries.id, id))
    await tx
      .delete(journalEntryTags)
      .where(and(eq(journalEntryTags.entryId, id), eq(journalEntryTags.source, 'ai')))
    if (meta.tags.length > 0) {
      await tx
        .insert(journalEntryTags)
        .values(
          meta.tags.map((tag) => ({
            tenantId: ctx.tenantId,
            entryId: id,
            tag,
            source: 'ai' as const,
          })),
        )
        .onConflictDoNothing()
    }
    const all = await tx
      .select({ tag: journalEntryTags.tag })
      .from(journalEntryTags)
      .where(eq(journalEntryTags.entryId, id))
    await tx
      .update(journalEntries)
      .set({ tagsCache: Array.from(new Set(all.map((a) => a.tag))) })
      .where(eq(journalEntries.id, id))
  })

  return { summary: meta.summary, tags: meta.tags }
}

// ---- photos -----------------------------------------------------------------

export async function attachJournalPhotos(input: {
  entryId: string
  attachmentIds: string[]
}): Promise<ActionOk<{ photoIds: string[] }> | ActionErr> {
  const ctx = await requireRequestContext()
  if (input.attachmentIds.length === 0) return { ok: true, photoIds: [] }
  const where = await scopedWhere(ctx, input.entryId)

  const ids = await ctx.db(async (tx) => {
    const [e] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(where)
      .limit(1)
    if (!e) return null
    const [{ maxOrder } = { maxOrder: -1 }] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${journalEntryPhotos.sortOrder}), -1)::int` })
      .from(journalEntryPhotos)
      .where(eq(journalEntryPhotos.entryId, input.entryId))
    const base = Number(maxOrder) + 1
    const inserted = await tx
      .insert(journalEntryPhotos)
      .values(
        input.attachmentIds.map((attachmentId, i) => ({
          tenantId: ctx.tenantId,
          entryId: input.entryId,
          attachmentId,
          sortOrder: base + i,
        })),
      )
      .returning({ id: journalEntryPhotos.id })
    return inserted.map((r) => r.id)
  })
  if (!ids) return { ok: false, error: 'Entry not found.' }

  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: input.entryId,
    action: 'update',
    summary: `Added ${ids.length} photo${ids.length === 1 ? '' : 's'}`,
  })
  revalidatePath('/journals')
  return { ok: true, photoIds: ids }
}

export async function removeJournalPhoto(photoId: string): Promise<ActionOk | ActionErr> {
  const ctx = await requireRequestContext()
  const photo = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({ entryId: journalEntryPhotos.entryId })
      .from(journalEntryPhotos)
      .where(eq(journalEntryPhotos.id, photoId))
      .limit(1)
    return p ?? null
  })
  if (!photo) return { ok: false, error: 'Photo not found.' }

  // Visibility check on the parent entry — a photo id alone must never allow
  // mutating another user's journal.
  const where = await scopedWhere(ctx, photo.entryId)
  const done = await ctx.db(async (tx) => {
    const [e] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(where)
      .limit(1)
    if (!e) return false
    await tx.delete(journalEntryPhotos).where(eq(journalEntryPhotos.id, photoId))
    return true
  })
  if (!done) return { ok: false, error: 'Photo not found.' }

  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: photo.entryId,
    action: 'update',
    summary: 'Removed a photo',
  })
  revalidatePath('/journals')
  return { ok: true }
}

export async function describeJournalPhoto(
  photoId: string,
): Promise<ActionOk<{ caption: string }> | ActionErr> {
  const ctx = await requireRequestContext()
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) return { ok: false, error: 'AI is not configured. Set it up under Admin → AI.' }

  const photo = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({
        id: journalEntryPhotos.id,
        entryId: journalEntryPhotos.entryId,
        r2Key: attachments.r2Key,
      })
      .from(journalEntryPhotos)
      .innerJoin(attachments, eq(attachments.id, journalEntryPhotos.attachmentId))
      .where(eq(journalEntryPhotos.id, photoId))
      .limit(1)
    return p ?? null
  })
  if (!photo) return { ok: false, error: 'Photo not found.' }

  // Visibility check on the parent entry before mutating it (or spending AI
  // budget) — mirrors attachJournalPhotos / removeJournalPhoto.
  const where = await scopedWhere(ctx, photo.entryId)
  const visible = await ctx.db(async (tx) => {
    const [e] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(where)
      .limit(1)
    return !!e
  })
  if (!visible) return { ok: false, error: 'Photo not found.' }

  // Fetch bytes server-side — the model provider can't reach a dev/localhost
  // object store via URL, so we send the image data directly.
  let insight
  try {
    const signed = await presignGet({ key: photo.r2Key })
    const resp = await fetch(signed)
    const bytes = new Uint8Array(await resp.arrayBuffer())
    insight = await describePhoto(aiConfig, { image: bytes })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Vision failed.' }
  }
  if (!insight) return { ok: false, error: 'No insight produced.' }

  await ctx.db((tx) =>
    tx
      .update(journalEntryPhotos)
      .set({ caption: insight.caption })
      .where(eq(journalEntryPhotos.id, photoId)),
  )
  revalidatePath('/journals')
  return { ok: true, caption: insight.caption }
}

// ---- data fetch wrappers (client refetch on interaction) --------------------

export async function fetchWorkspace(input: {
  groupBy: GroupBy
  filters: JournalFilters
}): Promise<WorkspaceData> {
  const ctx = await requireRequestContext()
  return getWorkspaceData(ctx, input.groupBy, input.filters)
}

export async function fetchTree(input: {
  groupBy: GroupBy
  filters: JournalFilters
}): Promise<TreeNode[]> {
  const ctx = await requireRequestContext()
  // Workspace tree is always personal — self-scoped.
  return buildTree(ctx, input.groupBy, input.filters, true)
}

export async function fetchEntry(id: string): Promise<JournalEntryDetail | null> {
  const ctx = await requireRequestContext()
  return getEntry(ctx, id)
}

// ---- author workspace (records "Open full entry" flyout) --------------------
// These power the larger, editable workspace flyout an admin opens from the
// records list. They are gated to managers (journalCanBrowseAll); the data layer
// AND-bounds every query by the viewer's own read tier, so the author scope can
// never widen what the viewer is allowed to see.

/** Initial payload for the author workspace flyout: the entry + that author's
 *  tree/sidebar (grouped by date). Returns null if the entry isn't visible. */
export async function fetchAuthorWorkspace(entryId: string): Promise<{
  data: WorkspaceData
  entry: JournalEntryDetail
  author: AuthorRef
} | null> {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) return null
  const entry = await getEntry(ctx, entryId)
  if (!entry) return null
  const author: AuthorRef = {
    personId: entry.personId,
    tenantUserId: entry.createdByTenantUserId,
    name: entry.authorName,
  }
  const data = await getWorkspaceData(ctx, 'date', {}, author)
  return { data, entry, author }
}

/** Refetch the author workspace sidebar (filters/group change). */
export async function fetchAuthorWorkspaceData(input: {
  author: AuthorRef
  groupBy: GroupBy
  filters: JournalFilters
}): Promise<WorkspaceData | null> {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) return null
  return getWorkspaceData(ctx, input.groupBy, input.filters, input.author)
}

/** Refetch only the author workspace tree (group-by change). */
export async function fetchAuthorTree(input: {
  author: AuthorRef
  groupBy: GroupBy
  filters: JournalFilters
}): Promise<TreeNode[]> {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) return []
  return buildTree(ctx, input.groupBy, input.filters, false, input.author)
}

export async function emailEntry(id: string): Promise<ActionOk<{ sent: number }> | ActionErr> {
  const ctx = await requireRequestContext()
  const sent = await sendJournalEntryEmail(ctx, id)
  if (sent === 0) {
    return {
      ok: false,
      error:
        'No recipients found. Add journal recipients in Admin → Notifications, or set a supervisor with an email.',
    }
  }
  return { ok: true, sent }
}
