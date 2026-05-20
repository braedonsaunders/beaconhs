'use client'

// Drawers for the person detail page:
//   • upload-person-file → FileUploader + kind picker + label, inserts a
//     person_files row pointing at the uploaded attachment
//   • signature-upload   → image-only FileUploader; updates
//     people.signature_attachment_id directly
//
// Both open via `?drawer=…` so the URL is shareable and survives refresh.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Button,
  FileUploader,
  Input,
  Label,
  Select,
  UrlDrawer,
} from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { addPersonFile, setPersonSignature } from '../_actions/files'

const FILE_KINDS = [
  { value: 'resume', label: 'Resume' },
  { value: 'certification', label: 'Certification' },
  { value: 'id_copy', label: 'ID copy' },
  { value: 'other', label: 'Other' },
] as const

export function PersonFilesDrawers({
  personId,
  openDrawer,
  closeHref,
}: {
  personId: string
  openDrawer: 'upload-person-file' | 'signature-upload' | null
  closeHref: string
}) {
  return (
    <>
      <UploadFileDrawer
        open={openDrawer === 'upload-person-file'}
        closeHref={closeHref}
        personId={personId}
      />
      <SignatureUploadDrawer
        open={openDrawer === 'signature-upload'}
        closeHref={closeHref}
        personId={personId}
      />
    </>
  )
}

function UploadFileDrawer({
  open,
  closeHref,
  personId,
}: {
  open: boolean
  closeHref: string
  personId: string
}) {
  const router = useRouter()
  const [kind, setKind] = useState<string>('resume')
  const [label, setLabel] = useState('')
  const [uploaded, setUploaded] = useState<{
    attachmentId: string
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setKind('resume')
    setLabel('')
    setUploaded(null)
    setError(null)
  }

  function submit() {
    setError(null)
    if (!uploaded) {
      setError('Upload a file first.')
      return
    }
    const labelTrimmed = label.trim() || uploaded.filename
    startTransition(async () => {
      const res = await addPersonFile({
        personId,
        attachmentId: uploaded.attachmentId,
        label: labelTrimmed,
        kind,
      })
      if (res.ok) {
        toast.success('File uploaded')
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error)
        toast.error(res.error)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Upload personal file"
      description="Resumes, certifications, ID copies and other personal documents."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset()
              router.push(closeHref)
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !uploaded}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save file
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="kind">Kind</Label>
          <Select
            id="kind"
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value)}
          >
            {FILE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder={uploaded?.filename ?? 'e.g. 2024 forklift cert'}
          />
          <p className="text-[11px] text-slate-500">
            Defaults to the filename if left blank.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>File</Label>
          {uploaded ? (
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <span className="font-medium text-emerald-900">{uploaded.filename}</span>
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
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.heic,.webp"
              onUploaded={(f) =>
                setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
              }
              label="Drop file or click to choose"
              hint="Up to 50 MB. PDF, Word, or image."
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

function SignatureUploadDrawer({
  open,
  closeHref,
  personId,
}: {
  open: boolean
  closeHref: string
  personId: string
}) {
  const router = useRouter()
  const [uploaded, setUploaded] = useState<{
    attachmentId: string
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setUploaded(null)
    setError(null)
  }

  function submit() {
    setError(null)
    if (!uploaded) {
      setError('Upload an image first.')
      return
    }
    startTransition(async () => {
      const res = await setPersonSignature({
        personId,
        attachmentId: uploaded.attachmentId,
      })
      if (res.ok) {
        toast.success('Signature saved')
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error)
        toast.error(res.error)
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Upload signature image"
      description="PNG, JPG, or SVG. Used when this person signs forms, inspections, or lift plans."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset()
              router.push(closeHref)
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !uploaded}>
            {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            Save signature
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {uploaded ? (
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="font-medium text-emerald-900">{uploaded.filename}</span>
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
            kind="signature"
            accept="image/*"
            onUploaded={(f) =>
              setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
            }
            label="Drop signature image or click to choose"
            hint="Transparent PNG works best."
          />
        )}
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
