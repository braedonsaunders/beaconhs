'use server'

// Completes the password reset. The token comes from the email link (Better-Auth
// validated it at the /api/auth callback and forwarded it here as ?token=...).

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@beaconhs/auth'

export async function submitReset(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')

  if (!token) return { error: 'This reset link is invalid. Request a new one.' }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  try {
    await auth.api.resetPassword({
      body: { newPassword: password, token },
      headers: (await headers()) as unknown as Headers,
    })
  } catch {
    return { error: 'This reset link has expired or already been used. Request a new one.' }
  }

  redirect('/login?reset=1')
}
