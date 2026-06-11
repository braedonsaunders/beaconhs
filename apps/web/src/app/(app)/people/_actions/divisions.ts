'use server'

// Server actions for /people/divisions admin pages — hierarchical CRUD.
// Each mutation records an audit row and recomputes the denormalised
// `people.divisionIds` cache so list pages can filter by division
// without a 3-way join.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { personDivisionMemberships, personDivisions } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

export async function createDivision(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const code = String(formData.get('code') ?? '').trim() || null
  const parentDivisionId = String(formData.get('parentDivisionId') ?? '').trim() || null
  if (!name) return
  const [row] = await ctx.db((tx) =>
    tx
      .insert(personDivisions)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        code,
        parentDivisionId,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'person_division',
      entityId: row.id,
      action: 'create',
      summary: `Added division "${name}"`,
      after: { name, description, code, parentDivisionId },
    })
  }
  revalidatePath('/people/divisions')
  if (row) redirect(`/people/divisions/${row.id}`)
}

export async function updateDivision(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const code = String(formData.get('code') ?? '').trim() || null
  const parentDivisionId = String(formData.get('parentDivisionId') ?? '').trim() || null
  if (!name) return
  if (parentDivisionId === id) return // can't be own parent
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(personDivisions).where(eq(personDivisions.id, id)).limit(1)
    return r
  })
  await ctx.db((tx) =>
    tx
      .update(personDivisions)
      .set({ name, description, code, parentDivisionId })
      .where(eq(personDivisions.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'person_division',
    entityId: id,
    action: 'update',
    summary: `Updated division "${name}"`,
    before: before as unknown as Record<string, unknown>,
    after: { name, description, code, parentDivisionId },
  })
  revalidatePath(`/people/divisions/${id}`)
  revalidatePath('/people/divisions')
}

export async function deleteDivision(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(personDivisions).where(eq(personDivisions.id, id)).limit(1)
    const members = await tx
      .select({ personId: personDivisionMemberships.personId })
      .from(personDivisionMemberships)
      .where(eq(personDivisionMemberships.divisionId, id))
    return { row: r, members: members.map((m) => m.personId) }
  })
  await ctx.db(async (tx) => {
    await tx.delete(personDivisions).where(eq(personDivisions.id, id))
    if (before.members.length > 0) {
      await refreshDivisionCache(tx, ctx.tenantId, before.members)
    }
  })
  await recordAudit(ctx, {
    entityType: 'person_division',
    entityId: id,
    action: 'delete',
    summary: `Deleted division${before.row ? ` "${before.row.name}"` : ''}`,
    before: before.row as unknown as Record<string, unknown>,
  })
  revalidatePath('/people/divisions')
  redirect('/people/divisions')
}

export async function setDivisionMembership(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const divisionId = String(formData.get('divisionId') ?? '')
  if (!divisionId) return
  const rawIds = formData.getAll('personIds').map((v) => String(v))
  const personIds = Array.from(new Set(rawIds.filter((s) => s.length > 0)))

  const affected = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ personId: personDivisionMemberships.personId })
      .from(personDivisionMemberships)
      .where(eq(personDivisionMemberships.divisionId, divisionId))
    const existingIds = existing.map((r) => r.personId)
    const toRemove = existingIds.filter((id) => !personIds.includes(id))
    const toAdd = personIds.filter((id) => !existingIds.includes(id))
    if (toRemove.length > 0) {
      await tx
        .delete(personDivisionMemberships)
        .where(
          and(
            eq(personDivisionMemberships.divisionId, divisionId),
            inArray(personDivisionMemberships.personId, toRemove),
          ),
        )
    }
    if (toAdd.length > 0) {
      await tx
        .insert(personDivisionMemberships)
        .values(
          toAdd.map((personId) => ({
            tenantId: ctx.tenantId,
            divisionId,
            personId,
          })),
        )
        .onConflictDoNothing()
    }
    const all = Array.from(new Set([...existingIds, ...personIds]))
    if (all.length > 0) {
      await refreshDivisionCache(tx, ctx.tenantId, all)
    }
    return { added: toAdd.length, removed: toRemove.length, total: personIds.length }
  })
  await recordAudit(ctx, {
    entityType: 'person_division',
    entityId: divisionId,
    action: 'update',
    summary: `Updated membership (+${affected.added}/-${affected.removed}; now ${affected.total})`,
    after: { memberPersonIds: personIds },
  })
  revalidatePath(`/people/divisions/${divisionId}`)
}

export async function togglePersonInDivision(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const divisionId = String(formData.get('divisionId') ?? '')
  const personId = String(formData.get('personId') ?? '')
  if (!divisionId || !personId) return
  const present = await ctx.db(async (tx) => {
    const [m] = await tx
      .select()
      .from(personDivisionMemberships)
      .where(
        and(
          eq(personDivisionMemberships.divisionId, divisionId),
          eq(personDivisionMemberships.personId, personId),
        ),
      )
      .limit(1)
    return Boolean(m)
  })
  await ctx.db(async (tx) => {
    if (present) {
      await tx
        .delete(personDivisionMemberships)
        .where(
          and(
            eq(personDivisionMemberships.divisionId, divisionId),
            eq(personDivisionMemberships.personId, personId),
          ),
        )
    } else {
      await tx
        .insert(personDivisionMemberships)
        .values({ tenantId: ctx.tenantId, divisionId, personId })
        .onConflictDoNothing()
    }
    await refreshDivisionCache(tx, ctx.tenantId, [personId])
  })
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: personId,
    action: 'update',
    summary: present ? 'Removed from division' : 'Added to division',
    metadata: { divisionId },
  })
  revalidatePath(`/people/${personId}`)
  revalidatePath(`/people/divisions/${divisionId}`)
}

async function refreshDivisionCache(tx: any, tenantId: string, personIds: string[]): Promise<void> {
  if (personIds.length === 0) return
  await tx.execute(sql`
    UPDATE people
    SET division_ids = COALESCE((
      SELECT jsonb_agg(division_id ORDER BY division_id)
      FROM person_division_memberships
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb)
    WHERE id IN (${sql.join(
      personIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND tenant_id = ${tenantId}
  `)
}
