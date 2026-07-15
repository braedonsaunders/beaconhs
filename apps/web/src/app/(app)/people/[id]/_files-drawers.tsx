'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Drawers for the person detail page:
//   • upload-person-file → FileUploader + kind picker + label, inserts a
//     person_files row pointing at the uploaded attachment
//
// Opens via `?drawer=…` so the URL is shareable and survives refresh. A person's
// signature is now recorded by the person themselves on the Account page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { addPersonFile } from '../_actions/files'

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
  openDrawer: 'upload-person-file' | null
  closeHref: string
}) {
  return (
    <UploadFileDrawer
      open={openDrawer === 'upload-person-file'}
      closeHref={closeHref}
      personId={personId}
    />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
    setError(tGeneratedValue(null))
  }

  function submit() {
    setError(tGeneratedValue(null))
    if (!uploaded) {
      setError(tGenerated('m_0daf9e378e0646'))
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
        toast.success(tGenerated('m_01f37a7f2f8620'))
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error))
        toast.error(tGeneratedValue(res.error))
      }
    })
  }

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_1da7b84128df4d')}
      description={tGenerated('m_1630da2c6c36ea')}
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
              value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_1290fc0a8f85ce" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="kind">
            <GeneratedText id="m_1e578efe1574cd" />
          </Label>
          <Select id="kind" value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            <GeneratedValue
              value={FILE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  <GeneratedValue value={k.label} />
                </option>
              ))}
            />
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">
            <GeneratedText id="m_1d088977412efb" />
          </Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            placeholder={tGeneratedValue(uploaded?.filename ?? tGenerated('m_1198f8f081eeba'))}
          />
          <p className="text-[11px] text-slate-500">
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
                <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                  <span className="font-medium text-emerald-900">
                    <GeneratedValue value={uploaded.filename} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setUploaded(null)}
                    className="text-xs font-medium text-emerald-800 hover:underline"
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
                  onUploaded={(f) =>
                    setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
                  }
                  label={tGenerated('m_036e77b40339a7')}
                  hint={tGenerated('m_0658b272b8f51b')}
                />
              )
            }
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
