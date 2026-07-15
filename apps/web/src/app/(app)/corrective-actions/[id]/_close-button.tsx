'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, Input, Label, Textarea } from '@beaconhs/ui'
import { closeCorrectiveAction } from '../_actions'

/**
 * Body of the close-and-lock drawer (opened via `?drawer=close` from
 * CaHeaderActions). Prompts for the cost-impact figure + optional close note
 * before invoking the server action.
 */
export function CloseBody({
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
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(tGeneratedValue(null))
    if (cost && !/^[0-9]+(\.[0-9]{1,2})?$/.test(cost.trim())) {
      setError(tGenerated('m_17bcf7ee256577'))
      return
    }
    start(async () => {
      const res = await closeCorrectiveAction({
        caId,
        costImpact: cost.trim() || null,
        closeNotes: note.trim() || null,
      })
      if (!res.ok) {
        setError(tGeneratedValue(res.error))
        return
      }
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
      <Alert variant="warning">
        <AlertDescription>
          <GeneratedText id="m_1eed0c5a3a6409" />
        </AlertDescription>
      </Alert>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_1ebfabc8d7bb84" />
        </Label>
        <Input
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder={tGenerated('m_028e8fdc0535ea')}
          inputMode="decimal"
          disabled={pending}
        />
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_0766dbd26a6af4" />
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_1624f930df577f" />
        </Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={tGenerated('m_061ae871843e9c')}
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
    </form>
  )
}
