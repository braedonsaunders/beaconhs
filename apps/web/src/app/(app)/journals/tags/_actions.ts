'use server'

// Server actions behind the Journals → Tags admin page. Each is gated on
// journals.assign, records an audit row, revalidates the workspace + this page,
// and returns the freshly-recomputed tag list so the client updates in one trip.

import { revalidatePath } from 'next/cache'
import { can } from '@beaconhs/tenant'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isTagColor } from '../_tag-colors'
import {
  deleteTag,
  listManagedTags,
  mergeTags,
  renameTag,
  upsertTagMeta,
  type ManagedTag,
} from './_data'

export type TagActionResult = { ok: true; tags: ManagedTag[] } | { ok: false; error: string }

async function gate(): Promise<RequestContext | null> {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'journals.assign')) return null
  return ctx
}

const cleanColor = (v: string | null | undefined): string | null => (v && isTagColor(v) ? v : null)

async function refresh(ctx: RequestContext): Promise<TagActionResult> {
  revalidatePath('/journals')
  revalidatePath('/journals/tags')
  return { ok: true, tags: await listManagedTags(ctx) }
}

export async function listTags(): Promise<TagActionResult> {
  const ctx = await gate()
  if (!ctx) return { ok: false, error: 'You don’t have permission to manage tags.' }
  return { ok: true, tags: await listManagedTags(ctx) }
}

/** Create a tag, or edit an existing one (rename + colour/description). */
export async function saveTag(input: {
  name: string
  color: string | null
  description: string | null
  originalName?: string
}): Promise<TagActionResult> {
  const ctx = await gate()
  if (!ctx) return { ok: false, error: 'You don’t have permission to manage tags.' }

  const name = input.name.trim().toLowerCase()
  if (!name) return { ok: false, error: 'Tag name is required.' }
  if (name.length > 40) return { ok: false, error: 'Keep tag names under 40 characters.' }
  if (/[,\n]/.test(name))
    return { ok: false, error: 'Tag names can’t contain commas or line breaks.' }

  const original = input.originalName?.trim().toLowerCase()
  const renamed = !!original && original !== name
  if (renamed) await renameTag(ctx, original!, name)

  await upsertTagMeta(ctx, {
    name,
    color: cleanColor(input.color),
    description: input.description?.trim() || null,
  })

  await recordAudit(ctx, {
    entityType: 'journal_tag',
    action: original ? 'update' : 'create',
    summary: renamed ? `Renamed tag “${original}” → “${name}”` : `Saved tag “${name}”`,
    metadata: renamed ? { from: original, to: name } : { tag: name },
  })
  return refresh(ctx)
}

/** Fold one tag into another across every entry. */
export async function mergeTag(input: {
  source: string
  target: string
}): Promise<TagActionResult> {
  const ctx = await gate()
  if (!ctx) return { ok: false, error: 'You don’t have permission to manage tags.' }

  const source = input.source.trim().toLowerCase()
  const target = input.target.trim().toLowerCase()
  if (!source || !target) return { ok: false, error: 'Pick a tag to merge into.' }
  if (source === target) return { ok: false, error: 'Choose a different target tag.' }

  const n = await mergeTags(ctx, [source], target)
  await recordAudit(ctx, {
    entityType: 'journal_tag',
    action: 'update',
    summary: `Merged “${source}” into “${target}” (${n} ${n === 1 ? 'entry' : 'entries'})`,
    metadata: { source, target, entries: n },
  })
  return refresh(ctx)
}

/** Remove a tag from every entry and drop its definition. */
export async function removeTag(name: string): Promise<TagActionResult> {
  const ctx = await gate()
  if (!ctx) return { ok: false, error: 'You don’t have permission to manage tags.' }

  const tag = name.trim().toLowerCase()
  if (!tag) return { ok: false, error: 'Tag name is required.' }

  const n = await deleteTag(ctx, tag)
  await recordAudit(ctx, {
    entityType: 'journal_tag',
    action: 'delete',
    summary: `Deleted tag “${tag}” (removed from ${n} ${n === 1 ? 'entry' : 'entries'})`,
    metadata: { tag, entries: n },
  })
  return refresh(ctx)
}
