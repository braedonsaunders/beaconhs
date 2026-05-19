'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { evalLogicRule, validateResponse, type FormField, type FormSchemaV1 } from '@beaconhs/forms-core'
import { submitFormResponse } from './actions'
import { SignaturePad } from '@/components/signature-pad'
import { FileUpload, dataUrlToFile, type AttachedFile } from '@/components/file-upload'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { WizardLayout } from '@/components/page-layout'

export function FormRenderer({
  templateId,
  templateName,
  version,
  schema,
  sites,
  people,
}: {
  templateId: string
  templateName: string
  version: number
  schema: FormSchemaV1
  sites: { id: string; name: string }[]
  people: { id: string; firstName: string; lastName: string }[]
}) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [siteId, setSiteId] = useState<string | ''>('')
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const sections = schema.sections
  const totalSteps = sections.length
  const section = sections[step]!

  // Filter sections + fields by their showIf rules
  const visibleFields = useMemo(
    () => section.fields.filter((f) => !f.showIf || evalLogicRule(f.showIf, values)),
    [section, values],
  )

  function setValue(fieldId: string, v: unknown) {
    setValues((s) => ({ ...s, [fieldId]: v }))
    setErrors((m) => {
      const next = new Map(m)
      next.delete(fieldId)
      return next
    })
  }

  function next() {
    const errs = validateResponse(schema, values, 'draft').filter(
      (e) => e.sectionId === section.id,
    )
    if (errs.length > 0) {
      setErrors(new Map(errs.map((e) => [e.fieldId, e.message])))
      return
    }
    setStep((s) => Math.min(totalSteps - 1, s + 1))
    setErrors(new Map())
  }

  function back() {
    setStep((s) => Math.max(0, s - 1))
    setErrors(new Map())
  }

  function submit() {
    setServerError(null)
    const errs = validateResponse(schema, values, 'submit')
    if (errs.length > 0) {
      setErrors(new Map(errs.map((e) => [e.fieldId, e.message])))
      // Move to the first section with an error
      const first = errs[0]!.sectionId
      const idx = sections.findIndex((s) => s.id === first)
      if (idx >= 0) setStep(idx)
      return
    }
    start(async () => {
      const res = await submitFormResponse({
        templateId,
        data: values,
        siteOrgUnitId: siteId || null,
      })
      if (!res.ok) {
        if (res.errors) {
          setErrors(new Map(res.errors.map((e) => [e.fieldId, e.message])))
        } else {
          setServerError('Submit failed')
        }
      }
      // ok-path navigates via server redirect
    })
  }

  const completion = Math.round((step / Math.max(1, totalSteps - 1)) * 100)

  return (
    <WizardLayout
      header={
        <div className="space-y-2">
          <Link
            href={`/forms/templates/${templateId}`}
            className="text-xs text-teal-700 hover:underline"
          >
            ← Back to template
          </Link>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold truncate">{templateName}</h1>
            <Badge variant="outline">v{version}</Badge>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: `${Math.max(8, completion)}%` }}
            />
          </div>
          <div className="text-xs text-slate-500">
            Step {step + 1} of {totalSteps} · {section.title?.en ?? section.id}
          </div>
        </div>
      }
      footer={
        <div className="space-y-2">
          {serverError ? (
            <Alert variant="destructive">
              <AlertTitle>Submit failed</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={back} disabled={step === 0}>
              <ChevronLeft size={14} />
              Back
            </Button>
            {step < totalSteps - 1 ? (
              <Button onClick={next}>
                Next <ChevronRight size={14} />
              </Button>
            ) : (
              <Button onClick={submit} disabled={pending}>
                <Check size={14} />
                {pending ? 'Submitting…' : 'Submit'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{section.title?.en ?? 'Section'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 ? (
            <div className="space-y-1">
              <Label>Site</Label>
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">— select —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {section.repeating ? (
            <RepeatingSection
              field={section.fields}
              values={(values[section.id] as Record<string, unknown>[] | undefined) ?? []}
              setRows={(rows) => setValue(section.id, rows)}
              people={people}
              errors={errors}
            />
          ) : (
            visibleFields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                value={values[f.id]}
                onChange={(v) => setValue(f.id, v)}
                error={errors.get(f.id)}
                people={people}
              />
            ))
          )}
        </CardContent>
      </Card>
    </WizardLayout>
  )
}

function FieldRow({
  field,
  value,
  onChange,
  error,
  people,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  error?: string
  people: { id: string; firstName: string; lastName: string }[]
}) {
  return (
    <div className="space-y-1">
      <Label>
        {field.label?.en ?? field.id}
        {field.required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {field.helpText?.en ? (
        <p className="text-xs text-slate-500">{field.helpText.en}</p>
      ) : null}
      <FieldInput field={field} value={value} onChange={onChange} people={people} />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  people,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  people: { id: string; firstName: string; lastName: string }[]
}) {
  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'url':
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : 'text'} />
    case 'textarea':
      return <Textarea rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
    case 'rating':
      return <Input type="number" value={(value as number) ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    case 'date':
      return <Input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'datetime':
      return <Input type="datetime-local" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'time':
      return <Input type="time" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'select':
    case 'radio': {
      const opts = field.validation?.options ?? []
      return (
        <Select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label?.en ?? o.value}
            </option>
          ))}
        </Select>
      )
    }
    case 'multi_select':
    case 'checkbox_group': {
      const opts = field.validation?.options ?? []
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-1">
          {opts.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={arr.includes(o.value)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...arr, o.value] : arr.filter((v) => v !== o.value))
                }
              />
              {o.label?.en ?? o.value}
            </label>
          ))}
        </div>
      )
    }
    case 'pass_fail_na':
      return (
        <div className="flex gap-2">
          {['pass', 'fail', 'n_a'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                value === v
                  ? v === 'pass'
                    ? 'border-emerald-500 bg-emerald-100 text-emerald-900'
                    : v === 'fail'
                      ? 'border-red-500 bg-red-100 text-red-900'
                      : 'border-slate-400 bg-slate-100 text-slate-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {v.toUpperCase().replace('_', '/')}
            </button>
          ))}
        </div>
      )
    case 'yes_no_comment': {
      const v = (value as { answer?: string; comment?: string } | undefined) ?? {}
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            {['yes', 'no'].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onChange({ ...v, answer: opt })}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  v.answer === opt
                    ? 'border-teal-500 bg-teal-100 text-teal-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {opt.toUpperCase()}
              </button>
            ))}
          </div>
          {v.answer === 'no' ? (
            <Textarea
              rows={2}
              placeholder="Add a comment (required on No)"
              value={v.comment ?? ''}
              onChange={(e) => onChange({ ...v, comment: e.target.value })}
            />
          ) : null}
        </div>
      )
    }
    case 'traffic_light':
      return (
        <div className="flex gap-2">
          {[
            { v: 'green', label: 'Green', tone: 'bg-emerald-500' },
            { v: 'yellow', label: 'Yellow', tone: 'bg-amber-400' },
            { v: 'red', label: 'Red', tone: 'bg-red-500' },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange(opt.v)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
                value === opt.v ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <span className={`inline-block h-3 w-3 rounded-full ${opt.tone}`} />
              {opt.label}
            </button>
          ))}
        </div>
      )
    case 'person_picker':
      return (
        <Select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.lastName}, {p.firstName}
            </option>
          ))}
        </Select>
      )
    case 'signature':
      return <SignatureField value={(value as string | null) ?? null} onChange={onChange} />
    case 'photo':
      return (
        <FileUpload
          variant="photo"
          value={Array.isArray(value) ? (value as AttachedFile[]) : []}
          onChange={(files) => onChange(files)}
        />
      )
    case 'file':
      return (
        <FileUpload
          variant="file"
          value={Array.isArray(value) ? (value as AttachedFile[]) : []}
          onChange={(files) => onChange(files)}
        />
      )
    case 'video':
      return (
        <FileUpload
          variant="video"
          value={Array.isArray(value) ? (value as AttachedFile[]) : []}
          onChange={(files) => onChange(files)}
        />
      )
    case 'audio':
      return (
        <FileUpload
          variant="audio"
          value={Array.isArray(value) ? (value as AttachedFile[]) : []}
          onChange={(files) => onChange(files)}
        />
      )
    case 'heading':
      return <h3 className="text-base font-semibold text-slate-800">{field.label?.en}</h3>
    case 'paragraph':
      return <p className="text-sm text-slate-600">{field.helpText?.en ?? field.label?.en}</p>
    case 'divider':
      return <hr className="border-slate-200" />
    default:
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
  }
}

function RepeatingSection({
  field,
  values,
  setRows,
  people,
  errors,
}: {
  field: FormField[]
  values: Record<string, unknown>[]
  setRows: (rows: Record<string, unknown>[]) => void
  people: { id: string; firstName: string; lastName: string }[]
  errors: Map<string, string>
}) {
  return (
    <div className="space-y-3">
      {values.length === 0 ? (
        <p className="text-sm text-slate-500">No rows yet.</p>
      ) : (
        values.map((row, i) => (
          <div key={i} className="rounded-md border border-slate-200 bg-slate-50/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Row {i + 1}
              </div>
              <button
                type="button"
                onClick={() => setRows(values.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="space-y-3">
              {field.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  value={row[f.id]}
                  onChange={(v) => {
                    const next = [...values]
                    next[i] = { ...row, [f.id]: v }
                    setRows(next)
                  }}
                  error={errors.get(f.id)}
                  people={people}
                />
              ))}
            </div>
          </div>
        ))
      )}
      <Button variant="outline" onClick={() => setRows([...values, {}])}>
        <Plus size={14} />
        Add row
      </Button>
    </div>
  )
}

/**
 * Signature field — captures drawn ink as PNG, uploads to MinIO/R2 the moment
 * the user lifts the stylus, then stores the attachment id on the response.
 */
function SignatureField({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: { attachmentId: string; url: string } | null) => void
}) {
  // We treat `value` as previously-stored attachment id+url payload, but the
  // canvas works in data-URL space. Use a local state for the active draw.
  const stored = (value as unknown as { attachmentId: string; url: string } | null) ?? null

  async function persist(dataUrl: string | null) {
    if (!dataUrl) {
      onChange(null)
      return
    }
    const file = dataUrlToFile(dataUrl, `signature-${Date.now()}.png`)
    const req = await requestUpload({
      kind: 'signature',
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    if (!req.ok) {
      console.warn('[signature] presign failed', req.error)
      return
    }
    const put = await fetch(req.putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!put.ok) return
    const fin = await finalizeUpload({
      kind: 'signature',
      key: req.key,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    if (!fin.ok) return
    onChange({ attachmentId: fin.attachmentId, url: req.publicUrl })
  }

  return (
    <div>
      <SignaturePad value={stored?.url ?? null} onChange={persist} />
    </div>
  )
}
