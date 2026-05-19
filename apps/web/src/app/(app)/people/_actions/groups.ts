'use server'

// Server actions for /people/groups admin pages. Every mutation records an
// audit entry and refreshes the denormalised `people.groupIds` cache so list
// pages can filter by group without a 3-way join.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  people,
  personGroupMemberships,
  personGroups,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export async function createGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  if (!name) return
  const [row] = await ctx.db((tx) =>
    tx
      .insert(personGroups)
      .values({ tenantId: ctx.tenantId, name, description, color })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'person_group',
      entityId: row.id,
      action: 'create',
      summary: `Added person group "${name}"`,
      after: { name, description, color },
    })
  }
  revalidatePath('/people/groups')
  if (row) redirect(`/people/groups/${row.id}`)
}

export async function updateGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  if (!name) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(personGroups).where(eq(personGroups.id, id)).limit(1)
    return r
  })
  await ctx.db((tx) =>
    tx.update(personGroups).set({ name, description, color }).where(eq(personGroups.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'person_group',
    entityId: id,
    action: 'update',
    summary: `Updated person group "${name}"`,
    before: before as unknown as Record<string, unknown>,
    after: { name, description, color },
  })
  revalidatePath(`/people/groups/${id}`)
  revalidatePath('/people/groups')
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(personGroups).where(eq(personGroups.id, id)).limit(1)
    const members = await tx
      .select({ personId: personGroupMemberships.personId })
      .from(personGroupMemberships)
      .where(eq(personGroupMemberships.groupId, id))
    return { row: r, members: members.map((m) => m.personId) }
  })
  await ctx.db(async (tx) => {
    await tx.delete(personGroups).where(eq(personGroups.id, id))
    // Recompute the denormalised arrays for everyone affected.
    if (before.members.length > 0) {
      await refreshGroupCache(tx, ctx.tenantId, before.members)
    }
  })
  await recordAudit(ctx, {
    entityType: 'person_group',
    entityId: id,
    action: 'delete',
    summary: `Deleted person group${before.row ? ` "${before.row.name}"` : ''}`,
    before: before.row as unknown as Record<string, unknown>,
  })
  revalidatePath('/people/groups')
  redirect('/people/groups')
}

export async function setGroupMembership(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const groupId = String(formData.get('groupId') ?? '')
  if (!groupId) return
  const rawIds = formData.getAll('personIds').map((v) => String(v))
  const personIds = Array.from(new Set(rawIds.filter((s) => s.length > 0)))

  const affected = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ personId: personGroupMemberships.personId })
      .from(personGroupMemberships)
      .where(eq(personGroupMemberships.groupId, groupId))
    const existingIds = existing.map((r) => r.personId)
    const toRemove = existingIds.filter((id) => !personIds.includes(id))
    const toAdd = personIds.filter((id) => !existingIds.includes(id))
    if (toRemove.length > 0) {
      await tx
        .delete(personGroupMemberships)
        .where(
          and(
            eq(personGroupMemberships.groupId, groupId),
            inArray(personGroupMemberships.personId, toRemove),
          ),
        )
    }
    if (toAdd.length > 0) {
      await tx
        .insert(personGroupMemberships)
        .values(
          toAdd.map((personId) => ({
            tenantId: ctx.tenantId,
            groupId,
            personId,
          })),
        )
        .onConflictDoNothing()
    }
    const all = Array.from(new Set([...existingIds, ...personIds]))
    if (all.length > 0) {
      await refreshGroupCache(tx, ctx.tenantId, all)
    }
    return { added: toAdd.length, removed: toRemove.length, total: personIds.length }
  })
  await recordAudit(ctx, {
    entityType: 'person_group',
    entityId: groupId,
    action: 'update',
    summary: `Updated membership (+${affected.added}/-${affected.removed}; now ${affected.total})`,
    after: { memberPersonIds: personIds },
  })
  revalidatePath(`/people/groups/${groupId}`)
}

export async function togglePersonInGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const groupId = String(formData.get('groupId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!groupId || !personId) return
  const present = await ctx.db(async (tx) => {
    const [m] = await tx
      .select()
      .from(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.groupId, groupId),
          eq(personGroupMemberships.personId, personId),
        ),
      )
      .limit(1)
    return Boolean(m)
  })
  await ctx.db(async (tx) => {
    if (present) {
      await tx
        .delete(personGroupMemberships)
        .where(
          and(
            eq(personGroupMemberships.groupId, groupId),
            eq(personGroupMemberships.personId, personId),
          ),
        )
    } else {
      await tx
        .insert(personGroupMemberships)
        .values({ tenantId: ctx.tenantId, groupId, personId })
        .onConflictDoNothing()
    }
    await refreshGroupCache(tx, ctx.tenantId, [personId])
  })
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: present ? 'Removed from group' : 'Added to group',
    metadata: { groupId },
  })
  revalidatePath(`/people/${personId}`)
  revalidatePath(`/people/groups/${groupId}`)
}

/**
 * Recompute the cached `people.groupIds` array for the given people. Called
 * after any membership mutation so list-page filters stay correct.
 */
async function refreshGroupCache(
  tx: any,
  tenantId: string,
  personIds: string[],
): Promise<void> {
  if (personIds.length === 0) return
  await tx.execute(sql`
    UPDATE people
    SET group_ids = COALESCE((
      SELECT jsonb_agg(group_id ORDER BY group_id)
      FROM person_group_memberships
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb)
    WHERE id IN (${sql.join(personIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND tenant_id = ${tenantId}
  `)
}
