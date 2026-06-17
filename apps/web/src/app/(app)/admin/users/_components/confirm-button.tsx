'use client'

// Submit button that asks for confirmation before letting its form submit.
// Used for destructive admin actions (remove member, revoke super-admin). Keeps
// the rest of the form server-rendered — only the confirm gate is client-side.

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
