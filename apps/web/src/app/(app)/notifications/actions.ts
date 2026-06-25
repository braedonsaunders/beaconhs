'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
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

/** A smart view (all/unread/critical) or a single category "folder", plus search. */
export type InboxFilter = {
  kind: 'all' | 'unread' | 'critical' | 'category'
  category?: string
  q?: string
}

export type InboxFolders = {
  total: number
  unread: number
  criticalTotal: number
  criticalUnread: number
  categories: { category: string; total: number; unread: number }[]
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

/** Build the WHERE conditions for a given user + filter (excludes the cursor). */
function filterConds(userId: string, filter?: InboxFilter): SQL[] {
  const conds: SQL[] = [eq(notifications.userId, userId)]
  if (filter?.kind === 'unread') conds.push(isNull(notifications.readAt))
  if (filter?.kind === 'critical') conds.push(eq(notifications.isCritical, true))
  if (filter?.kind === 'category' && filter.category)
    conds.push(eq(notifications.category, filter.category))
  const q = filter?.q?.trim()
  if (q) {
    const like = `%${q}%`
    conds.push(or(ilike(notifications.title, like), ilike(notifications.body, like)) as SQL)
  }
  return conds
}

export async function fetchInboxPage(opts?: {
  cursor?: { occurredAt: string; id: string }
  filter?: InboxFilter
}) {
  const ctx = await requireRequestContext()
  const { cursor, filter } = opts ?? {}
  const conds = filterConds(ctx.userId, filter)
  if (cursor) {
    conds.push(
      or(
        lt(notifications.occurredAt, new Date(cursor.occurredAt)),
        and(
          eq(notifications.occurredAt, new Date(cursor.occurredAt)),
          lt(notifications.id, cursor.id),
        ),
      ) as SQL,
    )
  }
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.occurredAt), desc(notifications.id))
      .limit(PAGE_SIZE + 1),
  )
  return {
    items: rows.slice(0, PAGE_SIZE).map(toItem),
    hasMore: rows.length > PAGE_SIZE,
  }
}

/** Per-category + smart-view counts that drive the folder rail. */
export async function fetchInboxFolders(): Promise<InboxFolders> {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        category: notifications.category,
        total: sql<number>`count(*)::int`,
        unread: sql<number>`(count(*) filter (where ${notifications.readAt} is null))::int`,
        criticalTotal: sql<number>`(count(*) filter (where ${notifications.isCritical}))::int`,
        criticalUnread: sql<number>`(count(*) filter (where ${notifications.isCritical} and ${notifications.readAt} is null))::int`,
      })
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .groupBy(notifications.category),
  )
  return rows.reduce<InboxFolders>(
    (acc, r) => {
      acc.total += r.total
      acc.unread += r.unread
      acc.criticalTotal += r.criticalTotal
      acc.criticalUnread += r.criticalUnread
      acc.categories.push({ category: r.category, total: r.total, unread: r.unread })
      return acc
    },
    { total: 0, unread: 0, criticalTotal: 0, criticalUnread: 0, categories: [] },
  )
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

export async function markNotificationUnread(id: string) {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ readAt: null })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId))),
  )
  revalidatePath('/', 'layout')
}

export async function deleteNotification(id: string) {
  const ctx = await requireRequestContext()
  await ctx.db((tx) =>
    tx
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId))),
  )
  revalidatePath('/', 'layout')
}

/** Mark every unread notification in the current folder/search scope as read. */
export async function markAllNotificationsRead(filter?: InboxFilter) {
  const ctx = await requireRequestContext()
  const conds = filterConds(ctx.userId, filter)
  conds.push(isNull(notifications.readAt))
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...conds)),
  )
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
}
