'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Refresh displayed GPS without making extra requests to the tracking provider. */
export function WidgetRefresh() {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) router.refresh()
    }
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router])
  return null
}
