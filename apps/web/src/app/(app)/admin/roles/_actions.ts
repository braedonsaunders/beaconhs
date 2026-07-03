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
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  insightCards,
  PERMISSION_CATALOGUE,
  roleAssignments,
  roleDashboardLayouts,
  roles,
  tenantUsers,
  user,
  type DashboardLayoutData,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseRoleScope } from '../users/_scope-data'
import {
  DashboardLayoutInputSchema,
  filterPersistableDashboardWidgets,
  UUID_RE,
} from '../../dashboard/_layout-input'
import { QuickActionsSchema } from '../../dashboard/_quick-actions-input'
import { WIDGETS } from '../../dashboard/_widget-registry'
import {
  canPermissionSetPublishInsights,
  canPermissionSetSeeWidget,
  canPermissionSetViewInsights,
} from '../../dashboard/_widget-access'
import { DEFAULT_LAYOUTS } from '../../dashboard/_role-defaults'
import { inferRoleTier } from '../../dashboard/_role-tier'
import { z } from 'zod'

const PERMISSIONS = new Set<string>(PERMISSION_CATALOGUE as unknown as string[])
const ALL_PERMISSIONS = [...PERMISSION_CATALOGUE] as string[]
const BULK_ROLE_OPERATIONS = new Set(['add', 'replace', 'remove'])
const MAX_BULK_ROLE_MEMBERS = 250

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

const RoleDashboardQuickActionsInputSchema = z.object({
  roleId: z.string().uuid(),
  quickActions: QuickActionsSchema,
})

function readPermissions(formData: FormData): string[] {
  return formData
    .getAll('permissions')
    .map((p) => String(p))
    .filter((p) => PERMISSIONS.has(p))
}

function rolesPath(msg: { error?: string; notice?: string } = {}): string {
  const q = new URLSearchParams()
  if (msg.error) q.set('error', msg.error)
  if (msg.notice) q.set('notice', msg.notice)
  const qs = q.toString()
  return qs ? `/admin/roles?${qs}` : '/admin/roles'
}

function uniqueFormStrings(formData: FormData, key: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(key)
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ]
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
      .where(
        and(
          eq(roleDashboardLayouts.tenantId, ctx.tenantId),
          eq(roleDashboardLayouts.roleId, roleId),
        ),
      )
      .orderBy(desc(roleDashboardLayouts.updatedAt))
      .limit(1)
    return row?.layout ?? null
  })
}

async function sanitiseSavedDashboardForRole(ctx: Ctx, role: RoleForDashboard): Promise<void> {
  const existing = await loadRoleDashboardLayout(ctx, role.id)
  if (!existing) return
  const sanitised = await sanitiseRoleDashboardLayout(ctx, role, existing.widgets)
  if (existing.quickActions) sanitised.quickActions = existing.quickActions
  if (sanitised.widgets.length === 0) {
    await ctx.db((tx) =>
      tx
        .delete(roleDashboardLayouts)
        .where(
          and(
            eq(roleDashboardLayouts.tenantId, ctx.tenantId),
            eq(roleDashboardLayouts.roleId, role.id),
          ),
        ),
    )
    return
  }
  await ctx.db((tx) =>
    tx
      .update(roleDashboardLayouts)
      .set({ layout: sanitised, updatedAt: new Date() })
      .where(
        and(
          eq(roleDashboardLayouts.tenantId, ctx.tenantId),
          eq(roleDashboardLayouts.roleId, role.id),
        ),
      ),
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

export async function bulkUpdateRoleAssignments(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  assertCan(ctx, 'admin.users.manage')

  const operation = String(formData.get('operation') ?? '')
  const roleId = String(formData.get('roleId') ?? '').trim()
  const membershipIds = uniqueFormStrings(formData, 'membershipIds')
  const scope = parseRoleScope(String(formData.get('scope') ?? ''))

  if (!BULK_ROLE_OPERATIONS.has(operation)) {
    redirect(rolesPath({ error: 'Choose a bulk role operation.' }))
  }
  if (!roleId) {
    redirect(rolesPath({ error: 'Choose a role to apply.' }))
  }
  if (membershipIds.length === 0) {
    redirect(rolesPath({ error: 'Select at least one member.' }))
  }
  if (membershipIds.length > MAX_BULK_ROLE_MEMBERS) {
    redirect(
      rolesPath({
        error: `Select ${MAX_BULK_ROLE_MEMBERS} or fewer members at a time.`,
      }),
    )
  }

  const result = await ctx.db(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)
    if (!role) return { changed: 0, skipped: 0, changedIds: [] as string[], roleName: null }

    const selectedMembers = await tx
      .select({
        id: tenantUsers.id,
        userId: tenantUsers.userId,
        email: user.email,
        displayName: tenantUsers.displayName,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(inArray(tenantUsers.id, membershipIds))

    const eligibleMembers = selectedMembers.filter(
      (member) => member.userId !== ctx.userId && (ctx.isSuperAdmin || !member.isSuperAdmin),
    )
    const skipped = membershipIds.length - eligibleMembers.length
    const eligibleIds = eligibleMembers.map((member) => member.id)
    if (eligibleIds.length === 0) {
      return { changed: 0, skipped, changedIds: [] as string[], roleName: role.name }
    }

    if (operation === 'replace') {
      await tx.delete(roleAssignments).where(inArray(roleAssignments.tenantUserId, eligibleIds))
      await tx.insert(roleAssignments).values(
        eligibleIds.map((membershipId) => ({
          tenantId: ctx.tenantId,
          tenantUserId: membershipId,
          roleId: role.id,
          scope,
        })),
      )
      return {
        changed: eligibleIds.length,
        skipped,
        changedIds: eligibleIds,
        roleName: role.name,
      }
    }

    if (operation === 'remove') {
      const deleted = await tx
        .delete(roleAssignments)
        .where(
          and(
            inArray(roleAssignments.tenantUserId, eligibleIds),
            eq(roleAssignments.roleId, role.id),
          ),
        )
        .returning({ membershipId: roleAssignments.tenantUserId })
      const changedIds = [...new Set(deleted.map((row) => row.membershipId))]
      return {
        changed: changedIds.length,
        skipped,
        changedIds,
        roleName: role.name,
      }
    }

    const existing = await tx
      .select({ id: roleAssignments.id, tenantUserId: roleAssignments.tenantUserId })
      .from(roleAssignments)
      .where(
        and(
          inArray(roleAssignments.tenantUserId, eligibleIds),
          eq(roleAssignments.roleId, role.id),
        ),
      )
    const existingIds = existing.map((row) => row.id)
    if (existingIds.length > 0) {
      await tx
        .update(roleAssignments)
        .set({ scope })
        .where(inArray(roleAssignments.id, existingIds))
    }

    const existingMembershipIds = new Set(existing.map((row) => row.tenantUserId))
    const insertIds = eligibleIds.filter((membershipId) => !existingMembershipIds.has(membershipId))
    if (insertIds.length > 0) {
      await tx.insert(roleAssignments).values(
        insertIds.map((membershipId) => ({
          tenantId: ctx.tenantId,
          tenantUserId: membershipId,
          roleId: role.id,
          scope,
        })),
      )
    }

    return {
      changed: eligibleIds.length,
      skipped,
      changedIds: eligibleIds,
      roleName: role.name,
    }
  })

  if (!result.roleName) {
    redirect(rolesPath({ error: 'Role not found.' }))
  }

  const verb =
    operation === 'replace'
      ? 'Replaced roles with'
      : operation === 'remove'
        ? 'Removed'
        : 'Assigned'
  for (const membershipId of result.changedIds) {
    await recordAudit(ctx, {
      entityType: 'tenant_user',
      entityId: membershipId,
      action: 'update',
      summary: `${verb} role "${result.roleName}" via bulk role manager`,
      metadata: { roleId, operation, scope },
    })
    revalidatePath(`/admin/users/${membershipId}`)
  }

  revalidatePath('/admin/roles')
  revalidatePath('/admin/users')
  revalidatePath('/dashboard')

  const changedLabel = `${result.changed} member${result.changed === 1 ? '' : 's'}`
  const skippedLabel =
    result.skipped > 0
      ? ` ${result.skipped} selected member${result.skipped === 1 ? '' : 's'} skipped.`
      : ''
  redirect(
    rolesPath({
      notice: `${verb} "${result.roleName}" for ${changedLabel}.${skippedLabel}`,
    }),
  )
}

// ---------------------------------------------------------------------------
// Members tab on the role detail page — add / re-scope / remove the members
// who hold THIS role. These mirror the per-user assignRole/removeAssignment
// actions but are gated for the role editor and revalidate the role page, so
// the membership edits stay in place instead of bouncing to the user list.
// Modifying who holds a role is a membership change, so both gates apply
// (matching the bulk role manager). Self and protected super-admins are never
// touched, mirroring the eligibility rules used everywhere else.
// ---------------------------------------------------------------------------

function revalidateRoleMembership(roleId: string, membershipIds: string[]): void {
  for (const membershipId of membershipIds) revalidatePath(`/admin/users/${membershipId}`)
  revalidatePath(`/admin/roles/${roleId}`)
  revalidatePath('/admin/roles')
  revalidatePath('/admin/users')
  revalidatePath('/dashboard')
}

export async function addRoleMembers(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  assertCan(ctx, 'admin.users.manage')
  const roleId = String(formData.get('roleId') ?? '').trim()
  const membershipIds = uniqueFormStrings(formData, 'membershipIds')
  const scope = parseRoleScope(String(formData.get('scope') ?? ''))
  if (!roleId || membershipIds.length === 0) return

  const result = await ctx.db(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)
    if (!role) return null

    const selected = await tx
      .select({
        id: tenantUsers.id,
        userId: tenantUsers.userId,
        isSuperAdmin: user.isSuperAdmin,
      })
      .from(tenantUsers)
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(inArray(tenantUsers.id, membershipIds), eq(tenantUsers.status, 'active')))

    const eligibleIds = selected
      .filter((m) => m.userId !== ctx.userId && (ctx.isSuperAdmin || !m.isSuperAdmin))
      .map((m) => m.id)
    if (eligibleIds.length === 0) return { roleName: role.name, changedIds: [] as string[] }

    const existing = await tx
      .select({ tenantUserId: roleAssignments.tenantUserId })
      .from(roleAssignments)
      .where(
        and(
          inArray(roleAssignments.tenantUserId, eligibleIds),
          eq(roleAssignments.roleId, role.id),
        ),
      )
    const existingIds = new Set(existing.map((row) => row.tenantUserId))

    // Re-selecting a member who already holds the role just updates its scope.
    if (existingIds.size > 0) {
      await tx
        .update(roleAssignments)
        .set({ scope })
        .where(
          and(
            inArray(roleAssignments.tenantUserId, [...existingIds]),
            eq(roleAssignments.roleId, role.id),
          ),
        )
    }
    const insertIds = eligibleIds.filter((id) => !existingIds.has(id))
    if (insertIds.length > 0) {
      await tx.insert(roleAssignments).values(
        insertIds.map((membershipId) => ({
          tenantId: ctx.tenantId,
          tenantUserId: membershipId,
          roleId: role.id,
          scope,
        })),
      )
    }
    return { roleName: role.name, changedIds: eligibleIds }
  })

  if (!result || result.changedIds.length === 0) return
  for (const membershipId of result.changedIds) {
    await recordAudit(ctx, {
      entityType: 'tenant_user',
      entityId: membershipId,
      action: 'update',
      summary: `Added to role "${result.roleName}"`,
      metadata: { roleId, scope },
    })
  }
  revalidateRoleMembership(roleId, result.changedIds)
}

export async function updateRoleMemberScope(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  assertCan(ctx, 'admin.users.manage')
  const roleId = String(formData.get('roleId') ?? '').trim()
  const assignmentId = String(formData.get('assignmentId') ?? '').trim()
  const scope = parseRoleScope(String(formData.get('scope') ?? ''))
  if (!roleId || !assignmentId) return

  const result = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        membershipId: tenantUsers.id,
        userId: tenantUsers.userId,
        isSuperAdmin: user.isSuperAdmin,
        roleName: roles.name,
      })
      .from(roleAssignments)
      .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.roleId, roleId)))
      .limit(1)
    if (!row) return null
    if (row.userId === ctx.userId || (!ctx.isSuperAdmin && row.isSuperAdmin)) return null
    await tx.update(roleAssignments).set({ scope }).where(eq(roleAssignments.id, assignmentId))
    return { roleName: row.roleName, membershipId: row.membershipId }
  })

  if (!result) return
  // Attribute the audit to the assignment's verified member — never the
  // client-posted membershipId, which a tampered form could point elsewhere.
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: result.membershipId,
    action: 'update',
    summary: `Updated scope for role "${result.roleName}"`,
    metadata: { roleId, assignmentId, scope },
  })
  revalidateRoleMembership(roleId, [result.membershipId])
}

export async function removeRoleMember(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  assertCan(ctx, 'admin.users.manage')
  const roleId = String(formData.get('roleId') ?? '').trim()
  const assignmentId = String(formData.get('assignmentId') ?? '').trim()
  if (!roleId || !assignmentId) return

  const result = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        membershipId: tenantUsers.id,
        userId: tenantUsers.userId,
        isSuperAdmin: user.isSuperAdmin,
        roleName: roles.name,
      })
      .from(roleAssignments)
      .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
      .innerJoin(user, eq(user.id, tenantUsers.userId))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.roleId, roleId)))
      .limit(1)
    if (!row) return null
    if (row.userId === ctx.userId || (!ctx.isSuperAdmin && row.isSuperAdmin)) return null
    await tx.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId))
    return { roleName: row.roleName, membershipId: row.membershipId }
  })

  if (!result) return
  // Attribute the audit to the assignment's verified member — never the
  // client-posted membershipId, which a tampered form could point elsewhere.
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: result.membershipId,
    action: 'update',
    summary: `Removed from role "${result.roleName}"`,
    metadata: { roleId, assignmentId },
  })
  revalidateRoleMembership(roleId, [result.membershipId])
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
      .where(
        and(eq(roleDashboardLayouts.tenantId, ctx.tenantId), eq(roleDashboardLayouts.roleId, id)),
      )
      .orderBy(desc(roleDashboardLayouts.updatedAt))
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
  if (before?.quickActions) layout.quickActions = before.quickActions

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

export async function saveRoleDashboardQuickActions(input: unknown) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.roles.manage')
  const parsed = RoleDashboardQuickActionsInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Invalid quick actions',
    }
  }

  const role = await loadRoleForDashboardAction(ctx, parsed.data.roleId)
  if (!role) return { ok: false as const, error: 'Role not found.' }

  const before = await loadRoleDashboardLayout(ctx, role.id)
  const baseLayout = before ?? DEFAULT_LAYOUTS[inferRoleTier(role)] ?? DEFAULT_LAYOUTS.worker
  const layout: DashboardLayoutData = {
    widgets: baseLayout.widgets,
    quickActions: parsed.data.quickActions,
  }

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
    summary: `Updated default quick actions for role "${role.name}"`,
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
    tx
      .delete(roleDashboardLayouts)
      .where(
        and(
          eq(roleDashboardLayouts.tenantId, ctx.tenantId),
          eq(roleDashboardLayouts.roleId, role.id),
        ),
      ),
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
