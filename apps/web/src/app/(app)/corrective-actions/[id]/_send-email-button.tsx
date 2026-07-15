'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [recipients, setRecipients] = useState('')
  const [message, setMessage] = useState('')
  const [pending, start] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(tGeneratedValue(null))
    setResult(null)
    const list = recipients
      .split(/[,;\s]+/g)
      .map((r) => r.trim())
      .filter(Boolean)
    if (list.length === 0) {
      setError(tGenerated('m_1c44621e722b1e'))
      return
    }
    start(async () => {
      const res = await sendCorrectiveActionEmail({
        caId,
        recipients: list,
        message: message.trim() || null,
      })
      if (!res.ok) {
        setError(tGeneratedValue(res.error))
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
        <Label>
          <GeneratedText id="m_0d99b2b56f8b5d" />
        </Label>
        <Input
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder={tGenerated('m_0e47496ed10914')}
          disabled={pending}
        />
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_0674d8e659af0d" />
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_07b4019031bee9" />
        </Label>
        <Textarea
          value={message}
          onChange={(e) => setMessage(tGeneratedValue(e.target.value))}
          rows={4}
          placeholder={tGenerated('m_1ad0918b0f0d32')}
          disabled={pending}
        />
      </div>
      <GeneratedValue
        value={
          error ? (
            <p className="text-xs text-red-600">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />
      <GeneratedValue
        value={
          result ? (
            <p className="text-xs text-emerald-700">
              <GeneratedValue value={result} />
            </p>
          ) : null
        }
      />
    </form>
  )
}
