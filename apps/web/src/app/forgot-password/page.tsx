import Link from 'next/link'
import { Logo } from '@/components/brand-logo'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata = { title: 'Reset password' }

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Logo animated className="mx-auto h-11 w-auto" />
          <h1 className="mt-5 text-xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your work email and we&apos;ll send a reset link
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-xs text-slate-500">
          <Link href="/login" className="text-teal-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
