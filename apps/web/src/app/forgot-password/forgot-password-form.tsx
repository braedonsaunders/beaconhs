'use client'

import { useActionState } from 'react'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'
import { requestReset } from './actions'

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestReset, null)

  if (state?.sent) {
    return (
      <Alert variant="success">
        <AlertDescription>
          If an account exists for that email, a link to reset the password is on its way. The link
          expires in one hour.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  )
}
