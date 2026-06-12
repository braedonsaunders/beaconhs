import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Logo } from '@/components/brand-logo'
import { getCurrentUserId } from '@/lib/auth'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage() {
  const userId = await getCurrentUserId()
  if (userId) redirect('/dashboard')
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Logo animated className="mx-auto h-11 w-auto" />
          <h1 className="mt-5 text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use your work email to continue</p>
        </div>
        <LoginForm />
        <p className="text-center text-xs text-slate-500">
          Need an account?{' '}
          <Link href="/help/access" className="text-teal-700 hover:underline">
            Contact your administrator
          </Link>
        </p>
      </div>
    </main>
  )
}
