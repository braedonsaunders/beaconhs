'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

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
          <GeneratedText id="m_069f90c4d821de" />
        </p>
        <GeneratedValue
          value={
            linkState?.ok ? (
              <Alert variant="success">
                <AlertDescription>
                  <GeneratedText id="m_19245d9071a802" />
                </AlertDescription>
              </Alert>
            ) : null
          }
        />
        <Button type="button" variant="outline" onClick={sendLink} disabled={sending}>
          <GeneratedValue
            value={
              sending ? (
                <GeneratedText id="m_0b6d87e6c6b163" />
              ) : (
                <GeneratedText id="m_0439baea415d12" />
              )
            }
          />
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
        <Label htmlFor="cur-pw">
          <GeneratedText id="m_0484cae84d33da" />
        </Label>
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
          <Label htmlFor="new-pw">
            <GeneratedText id="m_14dee08e358316" />
          </Label>
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
          <Label htmlFor="conf-pw">
            <GeneratedText id="m_0c3d6534423493" />
          </Label>
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
          <GeneratedText id="m_1cda7d619d3b0c" />
        </label>
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="text-xs text-slate-600 hover:underline dark:text-slate-300"
        >
          <GeneratedValue
            value={
              show ? (
                <GeneratedText id="m_1b0073432893f9" />
              ) : (
                <GeneratedText id="m_00fbddc6309531" />
              )
            }
          />{' '}
          <GeneratedText id="m_159e71287b4848" />
        </button>
      </div>

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
      <GeneratedValue
        value={
          state?.ok ? (
            <Alert variant="success">
              <AlertDescription>
                <GeneratedText id="m_128c974fabfad3" />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />
      <GeneratedValue
        value={
          linkState?.ok ? (
            <Alert variant="success">
              <AlertDescription>
                <GeneratedText id="m_06ce91cdfb26f6" />
              </AlertDescription>
            </Alert>
          ) : null
        }
      />

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_10d776f0c7968c" />
              ) : (
                <GeneratedText id="m_0b61c296fd9fcb" />
              )
            }
          />
        </Button>
        <button
          type="button"
          onClick={onForgot}
          disabled={sending}
          className="text-xs text-teal-700 hover:underline disabled:opacity-60 dark:text-teal-300"
        >
          <GeneratedValue
            value={
              sending ? (
                <GeneratedText id="m_0b6d87e6c6b163" />
              ) : (
                <GeneratedText id="m_14f70bf1b56f13" />
              )
            }
          />
        </button>
      </div>
    </form>
  )
}
