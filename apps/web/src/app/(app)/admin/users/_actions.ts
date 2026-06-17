'use server'

// Server actions behind /admin/users — membership lifecycle (invite, status,
// remove), role assignment + per-assignment data scope, per-user permission
// overrides, and the global super-admin flag. Every mutating action gates on
// `admin.users.manage` (super-admin toggle additionally requires the actor to
// be a super-admin), writes an audit entry, and revalidates the affected pages.
//
// Convention: success paths revalidate and (where a new record is created)
// redirect; expected user errors redirect back with `?error=` so the target
// page can surface an Alert. Guard violations that the UI shouldn't allow throw.

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { auth } from '@beaconhs/auth'
import {
  PERMISSION_CATALOGUE,
  roleAssignments,
  roles,
  tenantUsers,
  userPermissionOverrides,
  users,
  type RoleScope,
} from '@beaconhs/db/schema'
import { assertCan, ForbiddenError } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const PERMISSIONS = new Set<string>(PERMISSION_CATALOGUE as unknown as string[])

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

// --- helpers -------------------------------------------------------------

function strArray(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
}

/** Validate + normalise a serialized RoleScope from the ScopePicker. */
function parseScope(raw: string): RoleScope {
  try {
    const v = JSON.parse(raw) as { type?: string } & Record<string, unknown>
    switch (v?.type) {
      case 'tenant':
        return { type: 'tenant' }
      case 'self':
        return { type: 'self' }
      case 'sites':
        return { type: 'sites', siteIds: strArray(v.siteIds) }
      case 'crews':
        return { type: 'crews', crewIds: strArray(v.crewIds) }
      case 'people':
        return { type: 'people', personIds: strArray(v.personIds) }
      case 'team':
        return {
          type: 'team',
          divisionIds: strArray(v.divisionIds),
          groupIds: strArray(v.groupIds),
        }
    }
  } catch {
    // fall through
  }
  return { type: 'self' }
}

function detailPath(membershipId: string): string {
  return `/admin/users/${membershipId}`
}

function backToDetail(membershipId: string, error: string): never {
  redirect(`${detailPath(membershipId)}?error=${encodeURIComponent(error)}`)
}

/** Load a membership + its account, or redirect back with an error. */
async function loadMember(ctx: Ctx, membershipId: string) {
  const row = await ctx.db(async (tx) => {
    const [m] = await tx
      .select({ membership: tenantUsers, account: users })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(eq(tenantUsers.id, membershipId))
      .limit(1)
    return m ?? null
  })
  return row
}

// --- invite --------------------------------------------------------------

export async function inviteUser(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const name = String(formData.get('name') ?? '').trim()
  const roleId = String(formData.get('roleId') ?? '').trim() || null
  const scopeRaw = String(formData.get('scope') ?? '').trim()

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect(`/admin/users/invite?error=${encodeURIComponent('Enter a valid email address.')}`)
  }

  const result = await ctx.db(async (tx) => {
    const [existingUser] = await tx.select().from(users).where(eq(users.email, email)).limit(1)
    let userId = existingUser?.id
    let createdUser = false
    if (!userId) {
      userId = crypto.randomUUID()
      await tx.insert(users).values({
        id: userId,
        email,
        name: name || email.split('@')[0] || email,
        emailVerified: false,
      })
      createdUser = true
    }

    const [existingMember] = await tx
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, ctx.tenantId), eq(tenantUsers.userId, userId)))
      .limit(1)
    if (existingMember) {
      return { membershipId: existingMember.id, already: true as const }
    }

    const [m] = await tx
      .insert(tenantUsers)
      .values({
        tenantId: ctx.tenantId,
        userId,
        displayName: name || null,
        status: 'invited',
        invitedAt: new Date(),
        invitedBy: ctx.userId,
      })
      .returning()

    // Optional initial role — only if the role belongs to this tenant.
    if (roleId && m) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1)
      if (role) {
        await tx.insert(roleAssignments).values({
          tenantId: ctx.tenantId,
          tenantUserId: m.id,
          roleId: role.id,
          scope: scopeRaw ? parseScope(scopeRaw) : { type: 'self' },
        })
      }
    }
    return { membershipId: m!.id, already: false as const, createdUser }
  })

  if (result.already) {
    backToDetail(result.membershipId, 'That person is already a member of this tenant.')
  }

  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: result.membershipId,
    action: 'invite',
    summary: `Invited ${email}`,
  })

  // Best-effort magic-link email. Failure (e.g. no mail server) shouldn't block
  // the invite — the member still exists and the admin can resend.
  try {
    await auth.api.signInMagicLink({
      body: { email, name: name || undefined, callbackURL: '/dashboard' },
      headers: (await headers()) as unknown as Headers,
    })
  } catch {
    // swallow — surfaced as a notice on the detail page below
  }

  revalidatePath('/admin/users')
  redirect(detailPath(result.membershipId))
}

export async function resendInvite(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!membershipId) return
  const member = await loadMember(ctx, membershipId)
  if (!member) return
  try {
    await auth.api.signInMagicLink({
      body: { email: member.account.email, callbackURL: '/dashboard' },
      headers: (await headers()) as unknown as Headers,
    })
  } catch {
    backToDetail(membershipId, "Couldn't send the invite email — check the mail configuration.")
  }
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'invite',
    summary: `Resent invite to ${member.account.email}`,
  })
  revalidatePath(detailPath(membershipId))
}

// --- membership profile + status ----------------------------------------

export async function updateMemberDisplayName(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const displayName = String(formData.get('displayName') ?? '').trim() || null
  if (!membershipId) return
  await ctx.db((tx) =>
    tx.update(tenantUsers).set({ displayName }).where(eq(tenantUsers.id, membershipId)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: 'Updated display name',
    after: { displayName },
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}

export async function setMemberStatus(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!membershipId || (status !== 'active' && status !== 'suspended')) return

  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (member.membership.userId === ctx.userId) {
    backToDetail(membershipId, "You can't change your own status.")
  }
  if (member.account.isSuperAdmin && !ctx.isSuperAdmin) {
    backToDetail(membershipId, 'Only a super-admin can change a super-admin account.')
  }

  const patch: { status: 'active' | 'suspended'; joinedAt?: Date } = { status }
  if (status === 'active' && !member.membership.joinedAt) patch.joinedAt = new Date()

  await ctx.db((tx) => tx.update(tenantUsers).set(patch).where(eq(tenantUsers.id, membershipId)))
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: status === 'suspended' ? 'archive' : 'update',
    summary: status === 'suspended' ? 'Suspended member' : 'Reactivated member',
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}

export async function removeMember(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!membershipId) return

  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (member.membership.userId === ctx.userId) {
    backToDetail(membershipId, "You can't remove your own membership.")
  }
  if (member.account.isSuperAdmin && !ctx.isSuperAdmin) {
    backToDetail(membershipId, 'Only a super-admin can remove a super-admin account.')
  }

  // Cascade removes role assignments + permission overrides (FK onDelete cascade).
  await ctx.db((tx) => tx.delete(tenantUsers).where(eq(tenantUsers.id, membershipId)))
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'delete',
    summary: `Removed ${member.account.email} from tenant`,
  })
  revalidatePath('/admin/users')
  redirect('/admin/users')
}

// --- role assignments ----------------------------------------------------

export async function assignRole(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const roleId = String(formData.get('roleId') ?? '').trim()
  const scope = parseScope(String(formData.get('scope') ?? ''))
  if (!membershipId || !roleId) return

  await ctx.db(async (tx) => {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1)
    if (!role) return
    // One assignment per (member, role): update the scope if it already exists.
    const [existing] = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(eq(roleAssignments.tenantUserId, membershipId), eq(roleAssignments.roleId, roleId)),
      )
      .limit(1)
    if (existing) {
      await tx.update(roleAssignments).set({ scope }).where(eq(roleAssignments.id, existing.id))
    } else {
      await tx.insert(roleAssignments).values({
        tenantId: ctx.tenantId,
        tenantUserId: membershipId,
        roleId,
        scope,
      })
    }
    await recordAudit(ctx, {
      entityType: 'tenant_user',
      entityId: membershipId,
      action: 'update',
      summary: `Assigned role "${role.name}"`,
      metadata: { roleId, scope },
    })
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}

export async function updateAssignmentScope(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const assignmentId = String(formData.get('assignmentId') ?? '')
  const scope = parseScope(String(formData.get('scope') ?? ''))
  if (!assignmentId) return
  await ctx.db((tx) =>
    tx.update(roleAssignments).set({ scope }).where(eq(roleAssignments.id, assignmentId)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: 'Updated role scope',
    metadata: { assignmentId, scope },
  })
  revalidatePath(detailPath(membershipId))
}

export async function removeAssignment(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const assignmentId = String(formData.get('assignmentId') ?? '')
  if (!assignmentId) return
  await ctx.db((tx) => tx.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId)))
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: 'Removed role',
    metadata: { assignmentId },
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}

// --- per-user permission overrides --------------------------------------

export async function setPermissionOverride(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const permission = String(formData.get('permission') ?? '').trim()
  const effect = String(formData.get('effect') ?? '')
  if (!membershipId || !PERMISSIONS.has(permission) || (effect !== 'grant' && effect !== 'deny')) {
    return
  }
  await ctx.db((tx) =>
    tx
      .insert(userPermissionOverrides)
      .values({ tenantId: ctx.tenantId, tenantUserId: membershipId, permission, effect })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.tenantUserId, userPermissionOverrides.permission],
        set: { effect, updatedAt: new Date() },
      }),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: `${effect === 'grant' ? 'Granted' : 'Denied'} permission ${permission}`,
    metadata: { permission, effect },
  })
  revalidatePath(detailPath(membershipId))
}

export async function clearPermissionOverride(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const permission = String(formData.get('permission') ?? '').trim()
  if (!membershipId || !permission) return
  await ctx.db((tx) =>
    tx
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.tenantUserId, membershipId),
          eq(userPermissionOverrides.permission, permission),
        ),
      ),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: `Cleared permission override ${permission}`,
    metadata: { permission },
  })
  revalidatePath(detailPath(membershipId))
}

// --- global super-admin flag --------------------------------------------

export async function setSuperAdmin(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  // Granting platform-wide super-admin is reserved for existing super-admins.
  if (!ctx.isSuperAdmin) throw new ForbiddenError('admin.super-admin')
  const userId = String(formData.get('userId') ?? '')
  const membershipId = String(formData.get('membershipId') ?? '')
  const value = String(formData.get('value') ?? '') === 'on'
  if (!userId) return
  if (userId === ctx.userId && !value) {
    backToDetail(membershipId, "You can't revoke your own super-admin access.")
  }
  await ctx.db((tx) => tx.update(users).set({ isSuperAdmin: value }).where(eq(users.id, userId)))
  await recordAudit(ctx, {
    entityType: 'user',
    entityId: userId,
    action: 'update',
    summary: value ? 'Granted super-admin' : 'Revoked super-admin',
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}
