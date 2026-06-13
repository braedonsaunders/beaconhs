'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { notifications } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

const PAGE_SIZE = 30

export type InboxItem = {
  id: string
  title: string
  body: string | null
  category: string
  linkPath: string | null
  isCritical: boolean
  occurredAt: string
  read: boolean
}

const toItem = (n: typeof notifications.$inferSelect): InboxItem => ({
  id: n.id,
  title: n.title,
  body: n.body,
  category: n.category,
  linkPath: n.linkPath,
  isCritical: n.isCritical,
  occurredAt: new Date(n.occurredAt).toISOString(),
  read: !!n.readAt,
})

export async function fetchInboxPage(cursor?: { occurredAt: string; id: string }) {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          cursor
            ? or(
                lt(notifications.occurredAt, new Date(cursor.occurredAt)),
                and(
                  eq(notifications.occurredAt, new Date(cursor.occurredAt)),
                  lt(notifications.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(notifications.occurredAt), desc(notifications.id))
      .limit(PAGE_SIZE + 1),
  )
  return {
    items: rows.slice(0, PAGE_SIZE).map(toItem),
    hasMore: rows.length > PAGE_SIZE,
  }
}

export async function inboxUnreadCount() {
  const ctx = await requireRequestContext()
  const [row] = await ctx.db((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt))),
  )
  return row?.count ?? 0
}

export async function markNotificationRead(id: string) {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId))),
  )
  // Refresh the shell's bell badge; the list itself updates optimistically.
  revalidatePath('/', 'layout')
}

export async function markAllNotificationsRead() {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt))),
  )
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
}
