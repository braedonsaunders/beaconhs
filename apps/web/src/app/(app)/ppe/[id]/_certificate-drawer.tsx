'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Add-certificate flyout for the PPE record page.
//
// "Certificates" are the third-party recertification records (e.g. an annual
// harness inspection by a certified rigger). Unlike the old form — which made
// you paste an attachment UUID — this uploads the signed certificate file
// directly via the shared FileUploader, then saves the row in one step.
//
// URL-driven (`?drawer=add-certificate`) so it survives refresh and is
// shareable. The save action is passed in from the server page so the insert +
// audit + revalidate stay colocated with the rest of the record actions.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { Button, FileUploader, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export type CertificateInput = {
  itemId: string
  inspectedOn: string
  result: 'pass' | 'fail' | 'remediated'
  inspectedByPersonId: string | null
  inspectorName: string | null
  inspectorCompany: string | null
  certificateAttachmentId: string | null
  notes: string | null
}

export function CertificateDrawer({
  open,
  closeHref,
  itemId,
  todayIso,
  saveAction,
}: {
  open: boolean
  closeHref: string
  itemId: string
  /** Server-computed YYYY-MM-DD so the default date is stable across hydration. */
  todayIso: string
  saveAction: (input: CertificateInput) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [inspectedOn, setInspectedOn] = useState(todayIso)
  const [result, setResult] = useState<'pass' | 'fail' | 'remediated'>('pass')
  const [personId, setPersonId] = useState('')
  const [inspectorName, setInspectorName] = useState('')
  const [inspectorCompany, setInspectorCompany] = useState('')
  const [uploaded, setUploaded] = useState<{ attachmentId: string; filename: string } | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function reset() {
    setInspectedOn(todayIso)
    setResult('pass')
    setPersonId('')
    setInspectorName('')
    setInspectorCompany('')
    setUploaded(null)
    setNotes('')
    setError(tGeneratedValue(null))
  }

  function close() {
    reset()
    router.push(closeHref)
  }

  function submit() {
    setError(tGeneratedValue(null))
    if (!inspectedOn) {
      setError(tGenerated('m_1d4baa182c6601'))
      return
    }
    start(async () => {
      const res = await saveAction({
        itemId,
        inspectedOn,
        result,
        inspectedByPersonId: personId || null,
        inspectorName: inspectorName.trim() || null,
        inspectorCompany: inspectorCompany.trim() || null,
        certificateAttachmentId: uploaded?.attachmentId ?? null,
        notes: notes.trim() || null,
      })
      if (res.ok) {
        toast.success(tGenerated('m_1d67aec605c8f7'))
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error))
        toast.error(tGeneratedValue(res.error))
      }
    })
  }

  // Next-due preview — the same +1 year the server applies, shown inline so the
  // user knows when the recert will lapse.
  const nextDue = (() => {
    if (!inspectedOn) return null
    const d = new Date(inspectedOn)
    if (Number.isNaN(d.getTime())) return null
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })()

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGenerated('m_101f8f6eb72ed9')}
      description={tGenerated('m_056e88c4b3ac3b')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            <GeneratedValue
              value={
                pending ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Plus size={14} className="mr-1.5" />
                )
              }
            />
            <GeneratedText id="m_15434e7d1c42ad" />
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_007365b39103b4" /> <span className="text-red-600">*</span>
          </Label>
          <Input type="date" value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} />
          <GeneratedValue
            value={
              nextDue ? (
                <p className="text-xs text-slate-500">
                  <GeneratedText id="m_11af411751990f" /> <GeneratedValue value={nextDue} />
                </p>
              ) : null
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_100e41041dbe51" /> <span className="text-red-600">*</span>
          </Label>
          <Select
            value={result}
            onChange={(e) => setResult(e.target.value as 'pass' | 'fail' | 'remediated')}
          >
            <option value="pass">{'Pass'}</option>
            <option value="fail">{'Fail'}</option>
            <option value="remediated">{'Pass after remediation'}</option>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            <GeneratedText id="m_0c04f05d754a3b" />
          </Label>
          <RemoteSearchSelect
            lookup="ppe-active-people"
            value={personId}
            onChange={setPersonId}
            placeholder={tGenerated('m_0be39d3a196b5b')}
            searchPlaceholder={tGenerated('m_06c2338b990aea')}
            ariaLabel="Inspected by"
            clearable
            emptyLabel={tGenerated('m_00d3e387f5f082')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1915423f92697f" />
          </Label>
          <Input
            value={inspectorName}
            onChange={(e) => setInspectorName(e.target.value)}
            placeholder={tGenerated('m_01f1e39c149b2b')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_03cbfec3b8280c" />
          </Label>
          <Input
            value={inspectorCompany}
            onChange={(e) => setInspectorCompany(e.target.value)}
            placeholder={tGenerated('m_02aa1c77766763')}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            <GeneratedText id="m_162675e3afbec7" />
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
                  accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx"
                  onUploaded={(f) =>
                    setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
                  }
                  label={tGenerated('m_143d35a4f51fa2')}
                  hint={tGenerated('m_1bedcc36cc7c5f')}
                />
              )
            }
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>
            <GeneratedText id="m_0b8dadcb78cd08" />
          </Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        <GeneratedValue
          value={
            error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <GeneratedValue value={error} />
              </p>
            ) : null
          }
        />
      </div>
    </UrlDrawer>
  )
}
