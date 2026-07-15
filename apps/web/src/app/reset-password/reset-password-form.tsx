'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

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
        <Label htmlFor="password">
          <GeneratedText id="m_14dee08e358316" />
        </Label>
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
        <Label htmlFor="confirmPassword">
          <GeneratedText id="m_051f863341b6d5" />
        </Label>
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
        <GeneratedValue
          value={
            show ? <GeneratedText id="m_1b0073432893f9" /> : <GeneratedText id="m_00fbddc6309531" />
          }
        />{' '}
        <GeneratedText id="m_108e3204c19a56" />
      </button>

      <GeneratedValue
        value={
          state?.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                <GeneratedValue value={state.error} />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />

      <Button type="submit" className="w-full" disabled={pending}>
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_10d776f0c7968c" />
            ) : (
              <GeneratedText id="m_12d39c2d0416bb" />
            )
          }
        />
      </Button>
    </form>
  )
}
