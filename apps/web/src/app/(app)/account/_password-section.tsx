'use client'

import { useActionState, useState, useTransition } from 'react'
import { Alert, AlertDescription, Button, Input, Label } from '@beaconhs/ui'
import { changePassword, sendPasswordResetEmail } from './actions'

type Result = { ok?: boolean; error?: string }

export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const [linkState, setLinkState] = useState<Result | null>(null)
  const [sending, startSend] = useTransition()
  const sendLink = () => startSend(async () => setLinkState(await sendPasswordResetEmail()))

  if (!hasPassword) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          You currently sign in with magic links. We can email you a secure link to set a password —
          then you can also sign in with your email and password.
        </p>
        {linkState?.ok ? (
          <Alert variant="success">
            <AlertDescription>Check your email for a link to set your password.</AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" variant="outline" onClick={sendLink} disabled={sending}>
          {sending ? 'Sending…' : 'Email me a link to set a password'}
        </Button>
      </div>
    )
  }

  return <ChangePasswordForm onForgot={sendLink} sending={sending} linkState={linkState} />
}

function ChangePasswordForm({
  onForgot,
  sending,
  linkState,
}: {
  onForgot: () => void
  sending: boolean
  linkState: Result | null
}) {
  const [state, action, pending] = useActionState(changePassword, null)
  const [show, setShow] = useState(false)
  const type = show ? 'text' : 'password'

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cur-pw">Current password</Label>
        <Input
          id="cur-pw"
          name="currentPassword"
          type={type}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <Input
            id="new-pw"
            name="newPassword"
            type={type}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf-pw">Confirm new password</Label>
          <Input
            id="conf-pw"
            name="confirmPassword"
            type={type}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            name="revokeOther"
            className="h-4 w-4 rounded border-slate-300 accent-teal-600 dark:border-slate-600"
          />
          Sign out other devices
        </label>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="text-xs text-slate-600 hover:underline dark:text-slate-300"
        >
          {show ? 'Hide' : 'Show'} passwords
        </button>
      </div>

      {state?.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state?.ok ? (
        <Alert variant="success">
          <AlertDescription>Password changed.</AlertDescription>
        </Alert>
      ) : null}
      {linkState?.ok ? (
        <Alert variant="success">
          <AlertDescription>Check your email for a password reset link.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? 'Updating…' : 'Change password'}
        </Button>
        <button
          type="button"
          onClick={onForgot}
          disabled={sending}
          className="text-xs text-teal-700 hover:underline disabled:opacity-60 dark:text-teal-300"
        >
          {sending ? 'Sending…' : 'Forgot current password?'}
        </button>
      </div>
    </form>
  )
}
