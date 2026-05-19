'use client'

// Shared "Send email" dialog used by detail pages across modules.
//
// Opens when a parent passes `open={true}` (typically driven by ?send=1
// in the URL); closes by replacing the URL to drop the param so the
// underlying page state survives.
//
// Recipients are a comma-separated text field; Cc is a separate field;
// "message override" is an optional Textarea that the parent action
// stitches into the email body / subject prefix as it sees fit.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Mail, X } from 'lucide-react'
import { Button, Input, Label, Textarea } from '@beaconhs/ui'

export type SendEmailDialogProps = {
  open: boolean
  title?: string
  description?: string
  /** Comma-separated email addresses to pre-fill in the recipients field. */
  defaultRecipients?: string
  defaultCc?: string
  defaultSubjectPrefix?: string
  /** Reference shown in the dialog title for context (e.g. "WO-2026-0042"). */
  reference?: string
  /** Server action invoked on submit. */
  sendAction: (formData: FormData) => Promise<void>
  /** Optional extra hidden fields the parent wants to send through. */
  hiddenFields?: Record<string, string>
}

export function GenericSendEmailDialog({
  open,
  title = 'Send email',
  description,
  defaultRecipients = '',
  defaultCc = '',
  defaultSubjectPrefix = 'Update',
  reference,
  sendAction,
  hiddenFields = {},
}: SendEmailDialogProps) {
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
            <h2 className="text-base font-semibold text-slate-900">
              {title}
              {reference ? <span className="ml-2 font-mono text-xs text-slate-500">{reference}</span> : null}
            </h2>
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
          {Object.entries(hiddenFields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {description ? <p className="text-sm text-slate-600">{description}</p> : null}

          <div className="space-y-1.5">
            <Label htmlFor="recipients">Recipients (comma-separated)</Label>
            <Input
              id="recipients"
              name="recipients"
              type="text"
              defaultValue={defaultRecipients}
              placeholder="alice@example.com, bob@example.com"
            />
            <p className="text-[11px] text-slate-500">
              Each address gets its own copy. Leave blank to send to the default tenant admin
              distribution list.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc">Cc</Label>
            <Input id="cc" name="cc" type="text" defaultValue={defaultCc} placeholder="cc@example.com" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subjectPrefix">Subject prefix</Label>
            <Input
              id="subjectPrefix"
              name="subjectPrefix"
              defaultValue={defaultSubjectPrefix}
              placeholder="Update / Action required / FYI"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message">Personal note (optional)</Label>
            <Textarea
              id="message"
              name="message"
              rows={4}
              placeholder="Add context for the recipients."
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
