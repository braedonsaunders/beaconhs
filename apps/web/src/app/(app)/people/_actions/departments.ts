'use server'

// Server actions for the /people/departments admin — flat CRUD over the single
// `departments` taxonomy (one department per person, via people.departmentId).
// Create + edit run through saveDepartment (returns {ok|error} for the drawer);
// delete is a row form action that refuses while the department is still in use.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, count, eq, isNull } from 'drizzle-orm'
import { departments, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

const BASE = '/people/departments'

export async function saveDepartment(input: {
  id?: string
  name: string
  code: string | null
  description: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  const code = input.code?.trim() || null
  const description = input.description?.trim() || null

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(departments)
        .where(eq(departments.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Department not found.' }
    try {
      await ctx.db((tx) =>
        tx
          .update(departments)
          .set({ name, code, description })
          .where(eq(departments.id, input.id!)),
      )
    } catch {
      return { ok: false, error: 'A department with that name already exists.' }
    }
    await recordAudit(ctx, {
      entityType: 'department',
      entityId: input.id,
      action: 'update',
      summary: `Updated department "${name}"`,
      before: { name: before.name, code: before.code, description: before.description },
      after: { name, code, description },
    })
    revalidatePath(BASE)
    return { ok: true }
  }

  let createdId: string | null = null
  try {
    const [row] = await ctx.db((tx) =>
      tx
        .insert(departments)
        .values({ tenantId: ctx.tenantId, name, code, description })
        .returning(),
    )
    createdId = row?.id ?? null
  } catch {
    return { ok: false, error: 'A department with that name already exists.' }
  }
  if (createdId) {
    await recordAudit(ctx, {
      entityType: 'department',
      entityId: createdId,
      action: 'create',
      summary: `Added department "${name}"`,
      after: { name, code, description },
    })
  }
  revalidatePath(BASE)
  return { ok: true }
}

export async function deleteDepartment(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const { usage, row } = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(departments).where(eq(departments.id, id)).limit(1)
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.departmentId, id), isNull(people.deletedAt)))
    return { usage: Number(u?.c ?? 0), row: r ?? null }
  })
  if (!row) return
  if (usage > 0) {
    revalidatePath(BASE)
    redirect(
      `${BASE}?error=${encodeURIComponent(
        `"${row.name}" is assigned to ${usage} ${usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
      )}`,
    )
  }
  await ctx.db((tx) => tx.delete(departments).where(eq(departments.id, id)))
  await recordAudit(ctx, {
    entityType: 'department',
    entityId: id,
    action: 'delete',
    summary: `Deleted department "${row.name}"`,
    before: { name: row.name, code: row.code, description: row.description },
  })
  revalidatePath(BASE)
  redirect(BASE)
}
