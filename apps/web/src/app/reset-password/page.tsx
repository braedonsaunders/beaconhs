import { getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Alert, AlertDescription } from '@beaconhs/ui'
import { Logo } from '@/components/brand-logo'
import { ResetPasswordForm } from './reset-password-form'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_12d39c2d0416bb') }
}

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
          <h1 className="mt-5 text-xl font-semibold">
            <GeneratedText id="m_0480d1e9c8fd55" />
          </h1>
        </div>

        <GeneratedValue
          value={
            invalid ? (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertDescription>
                    <GeneratedText id="m_1aa5b138fc7a2e" />
                  </AlertDescription>
                </Alert>
                <p className="text-center text-sm">
                  <Link href="/forgot-password" className="text-teal-700 hover:underline">
                    <GeneratedText id="m_0eb29cb6d1851e" />
                  </Link>
                </p>
              </div>
            ) : (
              <>
                <ResetPasswordForm token={token} />
                <p className="text-center text-xs text-slate-500">
                  <Link href="/login" className="text-teal-700 hover:underline">
                    <GeneratedText id="m_1ca872ae411203" />
                  </Link>
                </p>
              </>
            )
          }
        />
      </div>
    </main>
  )
}
