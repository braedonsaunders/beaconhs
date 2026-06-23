'use client'

import { useActionState, useState } from 'react'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'
import { submitReset } from './actions'

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitReset, null)
  const [show, setShow] = useState(false)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="text-xs text-slate-600 hover:underline dark:text-slate-300"
      >
        {show ? 'Hide' : 'Show'} password
      </button>

      {state?.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Updating…' : 'Set new password'}
      </Button>
    </form>
  )
}
