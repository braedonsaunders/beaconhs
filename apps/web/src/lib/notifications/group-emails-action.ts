'use server'

// Tenant notification groups, for the shared "Send email" dialog: list the
// tenant's groups + resolve a chosen group to its members' email addresses so
// the sender can target a reusable audience in one click. Tenant-scoped via
// requireRequestContext (the caller is sending the email anyway).

import { and, asc, eq, isNull } from 'drizzle-orm'
import { notificationGroups } from '@beaconhs/db/schema'
import { resolveGroupEmails } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'

export async function listNotificationGroups(): Promise<{ value: string; label: string }[]> {
  const ctx = await requireRequestContext()
  try {
    const rows = await ctx.db((tx) =>
      tx
        .select({ id: notificationGroups.id, name: notificationGroups.name })
        .from(notificationGroups)
        .where(
          and(eq(notificationGroups.tenantId, ctx.tenantId), isNull(notificationGroups.deletedAt)),
        )
        .orderBy(asc(notificationGroups.name)),
    )
    return rows.map((r) => ({ value: r.id, label: r.name }))
  } catch {
    return []
  }
}

export async function resolveNotificationGroupEmails(groupId: string): Promise<string[]> {
  const ctx = await requireRequestContext()
  if (!groupId) return []
  try {
    return await ctx.db((tx) => resolveGroupEmails(tx, ctx.tenantId, [groupId]))
  } catch {
    return []
  }
}
