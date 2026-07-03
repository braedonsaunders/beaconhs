'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Label, Textarea } from '@beaconhs/ui'
import { sendCorrectiveActionEmail } from '../_actions'

/**
 * Body of the send-email drawer (opened via `?drawer=send-email` from
 * CaHeaderActions). Collects recipients + optional message and calls
 * `sendCorrectiveActionEmail`. After success, navigates to closeHref which
 * the parent uses to drop the drawer param.
 */
export function SendEmailBody({
  caId,
  formId,
  closeHref,
}: {
  caId: string
  formId: string
  closeHref: string
}) {
  const router = useRouter()
  const [recipients, setRecipients] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    setResult(null)
    const list = recipients
      .split(/[,;\s]+/g)
      .map((r) => r.trim())
      .filter(Boolean)
    if (list.length === 0) {
      setError('Add at least one recipient.')
      return
    }
    start(async () => {
      const res = await sendCorrectiveActionEmail({
        caId,
        recipients: list,
        message: message.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setResult(`Email queued for ${list.length} recipient${list.length === 1 ? '' : 's'}.`)
      router.push(closeHref as any)
      router.refresh()
    })
  }

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label>Recipients</Label>
        <Input
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="alice@example.com, bob@example.com"
          disabled={pending}
        />
        <p className="text-xs text-slate-500">
          Comma-separate multiple addresses. A link to the CA is included automatically.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Message (optional)</Label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Optional context for the recipients."
          disabled={pending}
        />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {result ? <p className="text-xs text-emerald-700">{result}</p> : null}
    </form>
  )
}
