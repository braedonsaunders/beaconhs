'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, X } from 'lucide-react'
import { Alert, AlertDescription, Button, Input, Label, Textarea } from '@beaconhs/ui'
import { closeCorrectiveAction } from '../_actions'

/**
 * Status-tab footer button: "Close + lock". Prompts for a cost-impact figure
 * (legacy reports roll up the dollars) and an optional close note before
 * locking the row.
 */
export function CloseButton({
  caId,
  reference,
  verificationRequired,
  verifiedAt,
}: {
  caId: string
  reference: string
  verificationRequired: boolean
  verifiedAt: Date | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const blocked = verificationRequired && !verifiedAt

  function go() {
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
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button
        variant="default"
        type="button"
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={blocked ? 'Complete verification before closing' : undefined}
      >
        <CheckCircle2 size={14} />
        Close + lock
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Close corrective action — {reference}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
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
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button variant="default" size="sm" type="button" onClick={go} disabled={pending}>
                {pending ? 'Closing…' : 'Close + lock'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
