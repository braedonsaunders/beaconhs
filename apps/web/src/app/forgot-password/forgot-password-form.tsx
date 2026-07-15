'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useActionState } from 'react'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'
import { requestReset } from './actions'

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestReset, null)

  if (state?.sent) {
    return (
      <Alert variant="success">
        <AlertDescription>
          <GeneratedText id="m_1b3061c043d2b2" />
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">
          <GeneratedText id="m_00a0ba9938bdff" />
        </Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_0b6d87e6c6b163" />
            ) : (
              <GeneratedText id="m_11a35bda8503cd" />
            )
          }
        />
      </Button>
    </form>
  )
}
