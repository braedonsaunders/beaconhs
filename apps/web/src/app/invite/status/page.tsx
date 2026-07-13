import Link from 'next/link'
import { Card, CardContent } from '@beaconhs/ui'
import { Logo } from '@/components/brand-logo'

export const metadata = { title: 'Invitation' }

const COPY = {
  expired: {
    title: 'This invitation link has expired',
    body: 'Invitation links are one-time links and expire after 15 minutes. Ask your administrator to resend the invitation.',
  },
  invalid: {
    title: 'This invitation is not valid',
    body: 'The link may belong to a different account or may already have been used. Ask your administrator to resend it.',
  },
  pending: {
    title: 'The invitation was not completed',
    body: 'Your email was verified, but BeaconHS could not safely activate the membership. Ask your administrator to resend the invitation.',
  },
  unverified: {
    title: 'Email verification is required',
    body: 'Use the one-time link in the invitation email. If it no longer works, ask your administrator to resend it.',
  },
  suspended: {
    title: 'This membership is suspended',
    body: 'The invitation cannot reactivate a suspended membership. Contact your administrator if you need access restored.',
  },
  tenant_unavailable: {
    title: 'This workspace is unavailable',
    body: 'The workspace is suspended or archived, so invitations cannot be accepted. Contact your platform administrator.',
  },
  active: {
    title: 'Invitation accepted',
    body: 'Your membership is active. Continue to BeaconHS.',
  },
} as const

export default async function InviteStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = typeof sp.state === 'string' ? sp.state : 'invalid'
  const copy = COPY[raw as keyof typeof COPY] ?? COPY.invalid

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-5">
        <Logo className="mx-auto h-10 w-auto" />
        <Card>
          <CardContent className="space-y-4 pt-6 text-center">
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {copy.title}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">{copy.body}</p>
            <Link
              href="/auth/continue"
              className="inline-flex rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Continue
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
