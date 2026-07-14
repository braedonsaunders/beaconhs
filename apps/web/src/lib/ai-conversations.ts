'use server'

// Generic, GLOBAL AI conversation history. Reusable by ANY feature — pass a
// `scope` (+ optional `scopeRefId`) to namespace the threads.
//
// PRIVACY: a conversation is private to its `userId` owner. List / read / rename
// / delete are scoped to the owner; the assistant additionally surfaces threads
// the owner has explicitly SHARED with the current user (read-only). Accessing a
// conversation you neither own nor were shared returns empty / not-found — never
// another user's data, even within the same tenant.

import { and, desc, eq, ilike, inArray, lt, or, type SQL } from 'drizzle-orm'
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
import {
  AI_CONVERSATION_PAGE_SIZE,
  AI_MESSAGE_PAGE_SIZE,
  decodeAiTimeCursor,
  encodeAiTimeCursor,
  escapeAiConversationSearch,
  normalizeAiConversationSearch,
  normalizeAiConversationTitle,
  validateAiConversationScope,
  validateAiConversationScopeRef,
} from '@/lib/ai-conversation-pagination'

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
export type AiConversationPage = {
  items: AiConversationSummary[]
  nextCursor: string | null
}
type AiMessagePage = {
  items: AiChatMessage[]
  olderCursor: string | null
}
type ConversationAccess = 'owner' | 'shared' | 'none'
type ConversationShare = {
  id: string
  targetType: 'user' | 'role'
  targetUserId: string | null
  targetRoleId: string | null
}

const MAX_MESSAGE_CHARS = 200_000
const MAX_MESSAGE_DATA_BYTES = 2 * 1024 * 1024

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
  expectedScope?: string,
): Promise<ConversationAccess> {
  const [row] = await tx
    .select({ userId: aiConversations.userId })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        expectedScope ? eq(aiConversations.scope, expectedScope) : undefined,
      ),
    )
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
  expectedScope: string,
): Promise<ConversationAccess> {
  if (!isUuid(conversationId)) return 'none'
  const scope = validateAiConversationScope(expectedScope)
  const ctx = await requireRequestContext()
  return ctx.db((tx) => internalAccess(ctx, tx, conversationId, scope))
}

// ---- reads -----------------------------------------------------------------

type ConversationPageArgs = {
  scope: string
  scopeRefId?: string | null
  query?: string
  cursor?: string | null
}

function conversationCursorWhere(cursor: ReturnType<typeof decodeAiTimeCursor>): SQL | undefined {
  if (!cursor) return undefined
  return or(
    lt(aiConversations.updatedAt, cursor.at),
    and(eq(aiConversations.updatedAt, cursor.at), lt(aiConversations.id, cursor.id)),
  )
}

function messageCursorWhere(cursor: ReturnType<typeof decodeAiTimeCursor>): SQL | undefined {
  if (!cursor) return undefined
  return or(
    lt(aiMessages.createdAt, cursor.at),
    and(eq(aiMessages.createdAt, cursor.at), lt(aiMessages.id, cursor.id)),
  )
}

function mapConversationRows(
  rows: { id: string; title: string; updatedAt: Date }[],
  shared = false,
): AiConversationPage {
  const pageRows = rows.slice(0, AI_CONVERSATION_PAGE_SIZE)
  const last = pageRows.at(-1)
  return {
    items: pageRows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      ...(shared ? { shared: true } : {}),
    })),
    nextCursor:
      rows.length > AI_CONVERSATION_PAGE_SIZE && last
        ? encodeAiTimeCursor(last.updatedAt, last.id)
        : null,
  }
}

function mapMessage(row: typeof aiMessages.$inferSelect): AiChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    data: row.data ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** One keyset-paginated page of the current user's own conversations. */
export async function listConversationPage(
  args: ConversationPageArgs,
): Promise<AiConversationPage> {
  if (!args || typeof args !== 'object') throw new Error('Invalid conversation list request.')
  const scope = validateAiConversationScope(args.scope)
  const scopeRefId = validateAiConversationScopeRef(args.scopeRefId)
  const query = normalizeAiConversationSearch(args.query)
  const cursor = decodeAiTimeCursor(args.cursor)
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
          scopeRefId != null ? eq(aiConversations.scopeRefId, scopeRefId) : undefined,
          eq(aiConversations.userId, ctx.userId),
          query
            ? ilike(aiConversations.title, `%${escapeAiConversationSearch(query)}%`)
            : undefined,
          conversationCursorWhere(cursor),
        ),
      )
      .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
      .limit(AI_CONVERSATION_PAGE_SIZE + 1),
  )
  return mapConversationRows(rows)
}

/** One keyset-paginated page of conversations shared with the current user. */
export async function listSharedConversationPage(
  args: Omit<ConversationPageArgs, 'scopeRefId'>,
): Promise<AiConversationPage> {
  if (!args || typeof args !== 'object') throw new Error('Invalid conversation list request.')
  const scope = validateAiConversationScope(args.scope)
  const query = normalizeAiConversationSearch(args.query)
  const cursor = decodeAiTimeCursor(args.cursor)
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const roleIds = await myRoleIds(ctx, tx)
    const rows = await tx
      .selectDistinct({
        id: aiConversations.id,
        title: aiConversations.title,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversationShares)
      .innerJoin(aiConversations, eq(aiConversations.id, aiConversationShares.conversationId))
      .where(
        and(
          eq(aiConversations.scope, scope),
          sharedWithMeWhere(ctx, roleIds),
          query
            ? ilike(aiConversations.title, `%${escapeAiConversationSearch(query)}%`)
            : undefined,
          conversationCursorWhere(cursor),
        ),
      )
      .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
      .limit(AI_CONVERSATION_PAGE_SIZE + 1)
    return mapConversationRows(rows, true)
  })
}

/** The latest message page, or the page immediately older than `cursor`. */
export async function getConversationMessagePage(args: {
  conversationId: string
  cursor?: string | null
}): Promise<AiMessagePage> {
  if (!args || typeof args !== 'object' || !isUuid(args.conversationId)) {
    throw new Error('Invalid conversation message request.')
  }
  const cursor = decodeAiTimeCursor(args.cursor)
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const access = await internalAccess(ctx, tx, args.conversationId)
    if (access === 'none') return { items: [], olderCursor: null }
    const rows = await tx
      .select()
      .from(aiMessages)
      .where(and(eq(aiMessages.conversationId, args.conversationId), messageCursorWhere(cursor)))
      .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
      .limit(AI_MESSAGE_PAGE_SIZE + 1)
    const pageRows = rows.slice(0, AI_MESSAGE_PAGE_SIZE)
    const oldest = pageRows.at(-1)
    return {
      items: pageRows.reverse().map(mapMessage),
      olderCursor:
        rows.length > AI_MESSAGE_PAGE_SIZE && oldest
          ? encodeAiTimeCursor(oldest.createdAt, oldest.id)
          : null,
    }
  })
}

/** Summary for a directly opened thread, preserving access without list scans. */
export async function getConversationSummary(
  conversationId: string,
  expectedScope: string,
): Promise<AiConversationSummary | null> {
  if (!isUuid(conversationId)) return null
  const scope = validateAiConversationScope(expectedScope)
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const access = await internalAccess(ctx, tx, conversationId, scope)
    if (access === 'none') return null
    const [row] = await tx
      .select({
        id: aiConversations.id,
        title: aiConversations.title,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1)
    return row
      ? {
          id: row.id,
          title: row.title,
          updatedAt: row.updatedAt.toISOString(),
          ...(access === 'shared' ? { shared: true } : {}),
        }
      : null
  })
}

// ---- writes ----------------------------------------------------------------

export async function createConversation(args: {
  scope: string
  scopeRefId?: string | null
  title?: string
}): Promise<string> {
  if (!args || typeof args !== 'object') throw new Error('Invalid conversation request.')
  const scope = validateAiConversationScope(args.scope)
  const scopeRefId = validateAiConversationScopeRef(args.scopeRefId)
  const title = normalizeAiConversationTitle(args.title, 'New chat')
  const ctx = await requireRequestContext()
  const id = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(aiConversations)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        scope,
        scopeRefId: scopeRefId ?? null,
        title,
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
  if (
    !args ||
    typeof args !== 'object' ||
    !isUuid(args.conversationId) ||
    (args.role !== 'user' && args.role !== 'assistant' && args.role !== 'system') ||
    typeof args.content !== 'string' ||
    args.content.length > MAX_MESSAGE_CHARS ||
    (args.data !== undefined &&
      args.data !== null &&
      (typeof args.data !== 'object' || Array.isArray(args.data)))
  ) {
    throw new Error('Invalid conversation message.')
  }
  if (args.data != null) {
    let encoded: string
    try {
      encoded = JSON.stringify(args.data)
    } catch {
      throw new Error('Invalid conversation message data.')
    }
    if (new TextEncoder().encode(encoded).byteLength > MAX_MESSAGE_DATA_BYTES) {
      throw new Error('Conversation message data is too large.')
    }
  }
  const ctx = await requireRequestContext()
  await ctx.db(async (tx) => {
    // Only the owner may append — shared recipients are read-only.
    const [conv] = await tx
      .select({ userId: aiConversations.userId })
      .from(aiConversations)
      .where(eq(aiConversations.id, args.conversationId))
      .limit(1)
    if (!conv || conv.userId !== ctx.userId) {
      throw new Error('Conversation is unavailable or read-only.')
    }
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
  if (!isUuid(id)) throw new Error('Invalid conversation title.')
  const normalizedTitle = normalizeAiConversationTitle(title)
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(aiConversations)
      .set({ title: normalizedTitle, updatedAt: new Date() })
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

export async function listConversationShares(
  conversationId: string,
  expectedScope: string,
): Promise<ConversationShare[]> {
  if (!isUuid(conversationId)) return []
  const scope = validateAiConversationScope(expectedScope)
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    if ((await internalAccess(ctx, tx, conversationId, scope)) !== 'owner') return []
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
  expectedScope: string
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
  const scope = validateAiConversationScope(args.expectedScope)
  const outcome = await ctx.db(async (tx) => {
    if ((await internalAccess(ctx, tx, args.conversationId, scope)) !== 'owner') {
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

export async function removeConversationShare(
  shareId: string,
  expectedScope: string,
): Promise<void> {
  if (!isUuid(shareId)) return
  const scope = validateAiConversationScope(expectedScope)
  const ctx = await requireRequestContext()
  const removed = await ctx.db(async (tx) => {
    // Resolve the share's conversation, then verify ownership before deleting.
    const [share] = await tx
      .select({ conversationId: aiConversationShares.conversationId })
      .from(aiConversationShares)
      .where(eq(aiConversationShares.id, shareId))
      .limit(1)
    if (!share) return null
    if ((await internalAccess(ctx, tx, share.conversationId, scope)) !== 'owner') return null
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
