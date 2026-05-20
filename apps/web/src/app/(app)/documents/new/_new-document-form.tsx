'use client'

// Client wrapper that lets the user create a document either by writing
// rich-text content in-app OR by uploading a PDF / DOCX. Either path
// produces a v1 row in document_versions: the rich-text path fills
// `contentMarkdown` (now HTML — column name predates the migration),
// the file-upload path fills `contentAttachmentId`.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, Loader2, PenLine, Upload } from 'lucide-react'
import {
  Button,
  FileUploader,
  Input,
  Label,
  RichTextEditor,
  Select,
  Textarea,
  cn,
} from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { createDocument } from './actions'

type AuthoringMode = 'rich-text' | 'upload'

const CATEGORIES = [
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure / SOP' },
  { value: 'sds', label: 'Safety data sheet (SDS / MSDS)' },
  { value: 'form', label: 'Form / template' },
  { value: 'manual', label: 'Manual / handbook' },
  { value: 'training', label: 'Training material' },
  { value: 'other', label: 'Other' },
]

export function NewDocumentForm() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthoringMode>('rich-text')
  const [html, setHtml] = useState('')
  const [uploaded, setUploaded] = useState<{
    attachmentId: string
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(formData: FormData) {
    setError(null)
    if (mode === 'rich-text') {
      formData.set('contentHtml', html)
    } else if (uploaded) {
      formData.set('contentAttachmentId', uploaded.attachmentId)
    } else {
      setError('Upload a file before creating the document.')
      return
    }
    startTransition(async () => {
      const result = await createDocument(formData)
      if (result.ok) {
        router.push(`/documents/${result.id}`)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form
      action={handleSubmit}
      className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="space-y-1.5">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          name="title"
          required
          placeholder="e.g. Working at Heights Policy"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Select id="category" name="category" defaultValue="policy">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reviewFrequencyMonths">Review every (months)</Label>
          <Input
            id="reviewFrequencyMonths"
            name="reviewFrequencyMonths"
            type="number"
            min="1"
            placeholder="12"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="key">Key (optional)</Label>
        <Input id="key" name="key" placeholder="auto-generated from title if blank" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Short description</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>

      {/* Content authoring picker */}
      <div className="space-y-3">
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
          <div>
            <RichTextEditor
              defaultValue=""
              onChange={setHtml}
              placeholder="Write the document body…"
              minHeight="260px"
            />
            <p className="mt-1 text-xs text-slate-500">
              Becomes version 1. Revisions are kept immutable.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {uploaded ? (
              <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 text-emerald-900">
                  <FileText size={14} />
                  <span className="font-medium">{uploaded.filename}</span>
                  <span className="text-xs text-emerald-700">attached as v1</span>
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
                hint="Up to 50 MB. The file is stored as the v1 source."
              />
            )}
          </div>
        )}
      </div>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Link href="/documents">
          <Button type="button" variant="outline" disabled={isPending}>
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          Create draft
        </Button>
      </div>
    </form>
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
        'flex-1 rounded-md border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-teal-400 bg-teal-50 text-teal-900 shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50/40',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className={cn('mt-0.5 text-[11px]', active ? 'text-teal-700' : 'text-slate-500')}>
        {hint}
      </p>
    </button>
  )
}
