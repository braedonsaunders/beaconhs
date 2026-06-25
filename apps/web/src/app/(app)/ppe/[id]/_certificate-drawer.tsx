'use client'

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
import {
  Button,
  FileUploader,
  Input,
  Label,
  SearchSelect,
  Select,
  Textarea,
  UrlDrawer,
  type SelectOption,
} from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'

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
  peopleOptions,
  todayIso,
  saveAction,
}: {
  open: boolean
  closeHref: string
  itemId: string
  peopleOptions: SelectOption[]
  /** Server-computed YYYY-MM-DD so the default date is stable across hydration. */
  todayIso: string
  saveAction: (input: CertificateInput) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
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
    setError(null)
  }

  function close() {
    reset()
    router.push(closeHref)
  }

  function submit() {
    setError(null)
    if (!inspectedOn) {
      setError('Inspection date is required.')
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
        toast.success('Certificate saved')
        reset()
        router.push(closeHref)
        router.refresh()
      } else {
        setError(res.error)
        toast.error(res.error)
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
      title="Add certificate"
      description="Record a third-party recertification and upload the signed certificate. The item's next-due date updates automatically."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Plus size={14} className="mr-1.5" />
            )}
            Save certificate
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>
            Inspected on <span className="text-red-600">*</span>
          </Label>
          <Input type="date" value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} />
          {nextDue ? <p className="text-xs text-slate-500">Next due {nextDue}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label>
            Result <span className="text-red-600">*</span>
          </Label>
          <Select
            value={result}
            onChange={(e) => setResult(e.target.value as 'pass' | 'fail' | 'remediated')}
          >
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="remediated">Pass after remediation</option>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Inspected by (internal person)</Label>
          <SearchSelect
            value={personId}
            onChange={setPersonId}
            options={peopleOptions}
            placeholder="Select a person…"
            searchPlaceholder="Search active people…"
            ariaLabel="Inspected by"
            clearable
            emptyLabel="— External inspector —"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Inspector name (external)</Label>
          <Input
            value={inspectorName}
            onChange={(e) => setInspectorName(e.target.value)}
            placeholder="e.g. Joe Rigger"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Inspector company</Label>
          <Input
            value={inspectorCompany}
            onChange={(e) => setInspectorCompany(e.target.value)}
            placeholder="e.g. Acme Riggers Ltd"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Certificate</Label>
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
              accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx"
              onUploaded={(f) =>
                setUploaded({ attachmentId: f.attachmentId, filename: f.filename })
              }
              label="Drop certificate or click to choose"
              hint="PDF or image, up to 50 MB."
            />
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
