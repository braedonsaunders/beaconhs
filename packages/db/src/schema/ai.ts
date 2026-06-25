// Unified, GLOBAL AI conversation history — reusable by ANY feature (app
// builder, flows, writing assist, future agents…). A feature opens a
// conversation with its own `scope` (+ optional `scopeRefId`, e.g. a template
// id) and appends messages. NOT feature-specific — one table for the whole
// platform so the same history flyout component works everywhere.

import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'
import { roles } from './iam'

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

// Opt-in sharing. A conversation is private to its `userId` owner; the owner can
// grant READ-ONLY access to specific people (target_user_id) or whole roles
// (target_role_id). Visibility is resolved in ai-conversations.ts: own OR a share
// row that matches the current user or one of their roles.
export const aiShareTargetType = pgEnum('ai_share_target_type', ['user', 'role'])

export const aiConversationShares = pgTable(
  'ai_conversation_shares',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    targetType: aiShareTargetType('target_type').notNull(),
    // Exactly one of these is set, per targetType.
    targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
    targetRoleId: uuid('target_role_id').references(() => roles.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    conversationIdx: index('ai_conversation_shares_conversation_idx').on(
      t.tenantId,
      t.conversationId,
    ),
    userIdx: index('ai_conversation_shares_user_idx').on(t.tenantId, t.targetUserId),
    roleIdx: index('ai_conversation_shares_role_idx').on(t.tenantId, t.targetRoleId),
  }),
)

export const aiConversationsRelations = relations(aiConversations, ({ many, one }) => ({
  tenant: one(tenants, { fields: [aiConversations.tenantId], references: [tenants.id] }),
  messages: many(aiMessages),
  shares: many(aiConversationShares),
}))

export const aiConversationSharesRelations = relations(aiConversationShares, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiConversationShares.conversationId],
    references: [aiConversations.id],
  }),
}))

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiMessages.conversationId],
    references: [aiConversations.id],
  }),
}))

export type AiConversation = typeof aiConversations.$inferSelect
export type AiMessage = typeof aiMessages.$inferSelect
export type AiConversationShare = typeof aiConversationShares.$inferSelect
