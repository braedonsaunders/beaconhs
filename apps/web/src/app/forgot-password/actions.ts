'use server'

// Public "forgot password" entry point. Triggers Better-Auth's reset flow,
// which emails the user a link (via `sendResetPassword` in the auth config).
// Always reports success so the form never reveals which emails are registered.

import { headers } from 'next/headers'
import { getAuth } from '@beaconhs/auth'

export async function requestReset(
  _prev: { sent: boolean } | null,
  formData: FormData,
): Promise<{ sent: boolean }> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    try {
      await getAuth().api.requestPasswordReset({
        body: { email, redirectTo: '/reset-password' },
        headers: (await headers()) as unknown as Headers,
      })
    } catch {
      // Never surface mail/lookup failures to the client — they'd leak account existence.
    }
  }
  return { sent: true }
}
