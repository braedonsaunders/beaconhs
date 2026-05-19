'use client'

// Lightweight inline dialog for the "Send email" header action.  Opens
// when ?send=1 is in the URL; closes when the modal X is clicked.  We use
// URL state rather than React state so the form submission (server action)
// fully replaces the page without losing dialog state.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Mail, X } from 'lucide-react'
import { Button, Input, Label, Textarea } from '@beaconhs/ui'

export function SendEmailDialog({
  open,
  reference,
  sendAction,
  defaultSubjectPrefix,
}: {
  open: boolean
  reference: string
  sendAction: (formData: FormData) => Promise<void>
  defaultSubjectPrefix?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-teal-700" />
            <h2 className="text-base font-semibold text-slate-900">Send incident email</h2>
          </div>
          <button
            type="button"
            onClick={() => router.replace(window.location.pathname as any)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form
          action={(fd) => {
            startTransition(async () => {
              await sendAction(fd)
              setSubmitted(true)
              setTimeout(() => router.replace(window.location.pathname as any), 800)
            })
          }}
          className="space-y-4 p-5"
        >
          <p className="text-sm text-slate-600">
            Sends a structured incident summary email to every active tenant admin. Add extra
            comma-separated email addresses below if you want to copy specific recipients in
            addition.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="subjectPrefix">Subject prefix</Label>
            <Input
              id="subjectPrefix"
              name="subjectPrefix"
              defaultValue={defaultSubjectPrefix ?? 'Update'}
              placeholder="Update / Action required / FYI"
            />
            <p className="text-xs text-slate-500">
              Prepended to the auto-generated subject (eg. "Update · Incident {reference} · …").
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="extraRecipients">Extra recipients</Label>
            <Input
              id="extraRecipients"
              name="extraRecipients"
              type="text"
              placeholder="ceo@example.com, hse@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message">Personal note (optional)</Label>
            <Textarea
              id="message"
              name="message"
              rows={4}
              placeholder="Add context for the recipients — e.g. ‘Please join the 4pm post-incident review.’"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => router.replace(window.location.pathname as any)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Sending…' : submitted ? 'Sent ✓' : 'Send email'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
