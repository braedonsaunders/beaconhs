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
import { useEffect, useState, useTransition } from 'react'
import { Mail, X } from 'lucide-react'
import { Button, Input, Label, SearchSelect, Textarea } from '@beaconhs/ui'
import {
  listNotificationGroups,
  resolveNotificationGroupEmails,
} from '@/lib/notifications/group-emails-action'

type SendEmailDialogProps = {
  open: boolean
  title?: string
  description?: string
  /** Comma-separated email addresses to pre-fill in the recipients field. */
  defaultRecipients?: string
  /** Helper text under the recipients field. Override when the caller does not
   *  fall back to a default distribution list. */
  recipientsHint?: string
  defaultCc?: string
  defaultSubjectPrefix?: string
  /** Reference shown in the dialog title for context (e.g. "WO-2026-0042"). */
  reference?: string
  /** Server action invoked on submit. */
  sendAction: (formData: FormData) => Promise<void>
  /** Optional extra hidden fields the parent wants to send through. */
  hiddenFields?: Record<string, string>
}

export function GenericSendEmailDialog({ ...props }: SendEmailDialogProps) {
  if (!props.open) return null
  return <SendEmailDialogSession {...props} />
}

function SendEmailDialogSession({
  title = 'Send email',
  description,
  defaultRecipients = '',
  recipientsHint = 'Each address gets its own copy. Nothing is sent if this is left blank.',
  defaultCc = '',
  defaultSubjectPrefix = 'Update',
  reference,
  sendAction,
  hiddenFields = {},
}: SendEmailDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  // Notification groups — loaded lazily when the dialog opens; the picker only
  // appears if the tenant has any. Choosing one appends its members' emails to
  // the recipients field (which is controlled so it can be programmatically set).
  const [groups, setGroups] = useState<{ value: string; label: string }[]>([])
  const [recipients, setRecipients] = useState(defaultRecipients)
  const [groupBusy, startGroup] = useTransition()

  useEffect(() => {
    let cancelled = false
    listNotificationGroups()
      .then((g) => {
        if (!cancelled) setGroups(g)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function addGroup(groupId: string) {
    if (!groupId) return
    startGroup(async () => {
      const emails = await resolveNotificationGroupEmails(groupId)
      setRecipients((cur) => {
        const have = new Set(
          cur
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        )
        for (const e of emails) have.add(e)
        return Array.from(have).join(', ')
      })
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-teal-700 dark:text-teal-300" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
              {reference ? (
                <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {reference}
                </span>
              ) : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => router.replace(window.location.pathname as any)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
          {description ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="recipients">Recipients (comma-separated)</Label>
            <Input
              id="recipients"
              name="recipients"
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{recipientsHint}</p>
            {groups.length > 0 ? (
              <SearchSelect
                value=""
                onChange={addGroup}
                options={groups}
                placeholder={groupBusy ? 'Adding group…' : 'Add a notification group…'}
                searchPlaceholder="Search groups…"
                ariaLabel="Add a notification group"
                triggerClassName="mt-1"
              />
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc">Cc</Label>
            <Input
              id="cc"
              name="cc"
              type="text"
              defaultValue={defaultCc}
              placeholder="cc@example.com"
            />
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

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => router.replace(window.location.pathname as any)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
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
