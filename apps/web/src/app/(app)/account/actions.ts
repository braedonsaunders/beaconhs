'use server'

// Self-service account actions for the signed-in user: edit profile (name, time
// zone, language), change password, or request a set/reset-password email. All
// are blocked while impersonating — they must never mutate the target's identity
// (and Better-Auth's session/profile semantics get muddy) under the admin's hand.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { getAuth } from '@beaconhs/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { attachments, people, users } from '@beaconhs/db/schema'
import { assertNotImpersonating } from '@beaconhs/tenant'
import { newAttachmentKey, putObject } from '@beaconhs/storage'
import { getSessionUser, requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

const DATA_URL_RE = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s

type Result = { ok?: boolean; error?: string }

const LOCALES = new Set(['en', 'fr', 'es'])

async function reqHeaders(): Promise<Headers> {
  return (await headers()) as unknown as Headers
}

export async function updateProfile(_prev: Result | null, formData: FormData): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')

  const name = String(formData.get('name') ?? '').trim()
  const timezone = String(formData.get('timezone') ?? '').trim()
  const locale = LOCALES.has(String(formData.get('locale') ?? ''))
    ? String(formData.get('locale'))
    : 'en'
  if (!name) return { error: 'Name is required.' }

  // A typo'd time zone silently breaks every server-rendered local-time display
  // (this is exactly the greeting bug), so reject anything Intl can't format.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return { error: 'Choose a valid time zone.' }
  }

  // `users` is a global identity table — write it on the super pool, matching
  // how /platform/users and getRequestContext read/write it.
  const before = await withSuperAdmin(db, async (tx) => {
    const [existing] = await tx
      .select({ name: users.name, timezone: users.timezone, locale: users.locale })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)
    if (!existing) return null
    await tx
      .update(users)
      .set({ name, timezone, locale, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId))
    return existing
  })
  if (!before) return { error: 'Your account could not be found.' }

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
    after: { name, timezone, locale },
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
 * so every existing render site — form sign-offs, inspections, lift plans, PDFs —
 * keeps working unchanged. Decodes the pad's PNG data-url, stores the bytes in
 * object storage, and points the person at a fresh attachment row.
 */
export async function saveMySignature(dataUrl: string): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  if (!ctx.personId) {
    return { error: 'Your login is not linked to a person record yet.' }
  }
  const match = DATA_URL_RE.exec((dataUrl ?? '').trim())
  if (!match) return { error: 'Could not read the signature. Draw it again.' }
  const contentType = match[1] || 'image/png'
  const body = Buffer.from(match[2] ?? '', 'base64')
  if (body.length === 0) return { error: 'Draw your signature before saving.' }

  const filename = 'signature.png'
  const key = newAttachmentKey({ tenantId: ctx.tenantId, kind: 'signature', filename })
  await putObject({ key, body, contentType, contentDisposition: 'inline' })

  await ctx.db(async (tx) => {
    const [att] = await tx
      .insert(attachments)
      .values({
        tenantId: ctx.tenantId,
        uploadedBy: ctx.userId,
        kind: 'signature',
        r2Key: key,
        contentType,
        sizeBytes: body.length,
        filename,
      })
      .returning({ id: attachments.id })
    if (att) {
      await tx
        .update(people)
        .set({ signatureAttachmentId: att.id })
        .where(eq(people.id, ctx.personId!))
    }
  })

  await recordAudit(ctx, {
    entityType: 'person',
    entityId: ctx.personId,
    action: 'update',
    summary: 'Updated signature (self-service)',
  })
  revalidatePath('/account')
  return { ok: true }
}

/** Clear the signed-in user's own signature. */
export async function clearMySignature(): Promise<Result> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'account')
  if (!ctx.personId) return { error: 'Your login is not linked to a person record yet.' }
  await ctx.db((tx) =>
    tx.update(people).set({ signatureAttachmentId: null }).where(eq(people.id, ctx.personId!)),
  )
  await recordAudit(ctx, {
    entityType: 'person',
    entityId: ctx.personId,
    action: 'update',
    summary: 'Cleared signature (self-service)',
  })
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
    await getAuth().api.requestPasswordReset({
      body: { email: sessionUser.email, redirectTo: '/reset-password' },
      headers: await reqHeaders(),
    })
  } catch {
    // Swallow — never surface mail/lookup failures.
  }
  return { ok: true }
}
