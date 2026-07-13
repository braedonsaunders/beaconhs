'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from '@beaconhs/auth/client'
import { Button } from '@beaconhs/ui'

export function SignOutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOut()
          router.replace('/login')
        })
      }
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
