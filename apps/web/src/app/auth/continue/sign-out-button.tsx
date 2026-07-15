'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

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
      <GeneratedValue
        value={
          pending ? (
            <GeneratedText id="m_0445a4b68b7d56" />
          ) : (
            <GeneratedText id="m_15fa385f9d4f64" />
          )
        }
      />
    </Button>
  )
}
