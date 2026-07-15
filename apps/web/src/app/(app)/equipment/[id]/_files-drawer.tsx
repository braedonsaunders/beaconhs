'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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

const EQUIPMENT_FILE_KINDS = [
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
    setError(tGeneratedValue(null))
  }

  function submit() {
    setError(tGeneratedValue(null))
    if (!uploaded) {
      setError(tGenerated('m_0daf9e378e0646'))
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
        toast.success(tGenerated('m_01f37a7f2f8620'))
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error ?? tGenerated('m_0d520cff4c0719')))
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0d520cff4c0719')))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_06dc5804d9c769')}
      description={tGenerated('m_1769f2370b854c')}
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
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !uploaded}>
            <GeneratedValue
              value={
                pending ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Upload size={14} className="mr-1.5" />
                )
              }
            />
            <GeneratedText id="m_1290fc0a8f85ce" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="file-kind">
            <GeneratedText id="m_108b41637f364f" />
          </Label>
          <Select id="file-kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            {EQUIPMENT_FILE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file-label">
            <GeneratedText id="m_1d088977412efb" />
          </Label>
          <Input
            id="file-label"
            value={label}
            maxLength={240}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder={tGeneratedValue(uploaded?.filename ?? tGenerated('m_168a9c9e4596e9'))}
          />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_1f63bb2da02c0a" />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_102a42d098d1d2" />
          </Label>
          <GeneratedValue
            value={
              uploaded ? (
                <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
                  <span className="font-medium text-emerald-900 dark:text-emerald-200">
                    <GeneratedValue value={uploaded.filename} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setUploaded(null)}
                    className="text-xs font-medium text-emerald-800 hover:underline dark:text-emerald-300"
                  >
                    <GeneratedText id="m_05b540acc16fd1" />
                  </button>
                </div>
              ) : (
                <FileUploader
                  requestUploadAction={requestUpload}
                  finalizeUploadAction={finalizeUpload}
                  kind="document"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.heic,.webp"
                  onUploaded={(f) =>
                    setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
                  }
                  label={tGenerated('m_036e77b40339a7')}
                  hint={tGenerated('m_0f4b92a104e90e')}
                />
              )
            }
          />
        </div>
        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}
