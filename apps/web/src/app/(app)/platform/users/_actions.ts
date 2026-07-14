'use server'

// Server actions behind /platform/users — the super-admin "global identity"
// surface. Unlike /admin/users (which is keyed by membership and RLS-scoped to
// the active tenant), these act on the global `user` row and write memberships
// ACROSS tenants. Two consequences drive every action here:
//
//   1. Authorization is platform-level: `gate()` requires `isSuperAdmin`. There
//      is no per-tenant permission to lean on because the target tenant may be
//      one the actor isn't a member of.
//   2. Writes run on the BYPASSRLS super pool (withSuperAdmin) like the rest of
//      /platform, because the membership being created/edited belongs to an
//      arbitrary tenant. Audit rows are therefore inserted directly and
//      attributed to the AFFECTED tenant (entityType 'tenant_user'), mirroring
//      the per-tenant invite flow.
//
// Deep role/scope/permission editing intentionally stays in /admin/users —
// `openMembershipInTenant` view-as-bridges there rather than duplicating the
// RBAC editor at platform level. Expected user errors redirect back with
// `?error=`; the page surfaces them as an Alert.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import { auditLog, roles, tenantUsers, tenants, users } from '@beaconhs/db/schema'
import { assertNotImpersonating } from '@beaconhs/tenant'
import { materializeUserIdentityAudienceObligations } from '@beaconhs/compliance'
import { nextInviteGenerationDate } from '@beaconhs/auth/invites'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { setActiveTenant } from '@/lib/actions'
import { sendMembershipInviteEmail } from '@/lib/invite-email'
import { upsertRoleAssignments } from '@/lib/role-assignment-upsert'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

// Same locale whitelist the self-service account form enforces.
const LOCALES = new Set(['en', 'fr', 'es'])

/** Platform actions are reserved for super-admins — no tenant permission applies. */
async function gate(): Promise<Ctx> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'platform identity administration')
  if (!ctx.isSuperAdmin) throw new Error('Only platform super-admins can manage global users.')
  return ctx
}

function userPath(userId: string): string {
  return `/platform/users/${userId}`
}

/** Redirect back to a user's identity page, optionally carrying an error/notice. */
function backToUser(userId: string, msg: { error?: string; notice?: string } = {}): never {
  const q = new URLSearchParams()
  if (msg.error) q.set('error', msg.error)
  if (msg.notice) q.set('notice', msg.notice)
  const qs = q.toString()
  redirect(qs ? `${userPath(userId)}?${qs}` : userPath(userId))
}

/** A membership joined to its account + tenant, or null. */
async function loadMembership(tx: Database, membershipId: string, lock = false) {
  let query = tx
    .select({ membership: tenantUsers, account: users, tenant: tenants })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(eq(tenantUsers.id, membershipId))
    .limit(1)
  if (lock) query = query.for('update') as typeof query
  const [row] = await query
  return row ?? null
}

// --- global identity ------------------------------------------------------

export async function updateIdentity(formData: FormData): Promise<void> {
  const ctx = await gate()
  const userId = String(formData.get('userId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const locale = String(formData.get('locale') ?? '').trim()
  const timezone = String(formData.get('timezone') ?? '').trim()
  if (!userId) return
  if (!name) backToUser(userId, { error: 'Name is required.' })
  if (!LOCALES.has(locale)) backToUser(userId, { error: 'Choose a supported language.' })
  // A typo'd time zone silently breaks every server-rendered local-time display
  // for the target user, so reject anything Intl can't format — mirrors the
  // self-service account action.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    backToUser(userId, { error: 'Choose a valid time zone.' })
  }

  const before = await withSuperAdmin(db, async (tx) => {
    const [u] = await tx
      .select({
        email: users.email,
        name: users.name,
        locale: users.locale,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!u) return null
    await tx
      .update(users)
      .set({ name, locale, timezone, updatedAt: new Date() })
      .where(eq(users.id, userId))
    return u
  })
  if (!before) backToUser(userId, { error: 'User not found.' })

  await recordAudit(ctx, {
    entityType: 'platform',
    action: 'update',
    summary: `Updated identity for ${before.email} (platform)`,
    before: { name: before.name, locale: before.locale, timezone: before.timezone },
    after: { name, locale, timezone },
    metadata: { via: 'platform', targetUserId: userId },
  })
  revalidatePath(userPath(userId))
  revalidatePath('/platform/users')
  backToUser(userId, { notice: 'Identity updated.' })
}

export async function setSuperAdmin(formData: FormData): Promise<void> {
  const ctx = await gate()
  const userId = String(formData.get('userId') ?? '')
  const value = String(formData.get('value') ?? '') === 'on'
  if (!userId) return
  // Guard the obvious foot-gun: a super-admin locking themselves out.
  if (userId === ctx.userId && !value) {
    backToUser(userId, { error: "You can't revoke your own super-admin access." })
  }
  const target = await withSuperAdmin(db, async (tx) => {
    const [u] = await tx
      .select({ email: users.email, isSuperAdmin: users.isSuperAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!u) return null
    await tx
      .update(users)
      .set({ isSuperAdmin: value, updatedAt: new Date() })
      .where(eq(users.id, userId))
    return u
  })
  if (!target) backToUser(userId, { error: 'User not found.' })

  // Granting/revoking platform-wide access is the most privileged mutation in
  // the system — it must never be forensically invisible.
  await recordAudit(ctx, {
    entityType: 'platform',
    action: 'update',
    summary: `${value ? 'Granted' : 'Revoked'} super-admin for ${target.email} (platform)`,
    before: { isSuperAdmin: target.isSuperAdmin },
    after: { isSuperAdmin: value },
    metadata: { via: 'platform', targetUserId: userId },
  })
  revalidatePath(userPath(userId))
  revalidatePath('/platform/users')
  backToUser(userId, { notice: value ? 'Granted super-admin.' : 'Revoked super-admin.' })
}

// --- memberships ----------------------------------------------------------

type AddResult =
  | {
      ok: true
      email: string
      tenantName: string
      mode: 'invite' | 'active'
      membershipId: string
      tenantId: string
      userId: string
      invitedAt: Date
      name: string
    }
  | { ok: false; error: string }

export async function addMembership(formData: FormData): Promise<void> {
  const ctx = await gate()
  const userId = String(formData.get('userId') ?? '')
  const tenantId = String(formData.get('tenantId') ?? '')
  const roleId = String(formData.get('roleId') ?? '').trim() || null
  const mode: 'invite' | 'active' =
    String(formData.get('mode') ?? 'invite') === 'active' ? 'active' : 'invite'
  if (!userId) return
  if (!tenantId) backToUser(userId, { error: 'Choose a tenant to add this user to.' })

  const result: AddResult = await withSuperAdmin(db, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!u) return { ok: false, error: 'User not found.' }
    const [t] = await tx
      .select({ id: tenants.id, name: tenants.name, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    if (!t) return { ok: false, error: 'Tenant not found.' }
    if (t.status !== 'active') {
      return { ok: false, error: 'Users cannot be added while that tenant is not active.' }
    }

    const invitedAt = new Date()
    const [m] = await tx
      .insert(tenantUsers)
      .values({
        tenantId,
        userId,
        displayName: null,
        status: mode === 'active' ? 'active' : 'invited',
        invitedAt,
        invitedBy: ctx.userId,
        joinedAt: mode === 'active' ? invitedAt : null,
      })
      .onConflictDoNothing({ target: [tenantUsers.tenantId, tenantUsers.userId] })
      .returning()
    if (!m) {
      return { ok: false, error: `${u.email} is already a member of ${t.name}.` }
    }

    // Optional initial role — only if it actually belongs to the target tenant.
    if (roleId) {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
        .limit(1)
      if (role) {
        await upsertRoleAssignments(tx, [
          {
            tenantId,
            tenantUserId: m.id,
            roleId: role.id,
            scope: { type: 'self' },
          },
        ])
      }
    }

    await materializeUserIdentityAudienceObligations(tx, tenantId, [userId])

    await tx.insert(auditLog).values({
      tenantId,
      actorUserId: ctx.userId,
      entityType: 'tenant_user',
      entityId: m.id,
      action: mode === 'active' ? 'create' : 'invite',
      summary:
        mode === 'active'
          ? `Added ${u.email} to ${t.name} (platform)`
          : `Invited ${u.email} to ${t.name} (platform)`,
      metadata: { via: 'platform', mode },
    })
    return {
      ok: true,
      email: u.email,
      tenantName: t.name,
      mode,
      membershipId: m.id,
      tenantId,
      userId,
      invitedAt,
      name: u.name,
    }
  })

  if (!result.ok) backToUser(userId, { error: result.error })

  let inviteDeliveryFailed = false
  if (result.mode === 'invite') {
    try {
      await sendMembershipInviteEmail({
        membershipId: result.membershipId,
        tenantId: result.tenantId,
        tenantName: result.tenantName,
        userId: result.userId,
        email: result.email,
        invitedAt: result.invitedAt,
        name: result.name,
      })
    } catch {
      inviteDeliveryFailed = true
    }
  }

  revalidatePath(userPath(userId))
  revalidatePath('/platform/users')
  if (inviteDeliveryFailed) {
    backToUser(userId, {
      error: `The membership was created, but the invite email for ${result.tenantName} could not be sent. Check mail configuration, then resend it.`,
    })
  }
  backToUser(userId, {
    notice:
      result.mode === 'active'
        ? `Added to ${result.tenantName}.`
        : `Invite sent for ${result.tenantName}.`,
  })
}

type MembershipResult = { ok: true; notice: string } | { ok: false; error: string }

export async function setMembershipStatus(formData: FormData): Promise<void> {
  const ctx = await gate()
  const userId = String(formData.get('userId') ?? '')
  const membershipId = String(formData.get('membershipId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!userId || !membershipId) return
  if (status !== 'active' && status !== 'suspended') return

  const result: MembershipResult = await withSuperAdmin(db, async (tx) => {
    const row = await loadMembership(tx, membershipId, true)
    if (!row) return { ok: false, error: 'Membership not found.' }
    if (row.account.id !== userId) {
      return { ok: false, error: 'Membership does not belong to this user.' }
    }
    if (row.membership.userId === ctx.userId) {
      return { ok: false, error: "Manage your own membership from the tenant's Users page." }
    }
    if (row.membership.status === 'invited') {
      return {
        ok: false,
        error: 'Pending invitations activate only when the member accepts the email link.',
      }
    }
    if (
      (status === 'suspended' && row.membership.status !== 'active') ||
      (status === 'active' && row.membership.status !== 'suspended')
    ) {
      return { ok: false, error: 'That membership status has already changed.' }
    }
    const [updated] = await tx
      .update(tenantUsers)
      .set({ status })
      .where(and(eq(tenantUsers.id, membershipId), eq(tenantUsers.status, row.membership.status)))
      .returning({ id: tenantUsers.id })
    if (!updated) return { ok: false, error: 'That membership status has already changed.' }
    await materializeUserIdentityAudienceObligations(tx, row.tenant.id, [row.account.id])
    await tx.insert(auditLog).values({
      tenantId: row.tenant.id,
      actorUserId: ctx.userId,
      entityType: 'tenant_user',
      entityId: membershipId,
      action: status === 'suspended' ? 'archive' : 'update',
      summary: `${status === 'suspended' ? 'Suspended' : 'Activated'} ${row.account.email} in ${row.tenant.name} (platform)`,
      metadata: { via: 'platform', status },
    })
    return {
      ok: true,
      notice: `${status === 'suspended' ? 'Suspended' : 'Activated'} membership in ${row.tenant.name}.`,
    }
  })

  if (!result.ok) backToUser(userId, { error: result.error })
  revalidatePath(userPath(userId))
  revalidatePath('/platform/users')
  backToUser(userId, { notice: result.notice })
}

export async function removeMembership(formData: FormData): Promise<void> {
  const ctx = await gate()
  const userId = String(formData.get('userId') ?? '')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!userId || !membershipId) return

  const result: MembershipResult = await withSuperAdmin(db, async (tx) => {
    const row = await loadMembership(tx, membershipId, true)
    if (!row) return { ok: false, error: 'Membership not found.' }
    if (row.account.id !== userId) {
      return { ok: false, error: 'Membership does not belong to this user.' }
    }
    if (row.membership.userId === ctx.userId) {
      return { ok: false, error: "Manage your own membership from the tenant's Users page." }
    }
    // Cascade removes role assignments + permission overrides (FK onDelete cascade).
    await tx.delete(tenantUsers).where(eq(tenantUsers.id, membershipId))
    await materializeUserIdentityAudienceObligations(tx, row.tenant.id, [row.account.id])
    await tx.insert(auditLog).values({
      tenantId: row.tenant.id,
      actorUserId: ctx.userId,
      entityType: 'tenant_user',
      entityId: membershipId,
      action: 'delete',
      summary: `Removed ${row.account.email} from ${row.tenant.name} (platform)`,
      metadata: { via: 'platform' },
    })
    return { ok: true, notice: `Removed from ${row.tenant.name}.` }
  })

  if (!result.ok) backToUser(userId, { error: result.error })
  revalidatePath(userPath(userId))
  revalidatePath('/platform/users')
  backToUser(userId, { notice: result.notice })
}

export async function resendInvite(formData: FormData): Promise<void> {
  const ctx = await gate()
  const userId = String(formData.get('userId') ?? '')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!userId || !membershipId) return

  const invite = await withSuperAdmin(db, async (tx) => {
    const row = await loadMembership(tx, membershipId, true)
    if (!row) return null
    if (row.account.id !== userId) return { error: 'Membership does not belong to this user.' }
    if (row.membership.status !== 'invited')
      return { error: 'Only pending invitations can be resent.' }
    if (row.tenant.status !== 'active') {
      return { error: 'Invitations are disabled while that tenant is not active.' }
    }
    const invitedAt = nextInviteGenerationDate(row.membership.invitedAt)
    const [rotated] = await tx
      .update(tenantUsers)
      .set({ invitedAt, updatedAt: new Date() })
      .where(and(eq(tenantUsers.id, membershipId), eq(tenantUsers.status, 'invited')))
      .returning({ id: tenantUsers.id })
    if (!rotated) return { error: 'The invitation changed. Refresh and try again.' }
    return { row, invitedAt }
  })
  if (!invite) backToUser(userId, { error: 'Membership not found.' })
  if ('error' in invite) backToUser(userId, { error: invite.error })

  try {
    await sendMembershipInviteEmail({
      membershipId,
      tenantId: invite.row.tenant.id,
      tenantName: invite.row.tenant.name,
      userId: invite.row.account.id,
      email: invite.row.account.email,
      invitedAt: invite.invitedAt,
      name: invite.row.account.name,
    })
  } catch {
    backToUser(userId, { error: "Couldn't send the invite — check the mail configuration." })
  }
  await withSuperAdmin(db, (tx) =>
    tx.insert(auditLog).values({
      tenantId: invite.row.tenant.id,
      actorUserId: ctx.userId,
      entityType: 'tenant_user',
      entityId: membershipId,
      action: 'invite',
      summary: `Resent invite to ${invite.row.account.email} for ${invite.row.tenant.name} (platform)`,
      metadata: { via: 'platform' },
    }),
  )
  revalidatePath(userPath(userId))
  backToUser(userId, { notice: `Invite resent to ${invite.row.account.email}.` })
}

// --- bridge to the per-tenant RBAC editor ---------------------------------

/**
 * "Open in tenant": switch the super-admin's active tenant to the membership's
 * tenant, then deep-link to that membership's full editor under /admin/users —
 * where role/scope/permission editing already lives. We deliberately don't
 * re-implement that surface here.
 */
export async function openMembershipInTenant(formData: FormData): Promise<void> {
  await gate()
  const userId = String(formData.get('userId') ?? '')
  const tenantId = String(formData.get('tenantId') ?? '')
  const membershipId = String(formData.get('membershipId') ?? '')
  if (!userId || !tenantId || !membershipId) return
  const valid = await withSuperAdmin(db, async (tx) => {
    const [membership] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.id, membershipId),
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.userId, userId),
        ),
      )
      .limit(1)
    return Boolean(membership)
  })
  if (!valid) backToUser(userId, { error: 'Membership no longer matches this tenant.' })
  const switched = await setActiveTenant(tenantId)
  if (!switched.ok) backToUser(userId, { error: 'Restore this tenant before opening it.' })
  redirect(`/admin/users/${membershipId}`)
}
