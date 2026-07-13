'use server'

// Generic, GLOBAL AI conversation history. Reusable by ANY feature — pass a
// `scope` (+ optional `scopeRefId`) to namespace the threads.
//
// PRIVACY: a conversation is private to its `userId` owner. List / read / rename
// / delete are scoped to the owner; the assistant additionally surfaces threads
// the owner has explicitly SHARED with the current user (read-only). Accessing a
// conversation you neither own nor were shared returns empty / not-found — never
// another user's data, even within the same tenant.

import { and, asc, desc, eq, inArray, or, type SQL } from 'drizzle-orm'
import {
  aiConversationShares,
  aiConversations,
  aiMessages,
  roleAssignments,
  roles,
  tenantUsers,
} from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { recordAudit } from '@/lib/audit'

export type AiConversationSummary = {
  id: string
  title: string
  updatedAt: string
  /** True when this thread is shared with the current user (not owned). */
  shared?: boolean
}
export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data: Record<string, unknown> | null
  createdAt: string
}
type ConversationAccess = 'owner' | 'shared' | 'none'
type ConversationShare = {
  id: string
  targetType: 'user' | 'role'
  targetUserId: string | null
  targetRoleId: string | null
}

// ---- access resolution -----------------------------------------------------

async function myRoleIds(ctx: RequestContext, tx: Database): Promise<string[]> {
  if (!ctx.membership?.id) return []
  const rows = await tx
    .select({ roleId: roleAssignments.roleId })
    .from(roleAssignments)
    .where(eq(roleAssignments.tenantUserId, ctx.membership.id))
  return rows.map((r) => r.roleId)
}

/** WHERE matching shares granted to the current user (by user id or by role). */
function sharedWithMeWhere(ctx: RequestContext, roleIds: string[]): SQL | undefined {
  const conds: SQL[] = [
    and(
      eq(aiConversationShares.targetType, 'user'),
      eq(aiConversationShares.targetUserId, ctx.userId),
    )!,
  ]
  if (roleIds.length > 0) {
    conds.push(
      and(
        eq(aiConversationShares.targetType, 'role'),
        inArray(aiConversationShares.targetRoleId, roleIds),
      )!,
    )
  }
  return conds.length === 1 ? conds[0] : or(...conds)
}

async function internalAccess(
  ctx: RequestContext,
  tx: Database,
  conversationId: string,
): Promise<ConversationAccess> {
  const [row] = await tx
    .select({ userId: aiConversations.userId })
    .from(aiConversations)
    .where(eq(aiConversations.id, conversationId))
    .limit(1)
  if (!row) return 'none'
  if (row.userId === ctx.userId) return 'owner'
  const roleIds = await myRoleIds(ctx, tx)
  const [share] = await tx
    .select({ id: aiConversationShares.id })
    .from(aiConversationShares)
    .where(
      and(eq(aiConversationShares.conversationId, conversationId), sharedWithMeWhere(ctx, roleIds)),
    )
    .limit(1)
  return share ? 'shared' : 'none'
}

/** Owner / shared / none for the current user. */
export async function resolveConversationAccess(
  conversationId: string,
): Promise<ConversationAccess> {
  if (!isUuid(conversationId)) return 'none'
  const ctx = await requireRequestContext()
  return ctx.db((tx) => internalAccess(ctx, tx, conversationId))
}

// ---- reads -----------------------------------------------------------------

/** The current user's OWN conversations in a scope. */
export async function listConversations(
  scope: string,
  scopeRefId?: string | null,
): Promise<AiConversationSummary[]> {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: aiConversations.id,
        title: aiConversations.title,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.scope, scope),
          scopeRefId ? eq(aiConversations.scopeRefId, scopeRefId) : undefined,
          eq(aiConversations.userId, ctx.userId),
        ),
      )
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50),
  )
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }))
}

/** Conversations in a scope that OTHERS have shared with the current user. */
export async function listSharedConversations(scope: string): Promise<AiConversationSummary[]> {
  const ctx = await requireRequestContext()
  const outcome = await ctx.db(async (tx) => {
    const roleIds = await myRoleIds(ctx, tx)
    const rows = await tx
      .selectDistinct({
        id: aiConversations.id,
        title: aiConversations.title,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversationShares)
      .innerJoin(aiConversations, eq(aiConversations.id, aiConversationShares.conversationId))
      .where(and(eq(aiConversations.scope, scope), sharedWithMeWhere(ctx, roleIds)))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50)
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt.toISOString(),
      shared: true,
    }))
  })
  return outcome
}

export async function getConversationMessages(conversationId: string): Promise<AiChatMessage[]> {
  if (!isUuid(conversationId)) return []
  const ctx = await requireRequestContext()
  const outcome = await ctx.db(async (tx) => {
    const access = await internalAccess(ctx, tx, conversationId)
    if (access === 'none') return []
    const rows = await tx
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.createdAt))
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      data: r.data ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
  })
  return outcome
}

// ---- writes ----------------------------------------------------------------

export async function createConversation(args: {
  scope: string
  scopeRefId?: string | null
  title?: string
}): Promise<string> {
  const ctx = await requireRequestContext()
  const id = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(aiConversations)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        scope: args.scope,
        scopeRefId: args.scopeRefId ?? null,
        title: args.title?.trim() || 'New chat',
      })
      .returning({ id: aiConversations.id })
    return row!.id
  })
  return id
}

export async function appendMessage(args: {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data?: Record<string, unknown> | null
}): Promise<void> {
  if (!args || !isUuid(args.conversationId)) return
  const ctx = await requireRequestContext()
  await ctx.db(async (tx) => {
    // Only the owner may append — shared recipients are read-only.
    const [conv] = await tx
      .select({ userId: aiConversations.userId })
      .from(aiConversations)
      .where(eq(aiConversations.id, args.conversationId))
      .limit(1)
    if (!conv || conv.userId !== ctx.userId) return
    await tx.insert(aiMessages).values({
      tenantId: ctx.tenantId,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      data: args.data ?? null,
    })
    await tx
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, args.conversationId))
  })
}

export async function renameConversation(id: string, title: string): Promise<void> {
  if (!isUuid(id) || typeof title !== 'string') return
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(aiConversations)
      .set({ title: (title.trim() || 'Chat').slice(0, 120), updatedAt: new Date() })
      .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, ctx.userId))),
  )
}

export async function deleteConversation(id: string): Promise<void> {
  if (!isUuid(id)) return
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .delete(aiConversations)
      .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, ctx.userId))),
  )
}

// ---- sharing (owner-only) --------------------------------------------------

export async function listConversationShares(conversationId: string): Promise<ConversationShare[]> {
  if (!isUuid(conversationId)) return []
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    if ((await internalAccess(ctx, tx, conversationId)) !== 'owner') return []
    const rows = await tx
      .select({
        id: aiConversationShares.id,
        targetType: aiConversationShares.targetType,
        targetUserId: aiConversationShares.targetUserId,
        targetRoleId: aiConversationShares.targetRoleId,
      })
      .from(aiConversationShares)
      .where(eq(aiConversationShares.conversationId, conversationId))
    return rows
  })
}

export async function shareConversation(args: {
  conversationId: string
  targetType: 'user' | 'role'
  targetId: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  if (
    !args ||
    !isUuid(args.conversationId) ||
    (args.targetType !== 'user' && args.targetType !== 'role') ||
    !isUuid(args.targetId)
  ) {
    return { ok: false, error: 'Invalid share target.' }
  }
  const outcome = await ctx.db(async (tx) => {
    if ((await internalAccess(ctx, tx, args.conversationId)) !== 'owner') {
      return { ok: false, error: 'Only the owner can share this conversation.' }
    }
    if (args.targetType === 'user') {
      if (args.targetId === ctx.userId)
        return { ok: false, error: 'You already own this conversation.' }
      const [member] = await tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.userId, args.targetId), eq(tenantUsers.status, 'active')))
        .limit(1)
      if (!member) return { ok: false, error: 'That user is not an active tenant member.' }
    } else {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, args.targetId))
        .limit(1)
      if (!role) return { ok: false, error: 'That role is not available in this tenant.' }
    }
    const [created] = await tx
      .insert(aiConversationShares)
      .values({
        tenantId: ctx.tenantId,
        conversationId: args.conversationId,
        targetType: args.targetType,
        targetUserId: args.targetType === 'user' ? args.targetId : null,
        targetRoleId: args.targetType === 'role' ? args.targetId : null,
        createdByUserId: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: aiConversationShares.id })
    return { ok: true as const, changed: Boolean(created) }
  })
  if (!outcome.ok) return outcome
  if (outcome.changed) {
    await recordAudit(ctx, {
      entityType: 'ai_conversation',
      entityId: args.conversationId,
      action: 'update',
      summary: `Shared an assistant conversation with a ${args.targetType}`,
      metadata: { targetType: args.targetType, targetId: args.targetId },
    })
  }
  return { ok: true }
}

export async function removeConversationShare(shareId: string): Promise<void> {
  if (!isUuid(shareId)) return
  const ctx = await requireRequestContext()
  const removed = await ctx.db(async (tx) => {
    // Resolve the share's conversation, then verify ownership before deleting.
    const [share] = await tx
      .select({ conversationId: aiConversationShares.conversationId })
      .from(aiConversationShares)
      .where(eq(aiConversationShares.id, shareId))
      .limit(1)
    if (!share) return null
    if ((await internalAccess(ctx, tx, share.conversationId)) !== 'owner') return null
    const [deleted] = await tx
      .delete(aiConversationShares)
      .where(eq(aiConversationShares.id, shareId))
      .returning({
        conversationId: aiConversationShares.conversationId,
        targetType: aiConversationShares.targetType,
        targetUserId: aiConversationShares.targetUserId,
        targetRoleId: aiConversationShares.targetRoleId,
      })
    return deleted ?? null
  })
  if (removed) {
    await recordAudit(ctx, {
      entityType: 'ai_conversation',
      entityId: removed.conversationId,
      action: 'update',
      summary: 'Removed assistant conversation sharing',
      metadata: {
        targetType: removed.targetType,
        targetId: removed.targetUserId ?? removed.targetRoleId,
      },
    })
  }
}
