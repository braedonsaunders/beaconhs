'use server'

// Server actions for /people/groups admin pages. Every mutation records an
// audit entry and refreshes the denormalised `people.groupIds` cache so list
// pages can filter by group without a 3-way join.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { normalizeCatalogDisplayName } from '@beaconhs/db'
import { people, personGroupMemberships, personGroups } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import {
  lockPersonGroupMembershipGraph,
  refreshPersonGroupCache,
} from '@/lib/person-group-memberships'

function isDuplicateGroupName(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('person_groups_tenant_normalized_name_ux')
}

function parseIds(values: FormDataEntryValue[]): string[] {
  const ids = [...new Set(values.map(String).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  if (ids.some((id) => !isUuid(id))) throw new Error('One or more selections are invalid')
  return ids
}

/**
 * Instant-create a group and land in its detail editor (the single view+edit
 * surface). Called from the list "Add group" button — no separate create form,
 * no create drawer. A blank name defaults to a placeholder the user renames on
 * the detail page.
 */
export async function createGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = normalizeCatalogDisplayName(formData.get('name')) ?? 'Untitled group'
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  let row: typeof personGroups.$inferSelect | undefined
  try {
    row = await ctx.db(async (tx) => {
      const [created] = await tx
        .insert(personGroups)
        .values({ tenantId: ctx.tenantId, name, description, color })
        .returning()
      if (!created) throw new Error('Person group could not be created')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person_group',
        entityId: created.id,
        action: 'create',
        summary: `Added person group "${name}"`,
        after: { name, description, color },
      })
      return created
    })
  } catch (error) {
    if (isDuplicateGroupName(error)) {
      redirect(
        `/people/groups?error=${encodeURIComponent('A group with that name already exists.')}`,
      )
    }
    throw error
  }
  revalidatePath('/people/groups')
  if (row) redirect(`/people/groups/${row.id}`)
}

export async function updateGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) return
  const name = normalizeCatalogDisplayName(formData.get('name'))
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  if (!name) return
  try {
    await ctx.db(async (tx) => {
      const [before] = await tx
        .select()
        .from(personGroups)
        .where(
          and(
            eq(personGroups.tenantId, ctx.tenantId),
            eq(personGroups.id, id),
            isNull(personGroups.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!before) return
      if (before.name === name && before.description === description && before.color === color) {
        return
      }
      const [updated] = await tx
        .update(personGroups)
        .set({ name, description, color })
        .where(and(eq(personGroups.tenantId, ctx.tenantId), eq(personGroups.id, id)))
        .returning({ id: personGroups.id })
      if (!updated) throw new Error('Person group no longer exists')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person_group',
        entityId: id,
        action: 'update',
        summary: `Updated person group "${name}"`,
        before: before as unknown as Record<string, unknown>,
        after: { name, description, color },
      })
    })
  } catch (error) {
    if (isDuplicateGroupName(error)) {
      redirect(
        `/people/groups/${id}?error=${encodeURIComponent('A group with that name already exists.')}`,
      )
    }
    throw error
  }
  revalidatePath(`/people/groups/${id}`)
  revalidatePath('/people/groups')
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) return
  const deleted = await ctx.db(async (tx) => {
    await lockPersonGroupMembershipGraph(tx, ctx.tenantId)
    const [before] = await tx
      .select()
      .from(personGroups)
      .where(and(eq(personGroups.tenantId, ctx.tenantId), eq(personGroups.id, id)))
      .limit(1)
      .for('update')
    if (!before) return null
    const members = await tx
      .select({ personId: personGroupMemberships.personId })
      .from(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.tenantId, ctx.tenantId),
          eq(personGroupMemberships.groupId, id),
        ),
      )
      .orderBy(asc(personGroupMemberships.personId))
    const [removed] = await tx
      .delete(personGroups)
      .where(and(eq(personGroups.tenantId, ctx.tenantId), eq(personGroups.id, id)))
      .returning({ id: personGroups.id })
    if (!removed) return null
    // Recompute the denormalised arrays for everyone affected.
    await refreshPersonGroupCache(
      tx,
      ctx.tenantId,
      members.map((member) => member.personId),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'person_group',
      entityId: id,
      action: 'delete',
      summary: `Deleted person group "${before.name}"`,
      before: before as unknown as Record<string, unknown>,
    })
    return before
  })
  if (!deleted) return
  revalidatePath('/people/groups')
  redirect('/people/groups')
}

export async function setGroupMembership(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const groupId = String(formData.get('groupId') ?? '')
  if (!isUuid(groupId)) return
  const personIds = parseIds(formData.getAll('personIds'))

  await ctx.db(async (tx) => {
    await lockPersonGroupMembershipGraph(tx, ctx.tenantId)
    const [group] = await tx
      .select({ id: personGroups.id })
      .from(personGroups)
      .where(
        and(
          eq(personGroups.tenantId, ctx.tenantId),
          eq(personGroups.id, groupId),
          isNull(personGroups.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!group) throw new Error('Person group not found')
    const existing = await tx
      .select({ personId: personGroupMemberships.personId })
      .from(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.tenantId, ctx.tenantId),
          eq(personGroupMemberships.groupId, groupId),
        ),
      )
      .orderBy(asc(personGroupMemberships.personId))
      .for('update')
    const existingIds = existing.map((r) => r.personId)
    const toRemove = existingIds.filter((id) => !personIds.includes(id))
    const toAdd = personIds.filter((id) => !existingIds.includes(id))
    if (toAdd.length > 0) {
      const addable = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.tenantId, ctx.tenantId),
            inArray(people.id, toAdd),
            eq(people.status, 'active'),
            isNull(people.deletedAt),
          ),
        )
        .orderBy(asc(people.id))
        .for('update')
      if (addable.length !== toAdd.length) {
        throw new Error('Only active people can be added to a group')
      }
    }
    if (toRemove.length > 0) {
      await tx
        .delete(personGroupMemberships)
        .where(
          and(
            eq(personGroupMemberships.tenantId, ctx.tenantId),
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
    const all = [...new Set([...existingIds, ...personIds])]
    await refreshPersonGroupCache(tx, ctx.tenantId, all)
    if (toAdd.length > 0 || toRemove.length > 0) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person_group',
        entityId: groupId,
        action: 'update',
        summary: `Updated membership (+${toAdd.length}/-${toRemove.length}; now ${personIds.length})`,
        before: { memberPersonIds: existingIds },
        after: { memberPersonIds: personIds },
      })
    }
  })
  revalidatePath(`/people/groups/${groupId}`)
}

/**
 * Set a person's full group membership set in one shot — the write half of the
 * inline "Groups" multi-select on the person overview. Diffs against the current
 * memberships, adds/removes the delta, and refreshes the denormalised cache.
 */
export async function setPersonGroups(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const personId = String(formData.get('id') ?? '')
  if (!isUuid(personId)) return
  const groupIds = parseIds(formData.getAll('value'))

  await ctx.db(async (tx) => {
    await lockPersonGroupMembershipGraph(tx, ctx.tenantId)
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.tenantId, ctx.tenantId), eq(people.id, personId), isNull(people.deletedAt)),
      )
      .limit(1)
      .for('update')
    if (!person) throw new Error('Person not found')
    if (groupIds.length > 0) {
      const selectedGroups = await tx
        .select({ id: personGroups.id })
        .from(personGroups)
        .where(
          and(
            eq(personGroups.tenantId, ctx.tenantId),
            inArray(personGroups.id, groupIds),
            isNull(personGroups.deletedAt),
          ),
        )
        .orderBy(asc(personGroups.id))
        .for('key share')
      if (selectedGroups.length !== groupIds.length) {
        throw new Error('One or more selected groups are unavailable')
      }
    }
    const existing = await tx
      .select({ groupId: personGroupMemberships.groupId })
      .from(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.tenantId, ctx.tenantId),
          eq(personGroupMemberships.personId, personId),
        ),
      )
      .orderBy(asc(personGroupMemberships.groupId))
      .for('update')
    const existingIds = existing.map((r) => r.groupId)
    const toRemove = existingIds.filter((g) => !groupIds.includes(g))
    const toAdd = groupIds.filter((g) => !existingIds.includes(g))
    if (toRemove.length > 0) {
      await tx
        .delete(personGroupMemberships)
        .where(
          and(
            eq(personGroupMemberships.tenantId, ctx.tenantId),
            eq(personGroupMemberships.personId, personId),
            inArray(personGroupMemberships.groupId, toRemove),
          ),
        )
    }
    if (toAdd.length > 0) {
      await tx
        .insert(personGroupMemberships)
        .values(toAdd.map((groupId) => ({ tenantId: ctx.tenantId, groupId, personId })))
        .onConflictDoNothing()
    }
    await refreshPersonGroupCache(tx, ctx.tenantId, [personId])
    if (toAdd.length > 0 || toRemove.length > 0) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: personId,
        action: 'update',
        summary: 'Updated group memberships',
        before: { groupIds: existingIds },
        after: { groupIds },
      })
    }
  })
  revalidatePath(`/people/${personId}`)
}
