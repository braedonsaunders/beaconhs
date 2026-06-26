'use server'

// Server actions for notification groups — reusable, composable audiences.
// Gated on admin.settings.manage (same as the notification cockpit). Member
// resolution + the live preview funnel through the shared resolver in
// @beaconhs/events, which calls the canonical compliance audience engine.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { notificationGroupMembers, notificationGroups } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { previewAudience, type AudienceMemberInput } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const MEMBER_KINDS = new Set([
  'everyone',
  'person',
  'role',
  'department',
  'org_unit',
  'trade',
  'crew',
  'person_group',
])

type Result = { ok: true; id?: string } | { ok: false; error: string }

async function guard() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    return null
  }
  return ctx
}

function sanitizeMembers(members: AudienceMemberInput[]): AudienceMemberInput[] {
  const seen = new Set<string>()
  const out: AudienceMemberInput[] = []
  for (const m of members) {
    if (!MEMBER_KINDS.has(m.kind)) continue
    const entityKey = m.kind === 'everyone' ? '' : String(m.entityKey ?? '').trim()
    if (m.kind !== 'everyone' && !entityKey) continue
    const mode = m.mode === 'exclude' ? 'exclude' : 'include'
    const dedup = `${m.kind}:${entityKey}:${mode}`
    if (seen.has(dedup)) continue
    seen.add(dedup)
    out.push({ kind: m.kind, entityKey, mode })
  }
  return out
}

export async function createGroup(input: {
  name: string
  description?: string | null
  color?: string | null
  members?: AudienceMemberInput[]
}): Promise<Result> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to manage notifications.' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  const members = sanitizeMembers(input.members ?? [])
  try {
    const id = await ctx.db(async (tx) => {
      const [row] = await tx
        .insert(notificationGroups)
        .values({
          tenantId: ctx.tenantId,
          name,
          description: input.description?.trim() || null,
          color: input.color?.trim() || null,
        })
        .returning({ id: notificationGroups.id })
      if (row && members.length > 0) {
        await tx.insert(notificationGroupMembers).values(
          members.map((m) => ({
            tenantId: ctx.tenantId,
            groupId: row.id,
            kind: m.kind,
            entityKey: m.entityKey,
            mode: m.mode,
          })),
        )
      }
      return row?.id ?? null
    })
    if (!id) return { ok: false, error: 'Could not create group.' }
    await recordAudit(ctx, {
      entityType: 'notification_group',
      entityId: id,
      action: 'create',
      summary: `Created notification group "${name}"`,
    })
    revalidatePath('/admin/notifications/groups')
    return { ok: true, id }
  } catch {
    return { ok: false, error: `A group named "${name}" already exists.` }
  }
}

export async function updateGroup(input: {
  id: string
  name: string
  description?: string | null
  color?: string | null
  members: AudienceMemberInput[]
}): Promise<Result> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to manage notifications.' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  const members = sanitizeMembers(input.members)
  try {
    const updated = await ctx.db(async (tx) => {
      const [group] = await tx
        .update(notificationGroups)
        .set({
          name,
          description: input.description?.trim() || null,
          color: input.color?.trim() || null,
        })
        .where(
          and(
            eq(notificationGroups.id, input.id),
            eq(notificationGroups.tenantId, ctx.tenantId),
            isNull(notificationGroups.deletedAt),
          ),
        )
        .returning({ id: notificationGroups.id })
      if (!group) return false

      // Replace the member set wholesale — simplest correct semantics.
      await tx
        .delete(notificationGroupMembers)
        .where(
          and(
            eq(notificationGroupMembers.groupId, input.id),
            eq(notificationGroupMembers.tenantId, ctx.tenantId),
          ),
        )
      if (members.length > 0) {
        await tx.insert(notificationGroupMembers).values(
          members.map((m) => ({
            tenantId: ctx.tenantId,
            groupId: input.id,
            kind: m.kind,
            entityKey: m.entityKey,
            mode: m.mode,
          })),
        )
      }
      return true
    })
    if (!updated) return { ok: false, error: 'Notification group not found.' }
    await recordAudit(ctx, {
      entityType: 'notification_group',
      entityId: input.id,
      action: 'update',
      summary: `Updated notification group "${name}"`,
    })
    revalidatePath('/admin/notifications/groups')
    return { ok: true, id: input.id }
  } catch {
    return { ok: false, error: `A group named "${name}" already exists.` }
  }
}

export async function deleteGroup(input: { id: string }): Promise<Result> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to manage notifications.' }
  const deleted = await ctx.db(async (tx) => {
    const [group] = await tx
      .update(notificationGroups)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(notificationGroups.id, input.id),
          eq(notificationGroups.tenantId, ctx.tenantId),
          isNull(notificationGroups.deletedAt),
        ),
      )
      .returning({ id: notificationGroups.id })
    return Boolean(group)
  })
  if (!deleted) return { ok: false, error: 'Notification group not found.' }
  await recordAudit(ctx, {
    entityType: 'notification_group',
    entityId: input.id,
    action: 'delete',
    summary: 'Deleted notification group',
  })
  revalidatePath('/admin/notifications/groups')
  return { ok: true }
}

export async function previewGroup(
  members: AudienceMemberInput[],
): Promise<{ count: number; withEmail: number; sample: string[] }> {
  const ctx = await guard()
  if (!ctx) return { count: 0, withEmail: 0, sample: [] }
  const clean = sanitizeMembers(members)
  if (clean.length === 0) return { count: 0, withEmail: 0, sample: [] }
  return ctx.db((tx) => previewAudience(tx, ctx.tenantId, clean))
}
