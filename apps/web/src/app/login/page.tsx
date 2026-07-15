import { getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { redirect } from 'next/navigation'
import { Alert, AlertDescription } from '@beaconhs/ui'
import { Logo } from '@/components/brand-logo'
import { getCurrentUserId } from '@/lib/auth'
import { LoginForm } from './login-form'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1d1210bb1b1dca') }
}

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
          <h1 className="mt-5 text-xl font-semibold">
            <GeneratedText id="m_1d1210bb1b1dca" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            <GeneratedText id="m_089a5f11450410" />
          </p>
        </div>
        <GeneratedValue
          value={
            justReset ? (
              <Alert variant="success">
                <AlertDescription>
                  <GeneratedText id="m_014a407c031b05" />
                </AlertDescription>
              </Alert>
            ) : null
          }
        />
        <LoginForm />
        <p className="text-center text-xs text-slate-500">
          <GeneratedText id="m_03c06c8469b155" />
        </p>
      </div>
    </main>
  )
}
