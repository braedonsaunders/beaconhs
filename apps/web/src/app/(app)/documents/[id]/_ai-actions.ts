'use server'

// Persistence for the document AI assistant, backed by the platform's unified
// ai_conversations / ai_messages tables (scope = 'documents.editor', scopeRefId
// = documentId, one thread per user per document).

import { and, asc, desc, eq } from 'drizzle-orm'
import { aiConversations, aiMessages } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

const SCOPE = 'documents.editor'

export type DocAiRole = 'user' | 'assistant'
export type DocAiMessage = { id: string; role: DocAiRole; content: string }

export async function loadDocConversation(
  documentId: string,
): Promise<{ conversationId: string; messages: DocAiMessage[] }> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const existing = await tx
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.scope, SCOPE),
          eq(aiConversations.scopeRefId, documentId),
          eq(aiConversations.userId, ctx.userId),
        ),
      )
      .orderBy(desc(aiConversations.createdAt))
      .limit(1)
    let conv = existing[0]
    if (!conv) {
      const [created] = await tx
        .insert(aiConversations)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          scope: SCOPE,
          scopeRefId: documentId,
          title: 'Document assistant',
        })
        .returning()
      conv = created!
    }
    const msgs = await tx
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conv.id))
      .orderBy(asc(aiMessages.createdAt))
    return {
      conversationId: conv.id,
      messages: msgs
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ id: m.id, role: m.role as DocAiRole, content: m.content })),
    }
  })
}

export async function appendDocMessages(input: {
  conversationId: string
  messages: { role: DocAiRole; content: string }[]
}): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  if (!input.conversationId || input.messages.length === 0) return { ok: false }
  await ctx.db(async (tx) => {
    for (const m of input.messages) {
      await tx.insert(aiMessages).values({
        tenantId: ctx.tenantId,
        conversationId: input.conversationId,
        role: m.role,
        content: m.content,
      })
    }
  })
  return { ok: true }
}

export async function newDocConversation(documentId: string): Promise<{ conversationId: string }> {
  const ctx = await requireRequestContext()
  const [conv] = await ctx.db((tx) =>
    tx
      .insert(aiConversations)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        scope: SCOPE,
        scopeRefId: documentId,
        title: 'Document assistant',
      })
      .returning({ id: aiConversations.id }),
  )
  return { conversationId: conv!.id }
}
