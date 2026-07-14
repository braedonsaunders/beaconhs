'use server'

// Conversation management for the assistant area — thin wrappers over
// ai-conversations.ts (which enforces ownership) plus revalidation, and the
// share-dialog data loader (active people + roles as share targets).

import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, ilike, inArray, ne, notExists, or, sql } from 'drizzle-orm'
import { aiConversationShares, roles, tenantUsers, users } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import {
  boundPickerOptions,
  PICKER_RESULT_LIMIT,
  type PickerOptionsResponse,
} from '@/lib/picker-options'
import {
  escapeShareTargetSearch,
  parseShareTargetSearchInput,
} from '@/lib/assistant/share-target-policy'
import {
  deleteConversation,
  listConversationShares,
  removeConversationShare,
  renameConversation,
  resolveConversationAccess,
  shareConversation,
} from '@/lib/ai-conversations'

export async function renameAssistantConversation(id: string, title: string): Promise<void> {
  await renameConversation(id, title)
  revalidatePath('/assistant')
}

export async function deleteAssistantConversation(id: string): Promise<void> {
  await deleteConversation(id)
  revalidatePath('/assistant')
}

export async function shareAssistantConversation(input: {
  conversationId: string
  targetType: 'user' | 'role'
  targetId: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid share target.' }
  if ((await resolveConversationAccess(input.conversationId, 'assistant')) !== 'owner') {
    return { ok: false, error: 'Only the owner can share this conversation.' }
  }
  const r = await shareConversation({ ...input, expectedScope: 'assistant' })
  revalidatePath('/assistant')
  return r
}

export async function unshareAssistantConversation(shareId: string): Promise<void> {
  await removeConversationShare(shareId, 'assistant')
  revalidatePath('/assistant')
}

type ResolvedShare = { id: string; type: 'user' | 'role'; name: string }
export type ShareData = {
  shares: ResolvedShare[]
}

/** Current shares with exact label hydration. Candidate lookup is separate and bounded. */
export async function getShareData(conversationId: string): Promise<ShareData> {
  if ((await resolveConversationAccess(conversationId, 'assistant')) !== 'owner') {
    throw new Error('Conversation sharing is unavailable.')
  }
  const ctx = await requireRequestContext()
  const shares = await listConversationShares(conversationId, 'assistant')
  return ctx.db(async (tx) => {
    const userIds = shares.flatMap((share) =>
      share.targetType === 'user' && share.targetUserId ? [share.targetUserId] : [],
    )
    const roleIds = shares.flatMap((share) =>
      share.targetType === 'role' && share.targetRoleId ? [share.targetRoleId] : [],
    )
    const [userRows, roleRows] = await Promise.all([
      userIds.length
        ? tx
            .select({
              id: tenantUsers.userId,
              displayName: tenantUsers.displayName,
              name: users.name,
              email: users.email,
            })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(inArray(tenantUsers.userId, userIds))
        : Promise.resolve([]),
      roleIds.length
        ? tx
            .select({ id: roles.id, name: roles.name })
            .from(roles)
            .where(inArray(roles.id, roleIds))
        : Promise.resolve([]),
    ])
    const userById = new Map(
      userRows.map((user) => [
        user.id,
        user.displayName?.trim() || user.name?.trim() || user.email,
      ]),
    )
    const roleById = new Map(roleRows.map((role) => [role.id, role.name]))
    const resolved: ResolvedShare[] = shares.map((s) => ({
      id: s.id,
      type: s.targetType,
      name:
        s.targetType === 'user'
          ? (userById.get(s.targetUserId ?? '') ?? 'Person')
          : (roleById.get(s.targetRoleId ?? '') ?? 'Role'),
    }))
    return { shares: resolved }
  })
}

/** Bounded remote picker for active tenant accounts or roles, with selected hydration. */
export async function loadAssistantShareTargets(input: unknown): Promise<PickerOptionsResponse> {
  const parsed = parseShareTargetSearchInput(input)
  if ((await resolveConversationAccess(parsed.conversationId, 'assistant')) !== 'owner') {
    throw new Error('Conversation sharing is unavailable.')
  }
  const ctx = await requireRequestContext()
  const term = parsed.query ? `%${escapeShareTargetSearch(parsed.query)}%` : null
  return ctx.db(async (tx) => {
    if (parsed.targetType === 'user') {
      const match = term
        ? or(
            ilike(tenantUsers.displayName, term),
            ilike(users.name, term),
            ilike(users.email, term),
            parsed.selected ? eq(tenantUsers.userId, parsed.selected) : undefined,
          )
        : parsed.selected
          ? eq(tenantUsers.userId, parsed.selected)
          : undefined
      const rows = await tx
        .select({
          id: tenantUsers.userId,
          displayName: tenantUsers.displayName,
          name: users.name,
          email: users.email,
        })
        .from(tenantUsers)
        .innerJoin(users, eq(users.id, tenantUsers.userId))
        .where(
          and(
            eq(tenantUsers.status, 'active'),
            ne(tenantUsers.userId, ctx.userId),
            match,
            notExists(
              tx
                .select({ id: aiConversationShares.id })
                .from(aiConversationShares)
                .where(
                  and(
                    eq(aiConversationShares.conversationId, parsed.conversationId),
                    eq(aiConversationShares.targetType, 'user'),
                    eq(aiConversationShares.targetUserId, tenantUsers.userId),
                  ),
                ),
            ),
          ),
        )
        .orderBy(
          ...(parsed.selected ? [desc(sql`${tenantUsers.userId} = ${parsed.selected}`)] : []),
          asc(tenantUsers.displayName),
          asc(users.name),
          asc(users.email),
          asc(tenantUsers.userId),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((user) => ({
          value: user.id,
          label: (user.displayName?.trim() || user.name?.trim() || user.email).slice(0, 240),
          hint: user.email.slice(0, 120),
        })),
      )
    }

    const match = term
      ? or(
          ilike(roles.name, term),
          ilike(roles.key, term),
          parsed.selected ? eq(roles.id, parsed.selected) : undefined,
        )
      : parsed.selected
        ? eq(roles.id, parsed.selected)
        : undefined
    const rows = await tx
      .select({ id: roles.id, name: roles.name, key: roles.key })
      .from(roles)
      .where(
        and(
          match,
          notExists(
            tx
              .select({ id: aiConversationShares.id })
              .from(aiConversationShares)
              .where(
                and(
                  eq(aiConversationShares.conversationId, parsed.conversationId),
                  eq(aiConversationShares.targetType, 'role'),
                  eq(aiConversationShares.targetRoleId, roles.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(
        ...(parsed.selected ? [desc(sql`${roles.id} = ${parsed.selected}`)] : []),
        asc(roles.name),
        asc(roles.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)
    return boundPickerOptions(
      rows.map((role) => ({
        value: role.id,
        label: role.name.slice(0, 240),
        hint: role.key.slice(0, 120),
      })),
    )
  })
}
