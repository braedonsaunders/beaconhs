'use server'

// Self-service account actions for the signed-in user: edit profile (name, time
// zone, language), change password, or request a set/reset-password email. All
// are blocked while impersonating — they must never mutate the target's identity
// (and Better-Auth's session/profile semantics get muddy) under the admin's hand.

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@beaconhs/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { users } from '@beaconhs/db/schema'
import { assertNotImpersonating } from '@beaconhs/tenant'
import { getSessionUser, requireRequestContext } from '@/lib/auth'

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
  await withSuperAdmin(db, (tx) =>
    tx
      .update(users)
      .set({ name, timezone, locale, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId)),
  )

  // Sync Better-Auth's session copy of the name so the header + account menu
  // reflect it immediately (its 5-min cookie cache would otherwise lag).
  try {
    await auth.api.updateUser({ body: { name }, headers: await reqHeaders() })
  } catch {
    // The DB row is the source of truth; a Better-Auth sync hiccup isn't fatal.
  }

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
    await auth.api.changePassword({
      body: { newPassword, currentPassword, revokeOtherSessions },
      headers: await reqHeaders(),
    })
  } catch {
    return { error: 'Your current password is incorrect.' }
  }
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
    await auth.api.requestPasswordReset({
      body: { email: sessionUser.email, redirectTo: '/reset-password' },
      headers: await reqHeaders(),
    })
  } catch {
    // Swallow — never surface mail/lookup failures.
  }
  return { ok: true }
}
