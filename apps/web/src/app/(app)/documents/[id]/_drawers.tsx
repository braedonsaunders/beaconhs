'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [outcome, setOutcome] = useState<'' | 'approved_no_change' | 'updated' | 'retired'>('')
  const [nextReviewOn, setNextReviewOn] = useState(defaultNextReviewOn ?? '')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    if (!outcome) {
      setError(tGenerated('m_0be53dcc37f11a'))
      return
    }
    startTransition(async () => {
      const res = await action({
        documentId,
        outcome,
        notes: notes.trim() || null,
        nextReviewOn: nextReviewOn.trim() || null,
      })
      if (res.ok) {
        toast.success(tGenerated('m_070085bada8ecb'))
        router.push(closeHref)
        router.refresh()
      } else {
        const message = res.error ?? 'Failed to record review'
        setError(tGeneratedValue(message))
        toast.error(tGeneratedValue(message))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_018804ef31e286')}
      description={tGenerated('m_14c268d619e924')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_018804ef31e286" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="outcome">
            <GeneratedText id="m_1da9fdbdd79b7b" />
          </Label>
          <Select
            id="outcome"
            value={outcome}
            onChange={(e) =>
              setOutcome(e.currentTarget.value as '' | 'approved_no_change' | 'updated' | 'retired')
            }
          >
            <option value="">
              <GeneratedText id="m_14c507a6027f7b" />
            </option>
            <option value="approved_no_change">
              <GeneratedText id="m_05af74aa7323c3" />
            </option>
            <option value="updated">
              <GeneratedText id="m_014ca61c68ab13" />
            </option>
            <option value="retired">
              <GeneratedText id="m_092f81e2ac87c2" />
            </option>
          </Select>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_0d4fb74c5bcfd6" />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nextReviewOn">
            <GeneratedText id="m_0f6a9235679934" />
          </Label>
          <Input
            id="nextReviewOn"
            type="date"
            value={nextReviewOn}
            onChange={(e) => setNextReviewOn(e.currentTarget.value)}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_01bbcff2404685" />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">
            <GeneratedText id="m_0b8dadcb78cd08" />
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            rows={5}
            placeholder={tGenerated('m_1a062b74212a04')}
          />
        </div>
        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}
