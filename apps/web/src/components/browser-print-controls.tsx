'use client'
import { GeneratedValue } from '@/i18n/generated'

import { useEffect, type ReactNode } from 'react'

export function BrowserPrintButton({
  children = 'Print',
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      <GeneratedValue value={children} />
    </button>
  )
}

export function AutoPrint({ delayMs = 250 }: { delayMs?: number }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs])

  return null
}
