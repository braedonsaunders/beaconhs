'use server'

// Server actions for the /people/departments admin — flat CRUD over the single
// `departments` taxonomy (one department per person, via people.departmentId).
// Create + edit run through saveDepartment (returns {ok|error} for the drawer);
// delete is a row form action that refuses while the department is still in use.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, count, eq } from 'drizzle-orm'
import { normalizeCatalogDisplayName } from '@beaconhs/db'
import { departments, people } from '@beaconhs/db/schema'
import { countComplianceAudienceTargetUses } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'

const BASE = '/people/departments'

/** True when the error is the tenant-scoped unique-name violation. */
function isDuplicateNameError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /departments_tenant_(?:normalized_)?name_ux/.test(msg)
}

export async function saveDepartment(input: {
  id?: string
  name: string
  code: string | null
  description: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  const name = normalizeCatalogDisplayName(input.name)
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
    } catch (err) {
      if (isDuplicateNameError(err)) {
        return { ok: false, error: 'A department with that name already exists.' }
      }
      throw err
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
  } catch (err) {
    if (isDuplicateNameError(err)) {
      return { ok: false, error: 'A department with that name already exists.' }
    }
    throw err
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
  const result = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, id)))
      .limit(1)
      .for('update')
    if (!row) return { state: 'missing' as const }
    const [u] = await tx
      .select({ c: count() })
      .from(people)
      .where(and(eq(people.tenantId, ctx.tenantId), eq(people.departmentId, id)))
    const usage = Number(u?.c ?? 0)
    if (usage > 0) return { state: 'assigned' as const, row, usage }

    const requirements = await countComplianceAudienceTargetUses(tx, ctx.tenantId, {
      kind: 'department',
      entityKey: id,
    })
    if (requirements > 0) return { state: 'required' as const, row, requirements }

    const [deleted] = await tx
      .delete(departments)
      .where(and(eq(departments.tenantId, ctx.tenantId), eq(departments.id, id)))
      .returning({ id: departments.id })
    if (!deleted) return { state: 'missing' as const }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'department',
      entityId: id,
      action: 'delete',
      summary: `Deleted department "${row.name}"`,
      before: { name: row.name, code: row.code, description: row.description },
    })
    return { state: 'deleted' as const }
  })
  if (result.state === 'missing') return
  if (result.state === 'assigned') {
    revalidatePath(BASE)
    redirect(
      `${BASE}?error=${encodeURIComponent(
        `"${result.row.name}" is assigned to ${result.usage} ${result.usage === 1 ? 'person' : 'people'}. Reassign them before deleting.`,
      )}`,
    )
  }
  if (result.state === 'required') {
    revalidatePath(BASE)
    redirect(
      `${BASE}?error=${encodeURIComponent(
        `"${result.row.name}" is used by ${result.requirements} compliance ${result.requirements === 1 ? 'requirement' : 'requirements'}. Change those audiences before deleting.`,
      )}`,
    )
  }
  revalidatePath(BASE)
  redirect(BASE)
}
