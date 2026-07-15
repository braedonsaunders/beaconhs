import { getGeneratedTranslations } from '@/i18n/generated.server'
import { GeneratedText } from '@/i18n/generated'
import Link from 'next/link'
import { Logo } from '@/components/brand-logo'
import { ForgotPasswordForm } from './forgot-password-form'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0443f19fd4e298') }
}

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Logo animated className="mx-auto h-11 w-auto" />
          <h1 className="mt-5 text-xl font-semibold">
            <GeneratedText id="m_1d36181969e2c6" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            <GeneratedText id="m_06945e212211a2" />
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-xs text-slate-500">
          <Link href="/login" className="text-teal-700 hover:underline">
            <GeneratedText id="m_1ca872ae411203" />
          </Link>
        </p>
      </div>
    </main>
  )
}
