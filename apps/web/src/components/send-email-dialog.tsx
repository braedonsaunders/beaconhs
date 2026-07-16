'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  listPersonGroups,
  resolvePersonGroupEmails,
} from '@/lib/notifications/person-group-emails-action'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // People groups — loaded lazily when the dialog opens; the picker only
  // appears if the tenant has any. Choosing one appends its members' emails to
  // the recipients field (which is controlled so it can be programmatically set).
  const [groups, setGroups] = useState<{ value: string; label: string }[]>([])
  const [recipients, setRecipients] = useState(defaultRecipients)
  const [groupBusy, startGroup] = useTransition()

  useEffect(() => {
    let cancelled = false
    listPersonGroups()
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
      const emails = await resolvePersonGroupEmails(groupId)
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
              <GeneratedValue value={title} />
              <GeneratedValue
                value={
                  reference ? (
                    <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedValue value={reference} />
                    </span>
                  ) : null
                }
              />
            </h2>
          </div>
          <button
            type="button"
            onClick={() => router.replace(window.location.pathname as any)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={tGenerated('m_19ab80ae228d44')}
          >
            <X size={16} />
          </button>
        </div>

        <form
          action={(fd) => {
            startTransition(async () => {
              setError(tGeneratedValue(null))
              try {
                await sendAction(fd)
                setSubmitted(true)
                setTimeout(() => router.replace(window.location.pathname as any), 800)
              } catch (sendError) {
                console.error('[send-email-dialog] delivery failed', sendError)
                setError(tGenerated('m_17980fffe9226d'))
              }
            })
          }}
          className="space-y-4 p-5"
        >
          <GeneratedValue
            value={Object.entries(hiddenFields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          />
          <GeneratedValue
            value={
              description ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <GeneratedValue value={description} />
                </p>
              ) : null
            }
          />

          <div className="space-y-1.5">
            <Label htmlFor="recipients">
              <GeneratedText id="m_11060d3eb82ac1" />
            </Label>
            <Input
              id="recipients"
              name="recipients"
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={tGenerated('m_0e47496ed10914')}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              <GeneratedValue value={recipientsHint} />
            </p>
            <GeneratedValue
              value={
                groups.length > 0 ? (
                  <SearchSelect
                    value=""
                    onChange={addGroup}
                    options={groups}
                    placeholder={tGeneratedValue(
                      groupBusy ? tGenerated('m_1ed2b9215a67c6') : tGenerated('m_0b4ff673912e40'),
                    )}
                    searchPlaceholder={tGenerated('m_15c4d2ca7e95f7')}
                    ariaLabel="Add a People group"
                    triggerClassName="mt-1"
                  />
                ) : null
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc">
              <GeneratedText id="m_1139d794f4ea9b" />
            </Label>
            <Input
              id="cc"
              name="cc"
              type="text"
              defaultValue={defaultCc}
              placeholder={tGenerated('m_1d9fd1a924a5f1')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subjectPrefix">
              <GeneratedText id="m_155e869f893331" />
            </Label>
            <Input
              id="subjectPrefix"
              name="subjectPrefix"
              defaultValue={defaultSubjectPrefix}
              placeholder={tGenerated('m_1a1fe99effa1f0')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message">
              <GeneratedText id="m_1edfd286d11988" />
            </Label>
            <Textarea
              id="message"
              name="message"
              rows={4}
              placeholder={tGenerated('m_03ec1b3acac658')}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <GeneratedValue
              value={
                error ? (
                  <p role="alert" className="mr-auto text-xs text-red-600 dark:text-red-400">
                    <GeneratedValue value={error} />
                  </p>
                ) : null
              }
            />
            <button
              type="button"
              onClick={() => router.replace(window.location.pathname as any)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
            >
              <GeneratedText id="m_112e2e8ecda428" />
            </button>
            <Button type="submit" disabled={isPending}>
              <GeneratedValue
                value={
                  isPending ? (
                    <GeneratedText id="m_0b6d87e6c6b163" />
                  ) : submitted ? (
                    <GeneratedText id="m_02eee7fc288b21" />
                  ) : (
                    <GeneratedText id="m_09dfca28fc95ba" />
                  )
                }
              />
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
