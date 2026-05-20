'use client'

// Sub-entity drawers for the document detail page:
//   • record-review   → log a new periodic-review entry
//   • new-version     → create a new draft version (rich-text body OR file upload)
//
// Both open via `?drawer=…` so they survive page refreshes and are
// link-shareable. Server actions are passed in from the RSC page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, PenLine, Upload } from 'lucide-react'
import {
  Button,
  cn,
  FileUploader,
  Input,
  Label,
  RichTextEditor,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'

type RecordReviewAction = (input: {
  documentId: string
  outcome: 'approved_no_change' | 'updated' | 'retired'
  notes: string | null
  nextReviewOn: string | null
}) => Promise<{ ok: boolean; error?: string }>

type NewVersionAction = (input: {
  documentId: string
  changelog: string | null
  contentHtml: string | null
  contentAttachmentId: string | null
}) => Promise<{ ok: boolean; error?: string }>

export function DocumentDrawers({
  documentId,
  openDrawer,
  closeHref,
  defaultNextReviewOn,
  recordReviewAction,
  newVersionAction,
}: {
  documentId: string
  openDrawer: 'record-review' | 'new-version' | null
  closeHref: string
  defaultNextReviewOn: string | null
  recordReviewAction: RecordReviewAction
  newVersionAction: NewVersionAction
}) {
  return (
    <>
      <RecordReviewDrawer
        open={openDrawer === 'record-review'}
        closeHref={closeHref}
        documentId={documentId}
        defaultNextReviewOn={defaultNextReviewOn}
        action={recordReviewAction}
      />
      <NewVersionDrawer
        open={openDrawer === 'new-version'}
        closeHref={closeHref}
        documentId={documentId}
        action={newVersionAction}
      />
    </>
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
      description="Log a periodic review. The document's next-review date will roll forward based on the cadence or your override below."
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
          <p className="text-[11px] text-slate-500">
            "Retired" archives the document. "Updated" leaves it as-is; create a new draft version
            separately if the content changes.
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
          <p className="text-[11px] text-slate-500">
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

// ---- New version -----------------------------------------------------------

function NewVersionDrawer({
  open,
  closeHref,
  documentId,
  action,
}: {
  open: boolean
  closeHref: string
  documentId: string
  action: NewVersionAction
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'rich-text' | 'upload'>('rich-text')
  const [changelog, setChangelog] = useState('')
  const [html, setHtml] = useState('')
  const [uploaded, setUploaded] = useState<{
    attachmentId: string
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (mode === 'upload' && !uploaded) {
      setError('Upload a file before creating the version.')
      return
    }
    startTransition(async () => {
      const res = await action({
        documentId,
        changelog: changelog.trim() || null,
        contentHtml: mode === 'rich-text' ? html : null,
        contentAttachmentId: mode === 'upload' ? uploaded!.attachmentId : null,
      })
      if (res.ok) {
        toast.success('Draft version created')
        router.push(closeHref)
        router.refresh()
      } else {
        const message = res.error ?? 'Failed to create version'
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="New draft version"
      description="Drafts let you revise the document without losing the previously-published content. Publish from the detail page when ready."
      size="lg"
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
            Create draft
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="changelog">Changelog</Label>
          <Input
            id="changelog"
            value={changelog}
            onChange={(e) => setChangelog(e.currentTarget.value)}
            placeholder="e.g. Updated PPE section per new ANSI standard"
          />
        </div>

        <div className="space-y-2">
          <Label>Content</Label>
          <div className="flex gap-2">
            <ModeChip
              active={mode === 'rich-text'}
              onClick={() => setMode('rich-text')}
              icon={PenLine}
              label="Write in-app"
              hint="Rich-text editor"
            />
            <ModeChip
              active={mode === 'upload'}
              onClick={() => setMode('upload')}
              icon={Upload}
              label="Upload a file"
              hint="PDF, DOCX, etc."
            />
          </div>

          {mode === 'rich-text' ? (
            <RichTextEditor
              defaultValue=""
              onChange={setHtml}
              placeholder="Write the new version…"
              minHeight="240px"
            />
          ) : uploaded ? (
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-emerald-900">
                <FileText size={14} />
                <span className="font-medium">{uploaded.filename}</span>
                <span className="text-xs text-emerald-700">attached</span>
              </div>
              <button
                type="button"
                onClick={() => setUploaded(null)}
                className="text-xs font-medium text-emerald-800 hover:underline"
              >
                Replace
              </button>
            </div>
          ) : (
            <FileUploader
              requestUploadAction={requestUpload}
              finalizeUploadAction={finalizeUpload}
              kind="document"
              accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md"
              onUploaded={(f) =>
                setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
              }
              label="Drop a PDF / DOCX or click to choose"
              hint="Up to 50 MB."
            />
          )}
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

function ModeChip({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md border px-3 py-2 text-left transition-colors',
        active
          ? 'border-teal-400 bg-teal-50 text-teal-900 shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50/40',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon size={13} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={cn('mt-0.5 text-[10px]', active ? 'text-teal-700' : 'text-slate-500')}>
        {hint}
      </p>
    </button>
  )
}
