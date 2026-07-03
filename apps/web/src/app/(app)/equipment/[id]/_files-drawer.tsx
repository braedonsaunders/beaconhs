'use client'

// Upload drawer for the equipment detail "Files" tab. An equipment file is an
// `attachments` row tagged with `exif.equipmentId` (plus an optional category
// and label). The flow is: FileUploader creates the attachment, then
// `attachAction` tags it to this asset. Opens via `?drawer=upload-file`.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload } from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'

export const EQUIPMENT_FILE_KINDS = [
  { value: 'certificate', label: 'Certificate' },
  { value: 'manual', label: 'Manual' },
  { value: 'photo', label: 'Photo' },
  { value: 'receipt', label: 'Receipt / invoice' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'other', label: 'Other' },
] as const

export function EquipmentFileDrawer({
  open,
  closeHref,
  itemId,
  attachAction,
}: {
  open: boolean
  closeHref: string
  itemId: string
  attachAction: (input: {
    itemId: string
    attachmentId: string
    kind: string
    label: string | null
  }) => Promise<{ ok: boolean; error?: string }>
}) {
  const router = useRouter()
  const [kind, setKind] = useState<string>('certificate')
  const [label, setLabel] = useState('')
  const [uploaded, setUploaded] = useState<{ attachmentId: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setKind('certificate')
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
    startTransition(async () => {
      const res = await attachAction({
        itemId,
        attachmentId: uploaded.attachmentId,
        kind,
        label: label.trim() || null,
      })
      if (res.ok) {
        toast.success('File uploaded')
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error ?? 'Upload failed')
        toast.error(res.error ?? 'Upload failed')
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Upload file"
      description="Certificates, manuals, photos, receipts, and other documents tagged to this asset."
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
            {pending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Upload size={14} className="mr-1.5" />
            )}
            Save file
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="file-kind">Category</Label>
          <Select id="file-kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            {EQUIPMENT_FILE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file-label">Label</Label>
          <Input
            id="file-label"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder={uploaded?.filename ?? 'e.g. 2026 annual calibration'}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Defaults to the filename if left blank.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>File</Label>
          {uploaded ? (
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
              <span className="font-medium text-emerald-900 dark:text-emerald-200">
                {uploaded.filename}
              </span>
              <button
                type="button"
                onClick={() => setUploaded(null)}
                className="text-xs font-medium text-emerald-800 hover:underline dark:text-emerald-300"
              >
                Replace
              </button>
            </div>
          ) : (
            <FileUploader
              requestUploadAction={requestUpload}
              finalizeUploadAction={finalizeUpload}
              kind="document"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.heic,.webp"
              onUploaded={(f) => setUploaded({ attachmentId: f.attachmentId, filename: f.filename })}
              label="Drop file or click to choose"
              hint="Up to 50 MB. PDF, Office, or image."
            />
          )}
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
