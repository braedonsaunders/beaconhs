'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// URL-drawer for attaching a supporting file to a skill assignment:
// FileUploader → label + kind → addSkillAssignmentFile. Opens via
// `?drawer=upload-file` so the URL is shareable and survives refresh.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { addSkillAssignmentFile } from '../_actions'

const FILE_KINDS = [
  { value: 'certificate', label: 'Certificate scan' },
  { value: 'evidence', label: 'Supporting evidence' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
] as const

export function SkillFilesDrawer({
  assignmentId,
  open,
  closeHref,
}: {
  assignmentId: string
  open: boolean
  closeHref: string
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
    const labelTrimmed = label.trim() || uploaded.filename
    startTransition(async () => {
      const res = await addSkillAssignmentFile({
        assignmentId,
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
      title={tGenerated('m_06dc5804d9c769')}
      description={tGenerated('m_1f3c925b7eefc2')}
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
            placeholder={tGeneratedValue(uploaded?.filename ?? tGenerated('m_0e74909700b040'))}
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
                <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
                  <span className="font-medium text-emerald-900 dark:text-emerald-200">
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
