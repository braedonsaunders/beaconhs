'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { Alert, AlertDescription, Button, Input, Label, Textarea } from '@beaconhs/ui'
import { closeCorrectiveAction } from '../_actions'

/**
 * Header trigger for the close-and-lock drawer. The actual cost-impact prompt
 * lives in the `CloseBody` widget mounted inside `?drawer=close`.
 */
export function CloseButton({
  caId,
  verificationRequired,
  verifiedAt,
}: {
  caId: string
  reference?: string
  verificationRequired: boolean
  verifiedAt: Date | null
}) {
  const blocked = verificationRequired && !verifiedAt
  if (blocked) {
    return (
      <Button
        variant="default"
        type="button"
        disabled
        title="Complete verification before closing"
      >
        <CheckCircle2 size={14} />
        Close + lock
      </Button>
    )
  }
  return (
    <Link href={`/corrective-actions/${caId}?drawer=close`}>
      <Button variant="default" type="button">
        <CheckCircle2 size={14} />
        Close + lock
      </Button>
    </Link>
  )
}

/**
 * Body of the close-and-lock drawer. Prompts for the cost-impact figure +
 * optional close note before invoking the server action.
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
  const router = useRouter()
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (cost && !/^[0-9]+(\.[0-9]{1,2})?$/.test(cost.trim())) {
      setError('Cost impact must be a number like 1234.56 (or leave blank).')
      return
    }
    start(async () => {
      const res = await closeCorrectiveAction({
        caId,
        costImpact: cost.trim() || null,
        closeNotes: note.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
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
          Closing will lock the record. Photos, work notes, and verification
          fields become read-only.
        </AlertDescription>
      </Alert>
      <div className="space-y-1.5">
        <Label>Cost impact (optional)</Label>
        <Input
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="e.g. 1250.00"
          inputMode="decimal"
          disabled={pending}
        />
        <p className="text-xs text-slate-500">
          Used by the "By source" and aging reports to roll up financial
          exposure.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>Close note (optional)</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Final remarks captured on the timeline."
          disabled={pending}
        />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </form>
  )
}
