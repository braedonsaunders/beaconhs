'use client'

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/** Keep open scoreboards current without interrupting a form or drawer. */
export function ComplianceRefresh() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    const refresh = () => {
      if (pending || document.visibilityState !== 'visible' || !navigator.onLine) return
      if (document.querySelector('[role="dialog"]')) return
      if (document.activeElement?.closest('input, textarea, select, [contenteditable="true"]'))
        return
      startTransition(() => router.refresh())
    }
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, pending])
  return null
}
