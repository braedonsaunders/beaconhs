'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from '@beaconhs/auth/client'

export function SignOutButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await signOut()
          router.replace('/login')
        })
      }
      disabled={pending}
      className="rounded px-2 py-1 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
