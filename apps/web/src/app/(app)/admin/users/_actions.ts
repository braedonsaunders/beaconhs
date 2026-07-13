'use server'

// Server actions behind /admin/users — membership lifecycle (invite, status,
// remove), role assignment + per-assignment data scope, per-user permission
// overrides, and impersonation. Every mutating action gates on the relevant
// permission, writes an audit entry, and revalidates the affected pages.
//
// Convention: success paths revalidate and (where a new record is created)
// redirect; expected user errors redirect back with `?error=` so the target
// page can surface an Alert. Guard violations that the UI shouldn't allow throw.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getAuth } from '@beaconhs/auth'
import { nextInviteGenerationDate } from '@beaconhs/auth/invites'
import {
  auditLog,
  people,
  PERMISSION_CATALOGUE,
  roleAssignments,
  roles,
  sessions,
  tenants,
  tenantUsers,
  userPermissionOverrides,
  users,
} from '@beaconhs/db/schema'
import { assertCan, assertNotImpersonating } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { IMPERSONATION_TTL_MS } from '@/lib/impersonation'
import { sendMembershipInviteEmail } from '@/lib/invite-email'
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

/** Access administration must always run as the real administrator. */
async function requireUserAdmin(action: string): Promise<Ctx> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.users.manage')
  assertNotImpersonating(ctx, action)
  return ctx
}

/** Load a membership + its account, or redirect back with an error. */
async function loadMember(ctx: Ctx, membershipId: string) {
  const row = await ctx.db(async (tx) => {
    const [m] = await tx
      .select({ membership: tenantUsers, account: users, tenantStatus: tenants.status })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .where(eq(tenantUsers.id, membershipId))
      .limit(1)
    return m ?? null
  })
  return row
}

// --- invite --------------------------------------------------------------

export async function inviteUser(formData: FormData): Promise<void> {
  const ctx = await requireUserAdmin('invite members')

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
    const [tenant] = await tx
      .select({ id: tenants.id, name: tenants.name, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    if (!tenant || tenant.status !== 'active') {
      return { error: 'Invitations are disabled while this tenant is not active.' } as const
    }

    const [existingUser] = await tx.select().from(users).where(eq(users.email, email)).limit(1)
    let userId = existingUser?.id
    if (!userId) {
      const candidateId = crypto.randomUUID()
      const [created] = await tx
        .insert(users)
        .values({
          id: candidateId,
          email,
          name: name || email.split('@')[0] || email,
          emailVerified: false,
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id })
      if (created) userId = created.id
      else {
        // A concurrent administrator inserted this global identity after our
        // first read. The unique email remains authoritative; reload it rather
        // than surfacing a unique-violation 500.
        const [concurrent] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
        userId = concurrent?.id
      }
    }
    if (!userId) return { error: 'Could not create or resolve this user identity.' } as const

    const invitedAt = new Date()
    const [m] = await tx
      .insert(tenantUsers)
      .values({
        tenantId: ctx.tenantId,
        userId,
        displayName: name || null,
        status: 'invited',
        invitedAt,
        invitedBy: ctx.userId,
      })
      .onConflictDoNothing({ target: [tenantUsers.tenantId, tenantUsers.userId] })
      .returning()
    if (!m) {
      // The insert waits for a concurrent conflicting transaction, so at READ
      // COMMITTED the winning membership is visible to this reload.
      const [existingMember] = await tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, ctx.tenantId), eq(tenantUsers.userId, userId)))
        .limit(1)
      if (existingMember) {
        return { membershipId: existingMember.id, already: true as const }
      }
      return { error: 'Could not create or resolve this tenant membership.' } as const
    }

    // Optional initial role — only if the role belongs to this tenant.
    if (roleId) {
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

    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      entityType: 'tenant_user',
      entityId: m.id,
      action: 'invite',
      summary: `Invited ${email}`,
    })
    return {
      membershipId: m.id,
      already: false as const,
      userId,
      invitedAt,
      tenantName: tenant.name,
    }
  })

  if ('error' in result && result.error) {
    redirect(`/admin/users/invite?error=${encodeURIComponent(result.error)}`)
  }

  if (result.already) {
    backToDetail(result.membershipId, 'That person is already a member of this tenant.')
  }

  let deliveryError = false
  try {
    await sendMembershipInviteEmail({
      membershipId: result.membershipId,
      tenantId: ctx.tenantId,
      tenantName: result.tenantName,
      userId: result.userId,
      email,
      invitedAt: result.invitedAt,
      name,
    })
  } catch {
    deliveryError = true
  }

  revalidatePath('/admin/users')
  if (deliveryError) {
    backToDetail(
      result.membershipId,
      'The membership was created, but the invite email could not be sent. Check mail configuration, then resend it.',
    )
  }
  redirect(detailPath(result.membershipId))
}

export async function resendInvite(formData: FormData): Promise<void> {
  const ctx = await requireUserAdmin('resend membership invitations')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!membershipId) return
  const invite = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ membership: tenantUsers, account: users, tenant: tenants })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
      .where(eq(tenantUsers.id, membershipId))
      .limit(1)
      .for('update')
    if (!row) return { error: 'Membership not found.' } as const
    if (!canActOn(ctx, row.account)) {
      return { error: 'Only a super-admin can change a super-admin account.' } as const
    }
    if (row.membership.status !== 'invited') {
      return { error: 'Only pending invitations can be resent.' } as const
    }
    if (row.tenant.status !== 'active') {
      return { error: 'Invitations are disabled while this tenant is not active.' } as const
    }

    // Lock + monotonic rotation makes the newest email the only valid invite,
    // even when administrators click resend concurrently in the same ms.
    const invitedAt = nextInviteGenerationDate(row.membership.invitedAt)
    const [rotated] = await tx
      .update(tenantUsers)
      .set({ invitedAt, updatedAt: new Date() })
      .where(and(eq(tenantUsers.id, membershipId), eq(tenantUsers.status, 'invited')))
      .returning({ id: tenantUsers.id })
    if (!rotated) return { error: 'The invitation changed. Refresh and try again.' } as const
    return { row, invitedAt } as const
  })
  if ('error' in invite && invite.error) backToDetail(membershipId, invite.error)

  try {
    await sendMembershipInviteEmail({
      membershipId,
      tenantId: ctx.tenantId,
      tenantName: invite.row.tenant.name,
      userId: invite.row.account.id,
      email: invite.row.account.email,
      invitedAt: invite.invitedAt,
      name: invite.row.membership.displayName ?? invite.row.account.name,
    })
  } catch {
    backToDetail(membershipId, "Couldn't send the invite email — check the mail configuration.")
  }
  await recordAudit(ctx, {
    entityType: 'tenant_user',
    entityId: membershipId,
    action: 'invite',
    summary: `Resent invite to ${invite.row.account.email}`,
  })
  revalidatePath(detailPath(membershipId))
}

// --- membership profile + status ----------------------------------------

export async function updateMemberDisplayName(formData: FormData): Promise<void> {
  const ctx = await requireUserAdmin('update member display names')
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
  const ctx = await requireUserAdmin('change membership status')
  const membershipId = String(formData.get('membershipId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!membershipId || (status !== 'active' && status !== 'suspended')) return

  const result = await ctx.db(async (tx) => {
    const [member] = await tx
      .select({ membership: tenantUsers, account: users })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .where(eq(tenantUsers.id, membershipId))
      .limit(1)
      .for('update')
    if (!member) return { error: 'Membership not found.' } as const
    if (member.membership.userId === ctx.userId) {
      return { error: "You can't change your own status." } as const
    }
    if (member.account.isSuperAdmin && !ctx.isSuperAdmin) {
      return { error: 'Only a super-admin can change a super-admin account.' } as const
    }
    if (member.membership.status === 'invited') {
      return {
        error: 'Pending invitations activate only when the member accepts the email link.',
      } as const
    }
    if (
      (status === 'suspended' && member.membership.status !== 'active') ||
      (status === 'active' && member.membership.status !== 'suspended')
    ) {
      return {
        error: 'That membership status has already changed. Refresh and try again.',
      } as const
    }

    const changedAt = new Date()
    const [updated] = await tx
      .update(tenantUsers)
      .set({ status, updatedAt: changedAt })
      .where(
        and(eq(tenantUsers.id, membershipId), eq(tenantUsers.status, member.membership.status)),
      )
      .returning({ id: tenantUsers.id })
    if (!updated) {
      return {
        error: 'That membership status changed before it could be saved. Refresh and try again.',
      } as const
    }
    await tx.insert(auditLog).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      entityType: 'tenant_user',
      entityId: membershipId,
      action: status === 'suspended' ? 'archive' : 'update',
      summary: status === 'suspended' ? 'Suspended member' : 'Reactivated member',
      before: { status: member.membership.status },
      after: { status },
    })
    return { ok: true } as const
  })
  if ('error' in result && result.error) backToDetail(membershipId, result.error)
  revalidatePath(detailPath(membershipId))
  revalidatePath('/admin/users')
}

export async function removeMember(formData: FormData): Promise<void> {
  const ctx = await requireUserAdmin('remove tenant memberships')
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
  const ctx = await requireUserAdmin('assign member roles')
  const membershipId = String(formData.get('membershipId') ?? '')
  const roleId = String(formData.get('roleId') ?? '').trim()
  const scope = parseRoleScope(String(formData.get('scope') ?? ''))
  if (!membershipId || !roleId) return

  await ctx.db(async (tx) => {
    const [membership] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, membershipId))
      .limit(1)
    if (!membership) return
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
  const ctx = await requireUserAdmin('remove member roles')
  const membershipId = String(formData.get('membershipId') ?? '')
  const assignmentId = String(formData.get('assignmentId') ?? '')
  if (!assignmentId) return
  await ctx.db((tx) =>
    tx
      .delete(roleAssignments)
      .where(
        and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.tenantUserId, membershipId)),
      ),
  )
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
  const ctx = await requireUserAdmin('change member permission overrides')
  const membershipId = String(formData.get('membershipId') ?? '')
  const permission = String(formData.get('permission') ?? '').trim()
  const effect = String(formData.get('effect') ?? '')
  if (!membershipId || !PERMISSIONS.has(permission) || (effect !== 'grant' && effect !== 'deny')) {
    return
  }
  const applied = await ctx.db(async (tx) => {
    const [membership] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(eq(tenantUsers.id, membershipId))
      .limit(1)
    if (!membership) return false
    await tx
      .insert(userPermissionOverrides)
      .values({ tenantId: ctx.tenantId, tenantUserId: membershipId, permission, effect })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.tenantUserId, userPermissionOverrides.permission],
        set: { effect, updatedAt: new Date() },
      })
    return true
  })
  if (!applied) return
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
  const ctx = await requireUserAdmin('clear member permission overrides')
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

// --- linked person (employee) record ------------------------------------

type LinkablePerson = {
  id: string
  name: string
  hint: string | null
}

/**
 * Data for the "Linked person record" control: the person currently linked to
 * this account in the active tenant (if any) plus the active, unlinked people
 * that can be chosen. People already linked to a DIFFERENT account are excluded
 * so the picker can never silently steal another user's link.
 */
export async function loadPersonLinkData(
  ctx: Ctx,
  userId: string,
): Promise<{ linked: LinkablePerson | null; options: LinkablePerson[] }> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        jobTitle: people.jobTitle,
        userId: people.userId,
      })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const toItem = (r: (typeof rows)[number]): LinkablePerson => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`.trim(),
      hint: r.employeeNo ?? r.jobTitle ?? null,
    })
    const linked = rows.find((r) => r.userId === userId)
    return {
      linked: linked ? toItem(linked) : null,
      // Unlinked people + (defensively) the one already ours.
      options: rows.filter((r) => !r.userId || r.userId === userId).map(toItem),
    }
  })
}

/**
 * Link this account to an employee (`people`) record in the active tenant, or
 * clear the link (empty personId). Enforces the 1:1 rule the
 * `people_tenant_user_ux` index guarantees: the account's previous person is
 * unlinked in the same transaction before the new one is set, and a person
 * already tied to another account is rejected.
 */
export async function setUserPersonLink(formData: FormData): Promise<void> {
  const ctx = await requireUserAdmin('link person records')
  const membershipId = String(formData.get('membershipId') ?? '')
  const personId = String(formData.get('personId') ?? '').trim() || null
  if (!membershipId) return

  const member = await loadMember(ctx, membershipId)
  if (!member) return
  if (!canActOn(ctx, member.account)) {
    backToDetail(membershipId, 'Only a super-admin can change a super-admin account.')
  }
  const userId = member.account.id

  const result = await ctx.db(
    async (
      tx,
    ): Promise<{
      error?: string
      changed: boolean
      linkedId: string | null
      linkedName: string | null
      unlinkedId: string | null
    }> => {
      const [current] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.userId, userId), isNull(people.deletedAt)))
        .limit(1)

      if (!personId) {
        if (!current) return { changed: false, linkedId: null, linkedName: null, unlinkedId: null }
        await tx.update(people).set({ userId: null }).where(eq(people.id, current.id))
        return { changed: true, linkedId: null, linkedName: null, unlinkedId: current.id }
      }

      if (current?.id === personId) {
        return { changed: false, linkedId: personId, linkedName: null, unlinkedId: null }
      }

      const [target] = await tx
        .select({
          id: people.id,
          userId: people.userId,
          status: people.status,
          deletedAt: people.deletedAt,
          firstName: people.firstName,
          lastName: people.lastName,
        })
        .from(people)
        .where(eq(people.id, personId))
        .limit(1)
      if (!target || target.deletedAt) {
        return {
          error: 'That person record no longer exists.',
          changed: false,
          linkedId: null,
          linkedName: null,
          unlinkedId: null,
        }
      }
      if (target.status !== 'active') {
        return {
          error: 'Only active people can be linked to an account.',
          changed: false,
          linkedId: null,
          linkedName: null,
          unlinkedId: null,
        }
      }
      if (target.userId && target.userId !== userId) {
        return {
          error: 'That person is already linked to another account.',
          changed: false,
          linkedId: null,
          linkedName: null,
          unlinkedId: null,
        }
      }

      // Clear the account's previous person first so the partial unique index on
      // (tenant_id, user_id) is never momentarily violated, then link the chosen one.
      if (current && current.id !== personId) {
        await tx.update(people).set({ userId: null }).where(eq(people.id, current.id))
      }
      await tx.update(people).set({ userId }).where(eq(people.id, personId))
      return {
        changed: true,
        linkedId: personId,
        linkedName: `${target.firstName} ${target.lastName}`.trim(),
        unlinkedId: current?.id ?? null,
      }
    },
  )

  if (result.error) backToDetail(membershipId, result.error)

  if (result.changed) {
    await recordAudit(ctx, {
      entityType: 'tenant_user',
      entityId: membershipId,
      action: 'update',
      summary: result.linkedId
        ? `Linked person record${result.linkedName ? ` ${result.linkedName}` : ''}`
        : 'Unlinked person record',
      metadata: { userId, personId: result.linkedId, unlinkedPersonId: result.unlinkedId },
    })
    revalidatePath('/admin/users')
    revalidatePath('/people')
    if (result.linkedId) revalidatePath(`/people/${result.linkedId}`)
    if (result.unlinkedId) revalidatePath(`/people/${result.unlinkedId}`)
  }
  backToTab(membershipId, 'overview', {
    notice: result.changed
      ? result.linkedId
        ? 'Linked the person record.'
        : 'Unlinked the person record.'
      : undefined,
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
  if (member.tenantStatus !== 'active') {
    backToDetail(membershipId, 'Restore this workspace before impersonating a member.')
  }

  // The pointer is keyed by the actor's current session token (the cookie is
  // never swapped, so this stays the admin's session for the whole overlay).
  const authSession = await getAuth().api.getSession({
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
