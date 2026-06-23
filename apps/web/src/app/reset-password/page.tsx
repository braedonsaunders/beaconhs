import Link from 'next/link'
import { Alert, AlertDescription } from '@beaconhs/ui'
import { Logo } from '@/components/brand-logo'
import { ResetPasswordForm } from './reset-password-form'

export const metadata = { title: 'Set new password' }

// Reached from the reset email. Better-Auth's callback validates the token and
// forwards here with ?token=... (or ?error=INVALID_TOKEN). Token-based, so this
// stays accessible whether or not a session exists — no redirect on auth.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const token = typeof sp.token === 'string' ? sp.token : ''
  const errorParam = typeof sp.error === 'string' ? sp.error : ''
  const invalid = !token || Boolean(errorParam)

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Logo animated className="mx-auto h-11 w-auto" />
          <h1 className="mt-5 text-xl font-semibold">Set a new password</h1>
        </div>

        {invalid ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>This reset link is invalid or has expired.</AlertDescription>
            </Alert>
            <p className="text-center text-sm">
              <Link href="/forgot-password" className="text-teal-700 hover:underline">
                Request a new link
              </Link>
            </p>
          </div>
        ) : (
          <>
            <ResetPasswordForm token={token} />
            <p className="text-center text-xs text-slate-500">
              <Link href="/login" className="text-teal-700 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
