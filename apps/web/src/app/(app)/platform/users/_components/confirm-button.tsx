'use client'

// Submit button that asks for confirmation before letting its form submit.
// Local to /platform/users so this surface stays decoupled from /admin internals.

import { Button, type ButtonProps } from '@beaconhs/ui'

export function ConfirmButton({
  confirmMessage,
  children,
  ...props
}: ButtonProps & { confirmMessage: string }) {
  return (
    <Button
      {...props}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault()
      }}
    >
      {children}
    </Button>
  )
}
