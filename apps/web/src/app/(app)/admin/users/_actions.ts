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
  account,
  PERMISSION_CATALOGUE,
  roleAssignments,
  roles,
  sessions,
  tenantUsers,
  userPermissionOverrides,
  users,
} from '@beaconhs/db/schema'
import { assertCan, ForbiddenError } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { IMPERSONATION_TTL_MS } from '@/lib/impersonation'
import { parseRoleScope } from './_scope-data'

const PERMISSIONS = new Set<string>(PERMISSION_CATALOGUE as unknown as string[])

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

// --- helpers -------------------------------------------------------------

function detailPath(membershipId: string): string {
  return `/admin/users/${membershipId}`
}

function backToDetail(membershipId: string, error: string): never {
  redirect(`${detailPath(membershipId)}?error=${encodeURIComponent(error)}`)
}

/** Redirect back to a specific tab, optionally carrying an error or success notice. */
function backToTab(
  membershipId: string,
  tab: string,
  msg: { error?: string; notice?: string } = {},
): never {
  const q = new URLSearchParams({ tab })
  if (msg.error) q.set('error', msg.error)
  if (msg.notice) q.set('notice', msg.notice)
  redirect(`${detailPath(membershipId)}?${q.toString()}`)
}

/** True when the actor may act on this account — blocks editing a super-admin
 *  unless the actor is one too. (Caller has already passed `admin.users.manage`.) */
function canActOn(ctx: Ctx, acct: { isSuperAdmin: boolean }): boolean {
  return ctx.isSuperAdmin || !acct.isSuperAdmin
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
          scope: scopeRaw ? parseRoleScope(scopeRaw) : { type: 'self' },
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
  if (!canActOn(ctx, member.account)) {
    backToDetail(membershipId, 'Only a super-admin can change a super-admin account.')
  }
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
  const scope = parseRoleScope(String(formData.get('scope') ?? ''))
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

// --- account: name + email ----------------------------------------------

export async function updateAccountName(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!membershipId || !name) return
  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToDetail(membershipId, 'Only a super-admin can change a super-admin account.')
  }
  await ctx.db((tx) =>
    tx.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, member.account.id)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: 'Updated account name',
    after: { name },
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}

export async function updateMemberEmail(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  if (!membershipId) return
  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToTab(membershipId, 'security', {
      error: 'Only a super-admin can change a super-admin account.',
    })
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    backToTab(membershipId, 'security', { error: 'Enter a valid email address.' })
  }
  if (email === member.account.email) {
    backToTab(membershipId, 'security', { notice: 'Email unchanged.' })
  }
  // Email is globally unique across accounts — block collisions.
  const taken = await ctx.db(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    return Boolean(u && u.id !== member.account.id)
  })
  if (taken) {
    backToTab(membershipId, 'security', {
      error: 'That email is already in use by another account.',
    })
  }
  // The new address hasn't been confirmed, so it reverts to unverified.
  await ctx.db((tx) =>
    tx
      .update(users)
      .set({ email, emailVerified: false, updatedAt: new Date() })
      .where(eq(users.id, member.account.id)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: `Changed email to ${email}`,
    before: { email: member.account.email },
    after: { email },
  })
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
  backToTab(membershipId, 'security', { notice: 'Email updated.' })
}

export async function setEmailVerified(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const value = String(formData.get('value') ?? '') === 'on'
  if (!membershipId) return
  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToTab(membershipId, 'security', {
      error: 'Only a super-admin can change a super-admin account.',
    })
  }
  await ctx.db((tx) =>
    tx.update(users).set({ emailVerified: value }).where(eq(users.id, member.account.id)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: value ? 'Marked email verified' : 'Marked email unverified',
  })
  revalidatePath(detailPath(membershipId))
  backToTab(membershipId, 'security', {
    notice: value ? 'Email marked as verified.' : 'Email marked as unverified.',
  })
}

// --- account: password + sessions ---------------------------------------

export async function setMemberPassword(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  const signOut = String(formData.get('revokeSessions') ?? '') === 'on'
  if (!membershipId) return

  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToTab(membershipId, 'security', {
      error: 'Only a super-admin can change a super-admin account.',
    })
  }
  if (password.length < 8) {
    backToTab(membershipId, 'security', { error: 'Password must be at least 8 characters.' })
  }
  if (password !== confirm) {
    backToTab(membershipId, 'security', { error: 'Passwords do not match.' })
  }

  // Hash with Better-Auth's own hasher so the credential verifies on sign-in.
  const authCtx = await auth.$context
  const hashed = await authCtx.password.hash(password)

  await ctx.db(async (tx) => {
    const [cred] = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, member.account.id), eq(account.providerId, 'credential')))
      .limit(1)
    if (cred) {
      await tx
        .update(account)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(account.id, cred.id))
    } else {
      // Invited / magic-link users have no credential account yet — create one.
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        userId: member.account.id,
        accountId: member.account.id,
        providerId: 'credential',
        password: hashed,
      })
    }
    if (signOut) await tx.delete(sessions).where(eq(sessions.userId, member.account.id))
  })

  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: signOut ? 'Set password and signed out all sessions' : 'Set password',
  })
  revalidatePath(detailPath(membershipId))
  backToTab(membershipId, 'security', {
    notice: signOut
      ? 'Password updated. All active sessions were signed out.'
      : 'Password updated. Share it with the member over a secure channel.',
  })
}

export async function sendPasswordReset(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!membershipId) return
  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToTab(membershipId, 'security', {
      error: 'Only a super-admin can change a super-admin account.',
    })
  }
  try {
    await auth.api.requestPasswordReset({
      body: { email: member.account.email, redirectTo: '/reset-password' },
      headers: (await headers()) as unknown as Headers,
    })
  } catch {
    backToTab(membershipId, 'security', {
      error: "Couldn't send the reset email — check the mail configuration.",
    })
  }
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: `Sent password reset link to ${member.account.email}`,
  })
  revalidatePath(detailPath(membershipId))
  backToTab(membershipId, 'security', { notice: `Reset link sent to ${member.account.email}.` })
}

export async function revokeMemberSessions(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!membershipId) return
  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToTab(membershipId, 'security', {
      error: 'Only a super-admin can change a super-admin account.',
    })
  }
  const deleted = await ctx.db(async (tx) => {
    const rows = await tx
      .delete(sessions)
      .where(eq(sessions.userId, member.account.id))
      .returning({ id: sessions.id })
    return rows.length
  })
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'update',
    summary: `Signed out all sessions (${deleted})`,
  })
  revalidatePath(detailPath(membershipId))
  backToTab(membershipId, 'security', {
    notice:
      deleted > 0
        ? `Signed out ${deleted} session${deleted === 1 ? '' : 's'}.`
        : 'No active sessions to sign out.',
  })
}

// --- impersonation ("view as") ------------------------------------------

/**
 * Begin impersonating a member: stamp a short-lived pointer onto the actor's
 * OWN session row, then redirect. getRequestContext() reads that pointer and
 * resolves every subsequent request as the target user (their tenant, their
 * real permissions) until it expires or `stopImpersonation` clears it. The real
 * Better-Auth session is never swapped, so exiting is always safe.
 *
 * Scope: requires `admin.users.impersonate` IN the tenant the member belongs to
 * (super-admins pass anywhere; tenant admins only within their tenant — the
 * member is always in `ctx.tenantId` because this runs from their detail page).
 * Super-admin accounts cannot be impersonated.
 */
export async function startImpersonation(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.impersonate')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!membershipId) return
  if (ctx.impersonation) {
    backToDetail(membershipId, 'Stop the current impersonation before starting another.')
  }
  const reason = String(formData.get('reason') ?? '').trim() || null

  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (member.membership.userId === ctx.userId) {
    backToDetail(membershipId, "You can't impersonate yourself.")
  }
  if (member.account.isSuperAdmin) {
    backToDetail(membershipId, "Super-admin accounts can't be impersonated.")
  }
  if (member.membership.status !== 'active') {
    backToDetail(membershipId, 'Only active members can be impersonated.')
  }

  // The pointer is keyed by the actor's current session token (the cookie is
  // never swapped, so this stays the admin's session for the whole overlay).
  const authSession = await auth.api.getSession({
    headers: (await headers()) as unknown as Headers,
  })
  const token = authSession?.session?.token
  if (!token) {
    backToDetail(membershipId, 'Could not resolve your session. Sign in again and retry.')
  }

  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS)
  await ctx.db((tx) =>
    tx
      .update(sessions)
      .set({
        impersonatingUserId: member.account.id,
        impersonationTenantId: ctx.tenantId,
        impersonationStartedAt: new Date(),
        impersonationExpiresAt: expiresAt,
        impersonationReason: reason,
      })
      .where(eq(sessions.token, token!)),
  )

  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'impersonate',
    summary: `Started impersonating ${member.account.email}`,
    metadata: { targetUserId: member.account.id, expiresAt: expiresAt.toISOString(), reason },
  })

  // Bust the shared (app) layout cache so the shell re-renders as the target:
  // the rose banner appears and the sidebar reflects their permissions. Without
  // this the redirect reuses the cached layout segment (only the page subtree
  // remounts) and the banner/nav stay stale until a manual refresh. Mirrors
  // stopImpersonation, which revalidates the layout the same way.
  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
