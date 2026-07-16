'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { requestUpload, finalizeUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { addTrainingRecordFile } from '../_actions'

const FILE_KINDS = [
  { value: 'certificate', label: 'Certificate scan' },
  { value: 'evidence', label: 'Supporting evidence' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
] as const

export function TrainingRecordFilesDrawer({
  recordId,
  open,
  closeHref,
}: {
  recordId: string
  open: boolean
  closeHref: string
}) {
  const router = useRouter()
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const [kind, setKind] = useState('certificate')
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
    if (!uploaded) {
      setError(tGenerated('m_0ffda29f457746'))
      return
    }
    startTransition(async () => {
      const result = await addTrainingRecordFile({
        recordId,
        attachmentId: uploaded.attachmentId,
        label: label.trim() || uploaded.filename,
        kind,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(tGenerated('m_101abca7e52179'))
      reset()
      router.push(closeHref)
      router.refresh()
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_03cb1d648a3cb1')}
      description={tGenerated('m_04f9e210526b11')}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => router.push(closeHref)}
          >
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" disabled={pending || !uploaded} onClick={submit}>
            <GeneratedValue
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_03cb1d648a3cb1" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="record-file-kind">
            <GeneratedText id="m_074ba2f160c506" />
          </Label>
          <Select
            id="record-file-kind"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value)}
          >
            {FILE_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="record-file-label">
            <GeneratedText id="m_1d088977412efb" />
          </Label>
          <Input
            id="record-file-label"
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            placeholder={tGeneratedValue(uploaded?.filename ?? tGenerated('m_1c7621d420d6c6'))}
          />
        </div>
        {uploaded ? (
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
            <span className="truncate font-medium text-emerald-900 dark:text-emerald-200">
              {uploaded.filename}
            </span>
            <button
              type="button"
              className="text-xs text-emerald-800 hover:underline"
              onClick={() => setUploaded(null)}
            >
              <GeneratedText id="m_05b540acc16fd1" />
            </button>
          </div>
        ) : (
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="document"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.heic,.webp"
            label={tGenerated('m_06dc5804d9c769')}
            hint={tGenerated('m_1d7ec48b4d1e79')}
            onUploaded={(file) =>
              setUploaded({ attachmentId: file.attachmentId, filename: file.filename })
            }
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
