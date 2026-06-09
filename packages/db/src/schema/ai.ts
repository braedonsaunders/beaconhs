// Unified, GLOBAL AI conversation history — reusable by ANY feature (app
// builder, flows, writing assist, future agents…). A feature opens a
// conversation with its own `scope` (+ optional `scopeRefId`, e.g. a template
// id) and appends messages. NOT feature-specific — one table for the whole
// platform so the same history flyout component works everywhere.

import { index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Who started it (for "my conversations"). Nullable for system threads.
    userId: text('user_id').references(() => users.id),
    // Feature namespace, e.g. 'builder.app' | 'builder.flow' | 'writing'.
    scope: text('scope').notNull(),
    // Optional entity the conversation is about, e.g. a form template id.
    scopeRefId: text('scope_ref_id'),
    title: text('title').notNull().default('New chat'),
    ...timestamps,
  },
  (t) => ({
    scopeIdx: index('ai_conversations_scope_idx').on(t.tenantId, t.scope, t.scopeRefId),
    userIdx: index('ai_conversations_user_idx').on(t.tenantId, t.userId),
  }),
)

export const aiMessageRole = pgEnum('ai_message_role', ['user', 'assistant', 'system'])

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: aiMessageRole('role').notNull(),
    content: text('content').notNull(),
    // Free-form structured payload, e.g. the generated app schema / flow graph
    // an assistant turn produced, so the UI can offer an "Apply" action.
    data: jsonb('data').$type<Record<string, unknown> | null>(),
    ...timestamps,
  },
  (t) => ({
    conversationIdx: index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt),
    tenantIdx: index('ai_messages_tenant_idx').on(t.tenantId),
  }),
)

export const aiConversationsRelations = relations(aiConversations, ({ many, one }) => ({
  tenant: one(tenants, { fields: [aiConversations.tenantId], references: [tenants.id] }),
  messages: many(aiMessages),
}))

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiMessages.conversationId],
    references: [aiConversations.id],
  }),
}))

export type AiConversation = typeof aiConversations.$inferSelect
export type AiMessage = typeof aiMessages.$inferSelect
