'use server'

// People groups are the one reusable audience system across the People module,
// notification rules, Flows, and on-demand email.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { personGroups } from '@beaconhs/db/schema'
import { resolveGroupEmails } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'

export async function listPersonGroups(): Promise<{ value: string; label: string }[]> {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(and(eq(personGroups.tenantId, ctx.tenantId), isNull(personGroups.deletedAt)))
      .orderBy(asc(personGroups.name)),
  )
  return rows.map((row) => ({ value: row.id, label: row.name }))
}

export async function resolvePersonGroupEmails(groupId: string): Promise<string[]> {
  const ctx = await requireRequestContext()
  if (!groupId) return []
  return ctx.db((tx) => resolveGroupEmails(tx, ctx.tenantId, [groupId]))
}
