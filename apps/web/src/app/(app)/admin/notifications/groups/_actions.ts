'use server'

// Server actions for notification groups — reusable, composable audiences.
// Gated on admin.settings.manage (same as the notification cockpit). Member
// resolution + the live preview funnel through the shared resolver in
// @beaconhs/events, which calls the canonical compliance audience engine.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { notificationGroupMembers, notificationGroups } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { previewAudience } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  isNotificationGroupNameConflict,
  NOTIFICATION_GROUP_LIMITS,
  parseNotificationGroupCreate,
  parseNotificationGroupId,
  parseNotificationGroupMembers,
  parseNotificationGroupUpdate,
  type NotificationGroupDetails,
} from './_policy'

type Result = { ok: true; id?: string } | { ok: false; error: string }
type PreviewResult =
  { ok: true; count: number; withEmail: number; sample: string[] } | { ok: false; error: string }

async function guard() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) {
    return null
  }
  return ctx
}

function inputError(error: unknown, fallback: string): Result {
  return { ok: false, error: error instanceof Error ? error.message : fallback }
}

function writeError(
  operation: 'create' | 'update' | 'delete',
  error: unknown,
): Extract<Result, { ok: false }> {
  if (isNotificationGroupNameConflict(error)) {
    return { ok: false, error: 'A notification group with that name already exists.' }
  }
  console.error(`[notification-groups] ${operation} failed`, error)
  return {
    ok: false,
    error: `Could not ${operation} the notification group. Please try again.`,
  }
}

function groupAuditDetails(input: NotificationGroupDetails) {
  return {
    name: input.name,
    description: input.description,
    color: input.color,
    members: input.members,
  }
}

export async function createGroup(input: unknown): Promise<Result> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to manage notifications.' }

  let details: NotificationGroupDetails
  try {
    details = parseNotificationGroupCreate(input)
  } catch (error) {
    return inputError(error, 'The notification group details are invalid.')
  }

  try {
    const id = await ctx.db(async (tx) => {
      const [row] = await tx
        .insert(notificationGroups)
        .values({
          tenantId: ctx.tenantId,
          name: details.name,
          description: details.description,
          color: details.color,
        })
        .returning({ id: notificationGroups.id })
      if (!row) throw new Error('The notification group row was not created.')

      if (details.members.length > 0) {
        await tx.insert(notificationGroupMembers).values(
          details.members.map((member) => ({
            tenantId: ctx.tenantId,
            groupId: row.id,
            kind: member.kind,
            entityKey: member.entityKey,
            mode: member.mode,
          })),
        )
      }
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'notification_group',
        entityId: row.id,
        action: 'create',
        summary: `Created notification group "${details.name}"`,
        after: groupAuditDetails(details),
      })
      return row.id
    })
    revalidatePath('/admin/notifications/groups')
    return { ok: true, id }
  } catch (error) {
    return writeError('create', error)
  }
}

export async function updateGroup(input: unknown): Promise<Result> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to manage notifications.' }

  let details: ReturnType<typeof parseNotificationGroupUpdate>
  try {
    details = parseNotificationGroupUpdate(input)
  } catch (error) {
    return inputError(error, 'The notification group details are invalid.')
  }

  try {
    const updated = await ctx.db(async (tx) => {
      const [existing] = await tx
        .select({
          id: notificationGroups.id,
          name: notificationGroups.name,
          description: notificationGroups.description,
          color: notificationGroups.color,
        })
        .from(notificationGroups)
        .where(
          and(
            eq(notificationGroups.id, details.id),
            eq(notificationGroups.tenantId, ctx.tenantId),
            isNull(notificationGroups.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!existing) return false

      const previousMembers = await tx
        .select({
          kind: notificationGroupMembers.kind,
          entityKey: notificationGroupMembers.entityKey,
          mode: notificationGroupMembers.mode,
        })
        .from(notificationGroupMembers)
        .where(
          and(
            eq(notificationGroupMembers.groupId, details.id),
            eq(notificationGroupMembers.tenantId, ctx.tenantId),
          ),
        )

      await tx
        .update(notificationGroups)
        .set({
          name: details.name,
          description: details.description,
          color: details.color,
        })
        .where(
          and(
            eq(notificationGroups.id, details.id),
            eq(notificationGroups.tenantId, ctx.tenantId),
            isNull(notificationGroups.deletedAt),
          ),
        )

      // The validated payload is the complete member set. Replacing the rows
      // keeps one authoritative audience definition without merge ambiguity.
      await tx
        .delete(notificationGroupMembers)
        .where(
          and(
            eq(notificationGroupMembers.groupId, details.id),
            eq(notificationGroupMembers.tenantId, ctx.tenantId),
          ),
        )
      if (details.members.length > 0) {
        await tx.insert(notificationGroupMembers).values(
          details.members.map((member) => ({
            tenantId: ctx.tenantId,
            groupId: details.id,
            kind: member.kind,
            entityKey: member.entityKey,
            mode: member.mode,
          })),
        )
      }

      await recordAuditInTransaction(tx, ctx, {
        entityType: 'notification_group',
        entityId: details.id,
        action: 'update',
        summary: `Updated notification group "${details.name}"`,
        before: { ...existing, members: previousMembers },
        after: groupAuditDetails(details),
      })
      return true
    })
    if (!updated) return { ok: false, error: 'Notification group not found.' }
    revalidatePath('/admin/notifications/groups')
    return { ok: true, id: details.id }
  } catch (error) {
    return writeError('update', error)
  }
}

export async function deleteGroup(input: unknown): Promise<Result> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to manage notifications.' }

  let id: string
  try {
    id = parseNotificationGroupId(input)
  } catch (error) {
    return inputError(error, 'The notification group is invalid.')
  }

  try {
    const deleted = await ctx.db(async (tx) => {
      const [existing] = await tx
        .select({
          id: notificationGroups.id,
          name: notificationGroups.name,
          description: notificationGroups.description,
          color: notificationGroups.color,
        })
        .from(notificationGroups)
        .where(
          and(
            eq(notificationGroups.id, id),
            eq(notificationGroups.tenantId, ctx.tenantId),
            isNull(notificationGroups.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!existing) return false

      const previousMembers = await tx
        .select({
          kind: notificationGroupMembers.kind,
          entityKey: notificationGroupMembers.entityKey,
          mode: notificationGroupMembers.mode,
        })
        .from(notificationGroupMembers)
        .where(
          and(
            eq(notificationGroupMembers.groupId, id),
            eq(notificationGroupMembers.tenantId, ctx.tenantId),
          ),
        )
      await tx
        .update(notificationGroups)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(notificationGroups.id, id),
            eq(notificationGroups.tenantId, ctx.tenantId),
            isNull(notificationGroups.deletedAt),
          ),
        )
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'notification_group',
        entityId: id,
        action: 'delete',
        summary: `Deleted notification group "${existing.name}"`,
        before: { ...existing, members: previousMembers },
      })
      return true
    })
    if (!deleted) return { ok: false, error: 'Notification group not found.' }
    revalidatePath('/admin/notifications/groups')
    return { ok: true }
  } catch (error) {
    return writeError('delete', error)
  }
}

export async function previewGroup(input: unknown): Promise<PreviewResult> {
  const ctx = await guard()
  if (!ctx) return { ok: false, error: 'You do not have permission to preview this group.' }

  let members: ReturnType<typeof parseNotificationGroupMembers>
  try {
    members = parseNotificationGroupMembers(input)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The group members are invalid.',
    }
  }
  if (members.length === 0) return { ok: true, count: 0, withEmail: 0, sample: [] }

  try {
    const preview = await ctx.db((tx) =>
      previewAudience(tx, ctx.tenantId, members, NOTIFICATION_GROUP_LIMITS.previewSampleCount),
    )
    return { ok: true, ...preview }
  } catch (error) {
    console.error('[notification-groups] preview failed', error)
    return { ok: false, error: 'Could not resolve this preview. Please try again.' }
  }
}
