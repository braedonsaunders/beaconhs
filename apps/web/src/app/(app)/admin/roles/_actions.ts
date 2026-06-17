'use server'

// Server actions behind /admin/roles — create / edit / duplicate / delete roles
// and the permission set each role grants. Gated on `admin.roles.manage`.
//
// Built-in roles (worker, foreman, safety_manager, tenant_admin) can have their
// name / description / permissions edited but their `key` is locked and they
// can't be deleted (other code + seeds reference the key). Custom roles can be
// deleted only when no member still holds them.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { count, eq } from 'drizzle-orm'
import { PERMISSION_CATALOGUE, roleAssignments, roles } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const PERMISSIONS = new Set<string>(PERMISSION_CATALOGUE as unknown as string[])

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

function readPermissions(formData: FormData): string[] {
  return formData
    .getAll('permissions')
    .map((p) => String(p))
    .filter((p) => PERMISSIONS.has(p))
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'role'
  )
}

/** A tenant-unique role key derived from `name`, avoiding existing keys. */
async function uniqueKey(ctx: Ctx, name: string): Promise<string> {
  const base = slugify(name)
  return ctx.db(async (tx) => {
    const existing = await tx.select({ key: roles.key }).from(roles)
    const taken = new Set(existing.map((r) => r.key))
    if (!taken.has(base)) return base
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}_${i}`
      if (!taken.has(candidate)) return candidate
    }
    return `${base}_${crypto.randomUUID().slice(0, 8)}`
  })
}

export async function createRole(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const permissions = readPermissions(formData)
  if (!name) {
    redirect(`/admin/roles/new?error=${encodeURIComponent('Give the role a name.')}`)
  }
  const key = await uniqueKey(ctx, name)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(roles)
      .values({ tenantId: ctx.tenantId, key, name, description, isBuiltIn: false, permissions })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'role',
      entityId: row.id,
      action: 'create',
      summary: `Created role "${name}"`,
      after: { key, name, description, permissions },
    })
  }
  revalidatePath('/admin/roles')
  if (row) redirect(`/admin/roles/${row.id}`)
}

export async function updateRole(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const permissions = readPermissions(formData)
  if (!name) {
    redirect(`/admin/roles/${id}?error=${encodeURIComponent('Give the role a name.')}`)
  }
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    return r ?? null
  })
  if (!before) return
  await ctx.db((tx) =>
    tx.update(roles).set({ name, description, permissions }).where(eq(roles.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'role',
    entityId: id,
    action: 'update',
    summary: `Updated role "${name}"`,
    before: before as unknown as Record<string, unknown>,
    after: { name, description, permissions },
  })
  revalidatePath(`/admin/roles/${id}`)
  revalidatePath('/admin/roles')
  revalidatePath('/admin/users')
}

export async function duplicateRole(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const source = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    return r ?? null
  })
  if (!source) return
  const name = `${source.name} (copy)`
  const key = await uniqueKey(ctx, name)
  const [row] = await ctx.db((tx) =>
    tx
      .insert(roles)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description: source.description,
        isBuiltIn: false,
        permissions: source.permissions,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'role',
      entityId: row.id,
      action: 'create',
      summary: `Duplicated role "${source.name}"`,
      after: { key, name, permissions: source.permissions },
    })
  }
  revalidatePath('/admin/roles')
  if (row) redirect(`/admin/roles/${row.id}`)
}

export async function deleteRole(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const info = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    if (!r) return null
    const assignmentRows = await tx
      .select({ n: count() })
      .from(roleAssignments)
      .where(eq(roleAssignments.roleId, id))
    return { role: r, assignments: Number(assignmentRows[0]?.n ?? 0) }
  })
  if (!info) return
  if (info.role.isBuiltIn) {
    redirect(`/admin/roles/${id}?error=${encodeURIComponent("Built-in roles can't be deleted.")}`)
  }
  if (info.assignments > 0) {
    redirect(
      `/admin/roles/${id}?error=${encodeURIComponent(
        `Still assigned to ${info.assignments} member${info.assignments === 1 ? '' : 's'} — remove those first.`,
      )}`,
    )
  }
  await ctx.db((tx) => tx.delete(roles).where(eq(roles.id, id)))
  await recordAudit(ctx, {
    entityType: 'role',
    entityId: id,
    action: 'delete',
    summary: `Deleted role "${info.role.name}"`,
    before: info.role as unknown as Record<string, unknown>,
  })
  revalidatePath('/admin/roles')
  redirect('/admin/roles')
}
