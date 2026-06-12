'use client'

// Sub-entity drawer for the document detail page: record-review (log a periodic
// review). Document content authoring now lives in the full-screen editor at
// /documents/[id]/editor, so the old "new version" rich-text drawer is gone.
// Opens via `?drawer=record-review` so it survives refresh + is link-shareable.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { toast } from '@/lib/toast'

type RecordReviewAction = (input: {
  documentId: string
  outcome: 'approved_no_change' | 'updated' | 'retired'
  notes: string | null
  nextReviewOn: string | null
}) => Promise<{ ok: boolean; error?: string }>

export function DocumentDrawers({
  documentId,
  openDrawer,
  closeHref,
  defaultNextReviewOn,
  recordReviewAction,
}: {
  documentId: string
  openDrawer: 'record-review' | null
  closeHref: string
  defaultNextReviewOn: string | null
  recordReviewAction: RecordReviewAction
}) {
  return (
    <RecordReviewDrawer
      open={openDrawer === 'record-review'}
      closeHref={closeHref}
      documentId={documentId}
      defaultNextReviewOn={defaultNextReviewOn}
      action={recordReviewAction}
    />
  )
}

// ---- Record review ---------------------------------------------------------

function RecordReviewDrawer({
  open,
  closeHref,
  documentId,
  defaultNextReviewOn,
  action,
}: {
  open: boolean
  closeHref: string
  documentId: string
  defaultNextReviewOn: string | null
  action: RecordReviewAction
}) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<'approved_no_change' | 'updated' | 'retired'>(
    'approved_no_change',
  )
  const [nextReviewOn, setNextReviewOn] = useState(defaultNextReviewOn ?? '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await action({
        documentId,
        outcome,
        notes: notes.trim() || null,
        nextReviewOn: nextReviewOn.trim() || null,
      })
      if (res.ok) {
        toast.success('Review recorded')
        router.push(closeHref)
        router.refresh()
      } else {
        const message = res.error ?? 'Failed to record review'
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Record review"
      description="Log a periodic review. The next-review date rolls forward based on the cadence or the override below."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Record review
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="outcome">Outcome *</Label>
          <Select
            id="outcome"
            value={outcome}
            onChange={(e) =>
              setOutcome(e.currentTarget.value as 'approved_no_change' | 'updated' | 'retired')
            }
          >
            <option value="approved_no_change">Approved — no change</option>
            <option value="updated">Updated</option>
            <option value="retired">Retired</option>
          </Select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            "Retired" archives the document. "Updated" leaves it as-is; edit the document and
            publish a new version separately if the content changes.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nextReviewOn">Next review on</Label>
          <Input
            id="nextReviewOn"
            type="date"
            value={nextReviewOn}
            onChange={(e) => setNextReviewOn(e.currentTarget.value)}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Leave blank to auto-compute from the document's review cadence.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            rows={5}
            placeholder="What did you check? What changed?"
          />
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
