'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, X } from 'lucide-react'
import { Button, Input, Label, Textarea } from '@beaconhs/ui'
import { sendCorrectiveActionEmail } from '../_actions'

/**
 * "Send email" header action. Opens a lightweight modal that takes a comma-
 * separated recipient list and an optional message. The actual delivery is
 * handled server-side by `sendCorrectiveActionEmail`; this just collects the
 * inputs and surfaces the result.
 */
export function SendEmailButton({ caId, reference }: { caId: string; reference: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [recipients, setRecipients] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setResult(null)
    setError(null)
  }

  function send() {
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
      setResult(`Sent to ${list.length} recipient${list.length === 1 ? '' : 's'}.`)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="outline" type="button" onClick={() => setOpen(true)}>
        <Mail size={14} />
        Send email
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Send corrective action — {reference}
                </h3>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="space-y-1.5">
                <Label>Recipients</Label>
                <Input
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder="alice@example.com, bob@example.com"
                  disabled={pending}
                />
                <p className="text-xs text-slate-500">
                  Comma-separate multiple addresses. A link to the CA is included
                  automatically.
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
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button variant="outline" size="sm" type="button" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" type="button" onClick={send} disabled={pending}>
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
