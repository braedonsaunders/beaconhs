'use server'

// Server actions behind /admin/roles — create / edit / duplicate / delete roles
// and the permission set each role grants. Gated on `admin.roles.manage`.
//
// Built-in roles can have their name / description edited, but their `key` is
// locked and they can't be deleted (other code + seeds reference the key).
// Tenant Admin's permission set is also locked to the full catalogue so a tenant
// cannot lose its root administrative role. Custom roles can be deleted only
// when no member still holds them.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import {
  insightCards,
  PERMISSION_CATALOGUE,
  roleAssignments,
  roleDashboardLayouts,
  roles,
  type DashboardLayoutData,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  DashboardLayoutInputSchema,
  filterPersistableDashboardWidgets,
  UUID_RE,
} from '../../dashboard/_layout-input'
import { WIDGETS } from '../../dashboard/_widget-registry'
import {
  canPermissionSetPublishInsights,
  canPermissionSetSeeWidget,
  canPermissionSetViewInsights,
} from '../../dashboard/_widget-access'
import { z } from 'zod'

const PERMISSIONS = new Set<string>(PERMISSION_CATALOGUE as unknown as string[])
const ALL_PERMISSIONS = [...PERMISSION_CATALOGUE] as string[]

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

type RoleForDashboard = {
  id: string
  key: string
  name: string
  permissions: string[]
}

const RoleDashboardLayoutInputSchema = DashboardLayoutInputSchema.extend({
  roleId: z.string().uuid(),
})

const RoleDashboardResetInputSchema = z.object({
  roleId: z.string().uuid(),
})

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

function allowedWidgetIdsForRole(role: Pick<RoleForDashboard, 'permissions'>): Set<string> {
  return new Set(
    Object.keys(WIDGETS).filter((id) => canPermissionSetSeeWidget(role.permissions, id)),
  )
}

async function allowedInsightCardIdsForRole(
  ctx: Ctx,
  role: Pick<RoleForDashboard, 'key' | 'permissions'>,
  cardIds: string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(cardIds)]
  if (uniqueIds.length === 0 || !canPermissionSetViewInsights(role.permissions)) {
    return new Set()
  }

  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: insightCards.id,
        allowedRoles: insightCards.allowedRoles,
      })
      .from(insightCards)
      .where(
        and(
          inArray(insightCards.id, uniqueIds),
          eq(insightCards.status, 'published'),
          isNull(insightCards.deletedAt),
        ),
      ),
  )

  const canSeeAllPublished = canPermissionSetPublishInsights(role.permissions)
  return new Set(
    rows
      .filter(
        (card) =>
          canSeeAllPublished ||
          !card.allowedRoles ||
          card.allowedRoles.length === 0 ||
          card.allowedRoles.includes(role.key),
      )
      .map((card) => card.id),
  )
}

async function sanitiseRoleDashboardLayout(
  ctx: Ctx,
  role: RoleForDashboard,
  widgets: DashboardLayoutData['widgets'],
): Promise<DashboardLayoutData> {
  const insightCardIds = widgets.filter((w) => UUID_RE.test(w.id)).map((w) => w.id)
  const allowedInsightCardIds = await allowedInsightCardIdsForRole(ctx, role, insightCardIds)
  return {
    widgets: filterPersistableDashboardWidgets(widgets, {
      allowedWidgetIds: allowedWidgetIdsForRole(role),
      allowedInsightCardIds,
    }),
  }
}

async function loadRoleForDashboardAction(
  ctx: Ctx,
  roleId: string,
): Promise<RoleForDashboard | null> {
  return ctx.db(async (tx) => {
    const [role] = await tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        permissions: roles.permissions,
      })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)
    return role ?? null
  })
}

async function loadRoleDashboardLayout(
  ctx: Ctx,
  roleId: string,
): Promise<DashboardLayoutData | null> {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ layout: roleDashboardLayouts.layout })
      .from(roleDashboardLayouts)
      .where(eq(roleDashboardLayouts.roleId, roleId))
      .limit(1)
    return row?.layout ?? null
  })
}

async function sanitiseSavedDashboardForRole(ctx: Ctx, role: RoleForDashboard): Promise<void> {
  const existing = await loadRoleDashboardLayout(ctx, role.id)
  if (!existing) return
  const sanitised = await sanitiseRoleDashboardLayout(ctx, role, existing.widgets)
  if (sanitised.widgets.length === 0) {
    await ctx.db((tx) =>
      tx.delete(roleDashboardLayouts).where(eq(roleDashboardLayouts.roleId, role.id)),
    )
    return
  }
  await ctx.db((tx) =>
    tx
      .update(roleDashboardLayouts)
      .set({ layout: sanitised, updatedAt: new Date() })
      .where(eq(roleDashboardLayouts.roleId, role.id)),
  )
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

export async function updateRoleDetails(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  if (!name) {
    redirect(`/admin/roles/${id}?error=${encodeURIComponent('Give the role a name.')}`)
  }
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    return r ?? null
  })
  if (!before) return
  await ctx.db((tx) => tx.update(roles).set({ name, description }).where(eq(roles.id, id)))
  await recordAudit(ctx, {
    entityType: 'role',
    entityId: id,
    action: 'update',
    summary: `Updated role details for "${name}"`,
    before: { name: before.name, description: before.description },
    after: { name, description },
  })
  revalidatePath(`/admin/roles/${id}`)
  revalidatePath('/admin/roles')
  revalidatePath('/admin/users')
}

export async function updateRolePermissions(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const before = await ctx.db(async (tx) => {
    const [r] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1)
    return r ?? null
  })
  if (!before) return
  const permissions =
    before.isBuiltIn && before.key === 'tenant_admin' ? ALL_PERMISSIONS : readPermissions(formData)

  await ctx.db((tx) => tx.update(roles).set({ permissions }).where(eq(roles.id, id)))
  await sanitiseSavedDashboardForRole(ctx, {
    id,
    key: before.key,
    name: before.name,
    permissions,
  })

  await recordAudit(ctx, {
    entityType: 'role',
    entityId: id,
    action: 'update',
    summary: `Updated permissions for role "${before.name}"`,
    before: { permissions: before.permissions },
    after: { permissions },
  })
  revalidatePath(`/admin/roles/${id}`)
  revalidatePath('/admin/roles')
  revalidatePath('/admin/users')
  revalidatePath('/dashboard')
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
  const [row] = await ctx.db(async (tx) => {
    const [sourceDashboard] = await tx
      .select({ layout: roleDashboardLayouts.layout })
      .from(roleDashboardLayouts)
      .where(eq(roleDashboardLayouts.roleId, id))
      .limit(1)
    const [created] = await tx
      .insert(roles)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description: source.description,
        isBuiltIn: false,
        permissions: source.permissions,
      })
      .returning()
    if (!created) return []
    if (sourceDashboard) {
      await tx.insert(roleDashboardLayouts).values({
        tenantId: ctx.tenantId,
        roleId: created.id,
        layout: sourceDashboard.layout,
      })
    }
    return [created]
  })
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

export async function saveRoleDashboardLayout(input: unknown) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const parsed = RoleDashboardLayoutInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid layout' }
  }

  const role = await loadRoleForDashboardAction(ctx, parsed.data.roleId)
  if (!role) return { ok: false as const, error: 'Role not found.' }

  const layout = await sanitiseRoleDashboardLayout(ctx, role, parsed.data.widgets)
  if (layout.widgets.length === 0) {
    return { ok: false as const, error: 'Add at least one widget before saving.' }
  }

  const before = await loadRoleDashboardLayout(ctx, role.id)

  await ctx.db((tx) =>
    tx
      .insert(roleDashboardLayouts)
      .values({
        tenantId: ctx.tenantId,
        roleId: role.id,
        layout,
      })
      .onConflictDoUpdate({
        target: [roleDashboardLayouts.tenantId, roleDashboardLayouts.roleId],
        set: { layout, updatedAt: new Date() },
      }),
  )

  await recordAudit(ctx, {
    entityType: 'role',
    entityId: role.id,
    action: 'update',
    summary: `Updated default dashboard for role "${role.name}"`,
    before: before ? { dashboardLayout: before } : null,
    after: { dashboardLayout: layout },
  })

  revalidatePath(`/admin/roles/${role.id}`)
  revalidatePath('/admin/roles')
  revalidatePath('/dashboard')
  return { ok: true as const }
}

export async function resetRoleDashboardLayout(input: unknown) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const parsed = RoleDashboardResetInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid role' }
  }

  const role = await loadRoleForDashboardAction(ctx, parsed.data.roleId)
  if (!role) return { ok: false as const, error: 'Role not found.' }

  const before = await loadRoleDashboardLayout(ctx, role.id)
  if (!before) return { ok: true as const }

  await ctx.db((tx) =>
    tx.delete(roleDashboardLayouts).where(eq(roleDashboardLayouts.roleId, role.id)),
  )

  await recordAudit(ctx, {
    entityType: 'role',
    entityId: role.id,
    action: 'update',
    summary: `Reset default dashboard for role "${role.name}"`,
    before: { dashboardLayout: before },
    after: null,
  })

  revalidatePath(`/admin/roles/${role.id}`)
  revalidatePath('/admin/roles')
  revalidatePath('/dashboard')
  return { ok: true as const }
}
