'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@beaconhs/ui'

// Subtle "back to the admin hub" link for admin-menu pages whose header doesn't
// use DetailHeader's `back` prop. Matches the DetailHeader back style so every
// /admin/* destination has the same top-left return link to the admin menu.
export function AdminBackLink({ className }: { className?: string }) {
  const router = useRouter()
  const [canUseHistory, setCanUseHistory] = useState(false)

  useEffect(() => {
    router.prefetch('/admin')
    try {
      const ref = document.referrer ? new URL(document.referrer) : null
      setCanUseHistory(
        Boolean(ref && ref.origin === window.location.origin && ref.pathname === '/admin'),
      )
    } catch {
      setCanUseHistory(false)
    }
  }, [router])

  return (
    <div className={cn('mb-5', className)}>
      <button
        type="button"
        onClick={() => (canUseHistory ? router.back() : router.push('/admin'))}
        className="text-sm text-teal-700 hover:underline dark:text-teal-300"
      >
        ← Back to admin
      </button>
    </div>
  )
}
