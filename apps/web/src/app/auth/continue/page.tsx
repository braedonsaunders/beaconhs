import { redirect } from 'next/navigation'
import { Card, CardContent } from '@beaconhs/ui'
import { Logo } from '@/components/brand-logo'
import { getRequestContext, getSignedInAccessSummary } from '@/lib/auth'
import { SignOutButton } from './sign-out-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account access' }

export default async function AuthContinuePage() {
  const ctx = await getRequestContext()
  if (ctx) redirect('/dashboard')

  const access = await getSignedInAccessSummary()
  if (!access) redirect('/login')

  const pending = access.memberships.filter(
    (m) => m.membershipStatus === 'invited' && m.tenantStatus === 'active',
  )
  const suspended = access.memberships.filter(
    (m) => m.membershipStatus === 'suspended' || m.tenantStatus !== 'active',
  )
  const title = pending.length > 0 ? 'Accept your invitation' : 'Access is not active'
  const body =
    pending.length > 0
      ? 'Open the one-time link in your invitation email. Signing in by itself does not activate a pending membership.'
      : suspended.length > 0
        ? 'Your membership or workspace is suspended. Contact your administrator to restore access.'
        : 'This account is not attached to an active workspace. Contact your administrator.'

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-5">
        <Logo className="mx-auto h-10 w-auto" />
        <Card>
          <CardContent className="space-y-4 pt-6 text-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">{body}</p>
            {pending.length > 1 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                You have {pending.length} pending invitations. Each email activates only its own
                workspace.
              </p>
            ) : null}
            <div className="flex justify-center">
              <SignOutButton />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
