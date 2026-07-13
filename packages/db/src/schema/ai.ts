// Unified, GLOBAL AI conversation history — reusable by ANY feature (app
// builder, flows, writing assist, future agents…). A feature opens a
// conversation with its own `scope` (+ optional `scopeRefId`, e.g. a template
// id) and appends messages. NOT feature-specific — one table for the whole
// platform so the same history flyout component works everywhere.

import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers, users } from './core'
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
    tenantIdIdUx: uniqueIndex('ai_conversations_tenant_id_id_ux').on(t.tenantId, t.id),
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
    conversationId: uuid('conversation_id').notNull(),
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
    conversationFk: foreignKey({
      name: 'ai_messages_tenant_conversation_fk',
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [aiConversations.tenantId, aiConversations.id],
    }).onDelete('cascade'),
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
    conversationId: uuid('conversation_id').notNull(),
    targetType: aiShareTargetType('target_type').notNull(),
    // Exactly one of these is set, per targetType.
    targetUserId: text('target_user_id'),
    targetRoleId: uuid('target_role_id'),
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
    targetShapeCheck: check(
      'ai_conversation_shares_target_shape_ck',
      sql`(${t.targetType} = 'user' AND ${t.targetUserId} IS NOT NULL AND ${t.targetRoleId} IS NULL)
        OR (${t.targetType} = 'role' AND ${t.targetRoleId} IS NOT NULL AND ${t.targetUserId} IS NULL)`,
    ),
    userShareUx: uniqueIndex('ai_conversation_shares_user_ux')
      .on(t.tenantId, t.conversationId, t.targetUserId)
      .where(sql`${t.targetType} = 'user'`),
    roleShareUx: uniqueIndex('ai_conversation_shares_role_ux')
      .on(t.tenantId, t.conversationId, t.targetRoleId)
      .where(sql`${t.targetType} = 'role'`),
    conversationFk: foreignKey({
      name: 'ai_conversation_shares_tenant_conversation_fk',
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [aiConversations.tenantId, aiConversations.id],
    }).onDelete('cascade'),
    roleFk: foreignKey({
      name: 'ai_conversation_shares_tenant_role_fk',
      columns: [t.tenantId, t.targetRoleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    tenantUserFk: foreignKey({
      name: 'ai_conversation_shares_tenant_user_fk',
      columns: [t.tenantId, t.targetUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.userId],
    }).onDelete('cascade'),
  }),
)

export const aiConversationsRelations = relations(aiConversations, ({ many, one }) => ({
  tenant: one(tenants, { fields: [aiConversations.tenantId], references: [tenants.id] }),
  messages: many(aiMessages),
  shares: many(aiConversationShares),
}))

export const aiConversationSharesRelations = relations(aiConversationShares, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiConversationShares.tenantId, aiConversationShares.conversationId],
    references: [aiConversations.tenantId, aiConversations.id],
  }),
}))

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiMessages.tenantId, aiMessages.conversationId],
    references: [aiConversations.tenantId, aiConversations.id],
  }),
}))

export type AiConversation = typeof aiConversations.$inferSelect
export type AiMessage = typeof aiMessages.$inferSelect
export type AiConversationShare = typeof aiConversationShares.$inferSelect
