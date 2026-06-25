'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import {
  complianceObligations,
  complianceStatus,
  correctiveActions,
  documentAcknowledgments,
  documents,
  notifications,
  people,
} from '@beaconhs/db/schema'
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

/** A smart view (all/unread/critical/todos) or a single category "folder", plus search. */
export type InboxFilter = {
  kind: 'all' | 'unread' | 'critical' | 'todos' | 'category'
  category?: string
  q?: string
}

export type InboxFolders = {
  total: number
  unread: number
  criticalTotal: number
  criticalUnread: number
  todos: number
  categories: { category: string; total: number; unread: number }[]
}

export type TodoKind = 'compliance' | 'capa' | 'document'
export type TodoItem = {
  id: string
  kind: TodoKind
  title: string
  subtitle: string | null
  status: string
  dueOn: string | null
  linkPath: string
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
  // Snoozed alerts drop out until their snooze expires.
  conds.push(
    or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)) as SQL,
  )
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
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`)),
        ),
      )
      .groupBy(notifications.category),
  )
  const folders = rows.reduce<InboxFolders>(
    (acc, r) => {
      acc.total += r.total
      acc.unread += r.unread
      acc.criticalTotal += r.criticalTotal
      acc.criticalUnread += r.criticalUnread
      acc.categories.push({ category: r.category, total: r.total, unread: r.unread })
      return acc
    },
    { total: 0, unread: 0, criticalTotal: 0, criticalUnread: 0, todos: 0, categories: [] },
  )
  folders.todos = (await collectTodos(ctx)).length
  return folders
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

/** Defer an alert out of the inbox for `hours`. */
export async function snoozeNotification(id: string, hours: number) {
  const ctx = await requireRequestContext()
  const h = Math.min(720, Math.max(1, Math.round(hours)))
  await ctx.db((tx) =>
    tx
      .update(notifications)
      .set({ snoozedUntil: sql`now() + ((${h})::text || ' hours')::interval` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId))),
  )
  revalidatePath('/', 'layout')
}

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

/**
 * The actionable "what's due for me" side of the blended inbox: the user's own
 * compliance subjects, their open corrective actions, and unacknowledged
 * documents. These are persistent obligations (not one-shot alerts), so they
 * live alongside notifications rather than inside them.
 */
async function collectTodos(ctx: Ctx): Promise<TodoItem[]> {
  return ctx.db(async (tx) => {
    const todos: TodoItem[] = []
    const [me] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.userId, ctx.userId)))
      .limit(1)
    const personId = me?.id ?? null
    const membershipId = ctx.membership?.id ?? null

    if (personId) {
      const rows = await tx
        .select({
          subjectKey: complianceStatus.subjectKey,
          obligationId: complianceStatus.obligationId,
          status: complianceStatus.status,
          dueOn: complianceStatus.dueOn,
          title: complianceObligations.title,
        })
        .from(complianceStatus)
        .innerJoin(
          complianceObligations,
          eq(complianceObligations.id, complianceStatus.obligationId),
        )
        .where(
          and(
            eq(complianceStatus.tenantId, ctx.tenantId),
            eq(complianceStatus.personId, personId),
            inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue', 'expiring']),
          ),
        )
        .orderBy(asc(complianceStatus.dueOn))
      for (const r of rows) {
        todos.push({
          id: `compliance:${r.obligationId}:${r.subjectKey}`,
          kind: 'compliance',
          title: r.title,
          subtitle: r.status,
          status: r.status,
          dueOn: r.dueOn,
          linkPath: `/compliance/obligations/${r.obligationId}`,
        })
      }
    }

    if (membershipId) {
      const rows = await tx
        .select({
          id: correctiveActions.id,
          reference: correctiveActions.reference,
          title: correctiveActions.title,
          status: correctiveActions.status,
          dueOn: correctiveActions.dueOn,
        })
        .from(correctiveActions)
        .where(
          and(
            eq(correctiveActions.tenantId, ctx.tenantId),
            eq(correctiveActions.ownerTenantUserId, membershipId),
            isNull(correctiveActions.deletedAt),
            inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
          ),
        )
        .orderBy(asc(correctiveActions.dueOn))
      for (const r of rows) {
        todos.push({
          id: `capa:${r.id}`,
          kind: 'capa',
          title: `${r.reference} · ${r.title}`,
          subtitle: r.status.replace(/_/g, ' '),
          status: r.status,
          dueOn: r.dueOn,
          linkPath: `/corrective-actions/${r.id}`,
        })
      }
    }

    if (personId) {
      const rows = await tx
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, ctx.tenantId),
            eq(documents.status, 'published'),
            isNull(documents.deletedAt),
            sql`not exists (select 1 from ${documentAcknowledgments} a where a.document_id = ${documents.id} and a.person_id = ${personId})`,
          ),
        )
        .orderBy(asc(documents.title))
      for (const r of rows) {
        todos.push({
          id: `document:${r.id}`,
          kind: 'document',
          title: r.title,
          subtitle: 'Acknowledgment required',
          status: 'pending',
          dueOn: null,
          linkPath: `/documents/${r.id}`,
        })
      }
    }

    return todos
  })
}

export async function fetchInboxTodos(): Promise<TodoItem[]> {
  const ctx = await requireRequestContext()
  return collectTodos(ctx)
}
