'use server'

// Generic, GLOBAL AI conversation history. Reusable by ANY feature — pass a
// `scope` (+ optional `scopeRefId`) to namespace the threads. The <AiAssistant>
// component drives these; feature-specific "turn" actions (e.g. the app
// builder's runAppBuilderChat) call createConversation + appendMessage.

import { and, asc, desc, eq } from 'drizzle-orm'
import { aiConversations, aiMessages } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export type AiConversationSummary = { id: string; title: string; updatedAt: string }
export type AiChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  data: Record<string, unknown> | null
  createdAt: string
}

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
        ),
      )
      .orderBy(desc(aiConversations.updatedAt))
      .limit(50),
  )
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }))
}

export async function getConversationMessages(conversationId: string): Promise<AiChatMessage[]> {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.createdAt)),
  )
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    data: r.data ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

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
  const ctx = await requireRequestContext()
  await ctx.db(async (tx) => {
    await tx.insert(aiMessages).values({
      tenantId: ctx.tenantId,
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      data: args.data ?? null,
    })
    // Bump the conversation so it sorts to the top of history.
    await tx
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, args.conversationId))
  })
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(aiConversations)
      .set({ title: title.trim() || 'Chat', updatedAt: new Date() })
      .where(eq(aiConversations.id, id)),
  )
}

export async function deleteConversation(id: string): Promise<void> {
  const ctx = await requireRequestContext()
  await ctx.db((tx) => tx.delete(aiConversations).where(eq(aiConversations.id, id)))
}
