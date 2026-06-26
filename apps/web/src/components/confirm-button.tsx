'use client'

// Confirm-before-submit button for destructive lifecycle actions (revoke,
// delete). Keeps the page server-rendered: it sits inside a server-action
// <form> and just gates submission on window.confirm. Shared so every module's
// header actions look and behave identically.

import type { ReactNode } from 'react'
import { Button } from '@beaconhs/ui'

export function ConfirmButton({
  children,
  message,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  children: ReactNode
  message: string
  variant?: 'outline' | 'destructive' | 'ghost' | 'secondary'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  className?: string
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </Button>
  )
}
