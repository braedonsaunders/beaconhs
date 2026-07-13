'use server'

// Conversation management for the assistant area — thin wrappers over
// ai-conversations.ts (which enforces ownership) plus revalidation, and the
// share-dialog data loader (active people + roles as share targets).

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { people, roles } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import {
  deleteConversation,
  listConversationShares,
  removeConversationShare,
  renameConversation,
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
  const r = await shareConversation(input)
  revalidatePath('/assistant')
  return r
}

export async function unshareAssistantConversation(shareId: string): Promise<void> {
  await removeConversationShare(shareId)
  revalidatePath('/assistant')
}

type ShareTarget = { id: string; name: string }
type ResolvedShare = { id: string; type: 'user' | 'role'; name: string }
export type ShareData = {
  shares: ResolvedShare[]
  users: ShareTarget[]
  roles: ShareTarget[]
}

/** Current shares + the pickable people (with a login) and roles. Owner-only;
 *  returns empty share list for non-owners. */
export async function getShareData(conversationId: string): Promise<ShareData> {
  const ctx = await requireRequestContext()
  const shares = await listConversationShares(conversationId)
  return ctx.db(async (tx) => {
    const peopleRows = await tx
      .select({ userId: people.userId, first: people.firstName, last: people.lastName })
      .from(people)
      .where(and(isNull(people.deletedAt), eq(people.status, 'active')))
    const users: ShareTarget[] = peopleRows
      .filter((p): p is { userId: string; first: string; last: string } => Boolean(p.userId))
      .map((p) => ({ id: p.userId, name: `${p.first} ${p.last}`.trim() }))
      .filter((u) => u.id !== ctx.userId)
      .slice(0, 1000)
    const roleRows = await tx.select({ id: roles.id, name: roles.name }).from(roles)
    const roleList: ShareTarget[] = roleRows.map((r) => ({ id: r.id, name: r.name }))

    const userById = new Map(users.map((u) => [u.id, u.name]))
    const roleById = new Map(roleList.map((r) => [r.id, r.name]))
    const resolved: ResolvedShare[] = shares.map((s) => ({
      id: s.id,
      type: s.targetType,
      name:
        s.targetType === 'user'
          ? (userById.get(s.targetUserId ?? '') ?? 'Person')
          : (roleById.get(s.targetRoleId ?? '') ?? 'Role'),
    }))
    return { shares: resolved, users, roles: roleList }
  })
}
