'use server'

// Self-service account actions for the signed-in user: edit profile (name, time
// zone, language), change password, or request a set/reset-password email. All
// are blocked while impersonating — they must never mutate the target's identity
// (and Better-Auth's session/profile semantics get muddy) under the admin's hand.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { and, eq } from 'drizzle-orm'
import { getAuth, withAuthEmailContext } from '@beaconhs/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { people, tenantUsers, users } from '@beaconhs/db/schema'
import { parseAppLocale } from '@beaconhs/i18n'
import { assertNotImpersonating } from '@beaconhs/tenant'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { signatureReuseMode } from '@/lib/saved-signature'
import { getSessionUser, requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'

type Result = { ok?: boolean; error?: string }

async function reqHeaders(): Promise<Headers> {
  return (await headers()) as unknown as Headers
}

export async function updateProfile(_prev: Result | null, formData: FormData): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  const t = await getTranslations('Account')

  const name = String(formData.get('name') ?? '').trim()
  const timezone = String(formData.get('timezone') ?? '').trim()
  const rawLocale = String(formData.get('locale') ?? '')
  const localeOverride = rawLocale ? parseAppLocale(rawLocale) : null
  if (!name) return { error: t('nameRequired') }
  if (
    rawLocale &&
    (!localeOverride || !ctx.enabledLocales.includes(localeOverride) || !ctx.membership)
  ) {
    return { error: t('invalidLanguage') }
  }

  // A typo'd time zone silently breaks every server-rendered local-time display
  // (this is exactly the greeting bug), so reject anything Intl can't format.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return { error: t('invalidTimeZone') }
  }

  // `users` is a global identity table — write it on the super pool, matching
  // how /platform/users and getRequestContext read/write it.
  const before = await withSuperAdmin(db, async (tx) => {
    const [existing] = await tx
      .select({ name: users.name, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)
    if (!existing) return null
    let previousLocaleOverride: string | null = null
    if (ctx.membership) {
      const [membership] = await tx
        .select({ localeOverride: tenantUsers.localeOverride })
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.id, ctx.membership.id),
            eq(tenantUsers.tenantId, ctx.tenantId),
            eq(tenantUsers.userId, ctx.userId),
          ),
        )
        .limit(1)
      if (!membership) return null
      previousLocaleOverride = membership.localeOverride
    }
    await tx
      .update(users)
      .set({ name, timezone, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId))
    if (ctx.membership) {
      await tx
        .update(tenantUsers)
        .set({ localeOverride, updatedAt: new Date() })
        .where(eq(tenantUsers.id, ctx.membership.id))
    }
    return { ...existing, localeOverride: previousLocaleOverride }
  })
  if (!before) return { error: t('accountNotFound') }

  // Sync Better-Auth's session copy of the name so the header + account menu
  // reflect it immediately (its 5-min cookie cache would otherwise lag).
  try {
    await getAuth().api.updateUser({ body: { name }, headers: await reqHeaders() })
  } catch {
    // The DB row is the source of truth; a Better-Auth sync hiccup isn't fatal.
  }

  await recordAudit(ctx, {
    entityType: 'user',
    entityId: ctx.userId,
    action: 'update',
    summary: 'Updated own account profile',
    before,
    after: { name, timezone, localeOverride },
  })

  revalidatePath('/', 'layout')
  revalidatePath('/account')
  return { ok: true }
}

export async function changePassword(_prev: Result | null, formData: FormData): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')

  const currentPassword = String(formData.get('currentPassword') ?? '')
  const newPassword = String(formData.get('newPassword') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  const revokeOtherSessions = formData.get('revokeOther') === 'on'
  if (newPassword.length < 8) return { error: 'New password must be at least 8 characters.' }
  if (newPassword !== confirm) return { error: 'New passwords do not match.' }
  if (newPassword === currentPassword)
    return { error: 'Choose a password different from the current one.' }

  try {
    await getAuth().api.changePassword({
      body: { newPassword, currentPassword, revokeOtherSessions },
      headers: await reqHeaders(),
    })
  } catch {
    return { error: 'Your current password is incorrect.' }
  }
  await recordAudit(ctx, {
    entityType: 'user',
    entityId: ctx.userId,
    action: 'update',
    summary: 'Changed own account password',
    metadata: { revokedOtherSessions: revokeOtherSessions },
  })
  return { ok: true }
}

/**
 * Save the signed-in user's own signature, drawn on the account page's signature
 * pad. The signature lives on the linked person record (people.signature_attachment_id)
 * and record signatures remain immutable when the saved profile image changes.
 * Uses the same verified storage/transaction saga as record sign-offs.
 */
export async function saveMySignature(dataUrl: string): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  if (!ctx.personId) {
    return { error: 'Your login is not linked to a person record yet.' }
  }
  try {
    await withStoredSignatureAttachment(ctx, dataUrl, async (tx, attachmentId) => {
      if (!attachmentId) throw new Error('Draw your signature before saving.')
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, ctx.personId!), eq(people.tenantId, ctx.tenantId)))
        .limit(1)
        .for('update')
      if (!person) throw new Error('Your employee record could not be found.')
      await tx
        .update(people)
        .set({ signatureAttachmentId: attachmentId })
        .where(eq(people.id, person.id))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: person.id,
        action: 'update',
        summary: 'Updated signature (self-service)',
        before: { signatureAttachmentId: person.signatureAttachmentId },
        after: { signatureAttachmentId: attachmentId },
      })
    })
  } catch {
    return { error: 'Could not save your signature. Draw it again and try saving.' }
  }
  revalidatePath('/account')
  return { ok: true }
}

/** Clear the signed-in user's own signature. */
export async function clearMySignature(): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  if (!ctx.personId) return { error: 'Your login is not linked to a person record yet.' }
  try {
    await ctx.db(async (tx) => {
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, ctx.personId!), eq(people.tenantId, ctx.tenantId)))
        .limit(1)
        .for('update')
      if (!person) throw new Error('Your employee record could not be found.')
      await tx
        .update(people)
        .set({
          signatureAttachmentId: null,
          metadata: { ...person.metadata, signatureReuseMode: 'off' },
        })
        .where(eq(people.id, person.id))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: person.id,
        action: 'update',
        summary: 'Cleared signature (self-service)',
        before: { signatureAttachmentId: person.signatureAttachmentId },
        after: { signatureAttachmentId: null, signatureReuseMode: 'off' },
      })
    })
  } catch {
    return { error: 'Could not clear your signature. Try again.' }
  }
  revalidatePath('/account')
  return { ok: true }
}

/**
 * Email the signed-in user a reset link — used both to SET a first password
 * (magic-link-only accounts) and to recover when they've forgotten the current
 * one. Reuses Better-Auth's reset flow + the existing /reset-password page.
 */
export async function sendPasswordResetEmail(): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  const sessionUser = await getSessionUser()
  if (!sessionUser?.email) return { error: 'No email is on file for your account.' }
  try {
    const requestHeaders = await reqHeaders()
    await withAuthEmailContext({ tenantId: ctx.tenantId, userId: ctx.userId }, () =>
      getAuth().api.requestPasswordReset({
        body: { email: sessionUser.email, redirectTo: '/reset-password' },
        headers: requestHeaders,
      }),
    )
  } catch {
    // Swallow — never surface mail/lookup failures.
  }
  return { ok: true }
}

/** Personal consent, isolated from managers editing employee settings. */
export async function saveMySignatureReuseMode(value: string): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  if (!ctx.personId) return { error: 'Your login is not linked to a person record yet.' }
  if (!['off', 'manual', 'automatic'].includes(value))
    return { error: 'Choose a saved signature setting.' }
  try {
    return await ctx.db(async (tx) => {
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, ctx.personId!), eq(people.tenantId, ctx.tenantId)))
        .limit(1)
        .for('update')
      if (!person) return { error: 'Your employee record could not be found.' }
      if (value !== 'off' && !person.signatureAttachmentId)
        return { error: 'Save your signature before enabling reuse.' }
      await tx
        .update(people)
        .set({ metadata: { ...person.metadata, signatureReuseMode: value } })
        .where(eq(people.id, person.id))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: person.id,
        action: 'update',
        summary: 'Changed own saved signature reuse',
        before: { signatureReuseMode: signatureReuseMode(person.metadata.signatureReuseMode) },
        after: { signatureReuseMode: value },
      })
      revalidatePath('/account')
      return { ok: true }
    })
  } catch {
    return { error: 'Could not save signature settings.' }
  }
}
