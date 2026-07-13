import { redirect } from 'next/navigation'
import { Alert, AlertDescription } from '@beaconhs/ui'
import { Logo } from '@/components/brand-logo'
import { getCurrentUserId } from '@/lib/auth'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const userId = await getCurrentUserId()
  if (userId) redirect('/auth/continue')
  const sp = await searchParams
  const justReset = sp.reset === '1'
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Logo animated className="mx-auto h-11 w-auto" />
          <h1 className="mt-5 text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use your work email to continue</p>
        </div>
        {justReset ? (
          <Alert variant="success">
            <AlertDescription>
              Your password has been updated. Sign in with your new password.
            </AlertDescription>
          </Alert>
        ) : null}
        <LoginForm />
        <p className="text-center text-xs text-slate-500">
          Need an account? Contact your administrator.
        </p>
      </div>
    </main>
  )
}
