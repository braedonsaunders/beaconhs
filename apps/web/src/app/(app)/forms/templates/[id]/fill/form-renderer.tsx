'use client'

// Form filler runtime.
//
// Features:
//   - Multi-step rendering grouped by `section.step` against `workflow.steps`
//   - Progress strip with click-to-jump on completed steps
//   - Per-field visibility via `evaluateLogicRule(field.showIf, ctx)`
//   - Section visibility via `evaluateLogicRule(section.showIf, ctx)`
//   - Repeating sections with min/max-rows bounds + row-label-template
//   - Formula fields rendered read-only, recomputed via evaluateFormulaTree
//   - Default values resolved via resolveDefaultValue once per first render
//   - Validation runs on Next and Submit; inline errors per field
//
// Storage shape: `data` is `Record<string, unknown>` keyed by field id for
// top-level fields, plus `data[sectionId]` = `Array<Record<fieldId, value>>`
// for repeating sections. Same convention the response-viewer already reads.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
import {
  evaluateFormulaTree,
  evaluateLogicRule,
  resolveDefaultValue,
  validateResponse,
  entityKindForPicker,
  type EvalContext,
  type EntityAttrsByField,
  type FormField,
  type FormSchemaV1,
  type FormSection,
  type FormulaExpression,
  type DefaultValueExpression,
  type LogicRule,
} from '@beaconhs/forms-core'
import { fetchEntityAttrs, submitFormResponse } from './actions'
import { SignaturePad } from '@/components/signature-pad'
import { FileUpload, dataUrlToFile, type AttachedFile } from '@/components/file-upload'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { WizardLayout } from '@/components/page-layout'
import { toast } from '@/lib/toast'

type CurrentUser = {
  personId: string | null
  name: string | null
}

export function FormRenderer({
  templateId,
  templateName,
  version,
  schema,
  sites,
  people,
  entitiesByField: initialEntitiesByField,
  currentUser,
}: {
  templateId: string
  templateName: string
  version: number
  schema: FormSchemaV1
  sites: { id: string; name: string }[]
  people: { id: string; firstName: string; lastName: string }[]
  // Per-picker entity-attribute maps preloaded server-side. Keyed by picker
  // field id (NOT entity id) so the runtime can pick up the right map by
  // field key in the evaluator. The client refreshes individual entries via
  // `fetchEntityAttrs` when a picker selection changes.
  entitiesByField: EntityAttrsByField
  currentUser: CurrentUser
}) {
  const router = useRouter()
  // Per-step progress so users can click back into completed steps.
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const [stepIndex, setStepIndex] = useState(0)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [rowsByStep, setRowsByStep] = useState<Record<string, Record<string, unknown>[]>>({})
  const [siteId, setSiteId] = useState<string | ''>('')
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const appliedDefaults = useRef<Set<string>>(new Set())
  // Per-picker entity attribute maps, fed into the evaluator on every render
  // so `entity_attr` formula fields stay live. Refreshed via the
  // fetchEntityAttrs server action whenever a picker's value changes.
  const [entitiesByField, setEntitiesByField] = useState<EntityAttrsByField>(
    initialEntitiesByField,
  )
  // Picker field ids currently mid-flight to the fetchEntityAttrs action.
  // Drives the small "Looking up…" indicator next to the picker.
  const [pickerLoading, setPickerLoading] = useState<Set<string>>(new Set())

  // Group sections by their workflow step. Each step is a "page". Sections
  // without an explicit `step` fall into the first workflow step.
  const sectionsByStep = useMemo(() => {
    const map = new Map<string, FormSection[]>()
    const defaultStepKey = schema.workflow.steps[0]?.key ?? 'submit'
    for (const sec of schema.sections) {
      const k = sec.step ?? defaultStepKey
      const list = map.get(k) ?? []
      list.push(sec)
      map.set(k, list)
    }
    return map
  }, [schema])

  // The list of *visible* steps, computed from the workflow steps that
  // actually have sections bound to them. A workflow step with no sections
  // is still rendered (so reviewers see the post-submit signature step), but
  // its body becomes a single "ready to submit" pane.
  const steps = schema.workflow.steps
  const totalSteps = steps.length
  const step = steps[stepIndex]!
  const stepSections = sectionsByStep.get(step.key) ?? []

  // Build the eval context used by visibility + formula evaluation. Includes
  // every section's rows under its section id so cross-step sum_section works,
  // and the per-picker entity-attr maps that `entity_attr` reads from.
  const evalCtx = useMemo<EvalContext>(() => {
    return {
      values,
      rows: rowsByStep,
      entities: entitiesByField,
      requestContext: {
        now: new Date(),
        currentUserPersonId: currentUser.personId,
        currentUserName: currentUser.name,
      },
    }
  }, [values, rowsByStep, entitiesByField, currentUser])

  // Apply default values on first render of a step. Tracked via a ref so we
  // don't re-apply when the user clears the field intentionally.
  useEffect(() => {
    let mutated: Record<string, unknown> | null = null
    for (const sec of stepSections) {
      // Skip repeating sections — defaults are applied per row on row add.
      if (sec.repeating) continue
      for (const f of sec.fields) {
        if (!f.defaultValue) continue
        const key = `${step.key}:${f.id}`
        if (appliedDefaults.current.has(key)) continue
        if (values[f.id] !== undefined && values[f.id] !== '' && values[f.id] !== null) {
          appliedDefaults.current.add(key)
          continue
        }
        const v = resolveDefaultValue(f.defaultValue as DefaultValueExpression, evalCtx)
        if (v !== undefined && v !== null) {
          mutated = mutated ?? { ...values }
          mutated[f.id] = v
        }
        appliedDefaults.current.add(key)
      }
    }
    if (mutated) setValues(mutated)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex])

  // --- Helpers ---------------------------------------------------------------

  // Map of fieldId → picker field type so picker-change refreshes can resolve
  // the entity kind server-side without re-walking the schema.
  const pickerFieldTypes = useMemo(() => {
    const map = new Map<string, string>()
    for (const sec of schema.sections) {
      if (sec.repeating) continue
      for (const f of sec.fields) {
        if (entityKindForPicker(f.type)) map.set(f.id, f.type)
      }
    }
    return map
  }, [schema])

  function setValue(fieldId: string, v: unknown) {
    setValues((s) => ({ ...s, [fieldId]: v }))
    setErrors((m) => {
      const next = new Map(m)
      next.delete(fieldId)
      return next
    })
    // If this field is a picker, refresh its entity-attr map. We clear any
    // stale entry immediately (so an `entity_attr` field that no longer
    // applies stops rendering its old value) before kicking off the async
    // fetch. Multi-pickers (`multi_person_picker` etc.) aren't supported by
    // entity_attr — `entityKindForPicker` returns null for them.
    const pickerType = pickerFieldTypes.get(fieldId)
    if (pickerType) {
      setEntitiesByField((m) => ({ ...m, [fieldId]: null }))
      if (typeof v === 'string' && v.length > 0) {
        setPickerLoading((s) => {
          const next = new Set(s)
          next.add(fieldId)
          return next
        })
        // Fire-and-forget — we only update local state on completion.
        fetchEntityAttrs({ pickerFieldType: pickerType, entityId: v })
          .then((res) => {
            if (res.ok) {
              setEntitiesByField((m) => ({ ...m, [fieldId]: res.attrs }))
            }
          })
          .catch(() => {
            // Swallow — picker still works, the formula field just shows '—'.
          })
          .finally(() => {
            setPickerLoading((s) => {
              const next = new Set(s)
              next.delete(fieldId)
              return next
            })
          })
      }
    }
  }

  function setRows(sectionId: string, rows: Record<string, unknown>[]) {
    setRowsByStep((s) => ({ ...s, [sectionId]: rows }))
  }

  function addRow(section: FormSection) {
    const existing = rowsByStep[section.id] ?? []
    if (section.maxRows !== undefined && existing.length >= section.maxRows) return
    // Apply per-field defaults to the new row.
    const row: Record<string, unknown> = {}
    for (const f of section.fields) {
      if (!f.defaultValue) continue
      const v = resolveDefaultValue(f.defaultValue as DefaultValueExpression, evalCtx)
      if (v !== undefined && v !== null) row[f.id] = v
    }
    setRows(section.id, [...existing, row])
  }

  function removeRow(section: FormSection, idx: number) {
    const rows = rowsByStep[section.id] ?? []
    setRows(section.id, rows.filter((_, i) => i !== idx))
  }

  function updateRow(section: FormSection, idx: number, patch: Record<string, unknown>) {
    const rows = rowsByStep[section.id] ?? []
    setRows(
      section.id,
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    )
  }

  // The full payload sent to the server: top-level field values plus repeating
  // section rows merged in under the section id.
  function buildPayload(): Record<string, unknown> {
    const data: Record<string, unknown> = { ...values }
    for (const [secId, rows] of Object.entries(rowsByStep)) {
      data[secId] = rows
    }
    return data
  }

  // Validate everything visible in the current step. Hidden fields skip
  // validation. Repeating sections check minRows + every visible row.
  function validateCurrentStep(): Map<string, string> {
    const errs = new Map<string, string>()
    for (const sec of stepSections) {
      if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) continue
      if (sec.repeating) {
        const rows = rowsByStep[sec.id] ?? []
        if (sec.minRows !== undefined && rows.length < sec.minRows) {
          errs.set(`__section_${sec.id}`, `Add at least ${sec.minRows} row${sec.minRows === 1 ? '' : 's'}`)
        }
        for (let i = 0; i < rows.length; i++) {
          for (const f of sec.fields) {
            // Per-row visibility is evaluated against the row's own values.
            const rowCtx: EvalContext = { ...evalCtx, values: { ...evalCtx.values, ...rows[i] } }
            if (f.showIf && !evaluateLogicRule(f.showIf, rowCtx)) continue
            const error = validateOne(f, rows[i]![f.id])
            if (error) errs.set(`${sec.id}.${i}.${f.id}`, error)
          }
        }
      } else {
        for (const f of sec.fields) {
          if (f.showIf && !evaluateLogicRule(f.showIf, evalCtx)) continue
          // Formula fields are auto-computed and never validated against the user.
          if (f.type === 'formula' || f.type === 'calc') continue
          const error = validateOne(f, values[f.id])
          if (error) errs.set(f.id, error)
        }
      }
    }
    return errs
  }

  function next() {
    const errs = validateCurrentStep()
    if (errs.size > 0) {
      setErrors(errs)
      toast.error(`Fix ${errs.size} issue${errs.size === 1 ? '' : 's'} before continuing`)
      return
    }
    setErrors(new Map())
    setCompletedSteps((s) => new Set(s).add(step.key))
    setStepIndex((i) => Math.min(totalSteps - 1, i + 1))
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1))
    setErrors(new Map())
  }

  function jumpTo(i: number) {
    // Allow jumping to completed steps + the current step. Anything later is
    // gated by per-step validation.
    if (i === stepIndex) return
    if (i < stepIndex || completedSteps.has(steps[i]!.key)) {
      setStepIndex(i)
      setErrors(new Map())
    }
  }

  function submit() {
    setServerError(null)
    const stepErrs = validateCurrentStep()
    if (stepErrs.size > 0) {
      setErrors(stepErrs)
      return
    }
    const payload = buildPayload()
    // Full-form revalidation via the shared @beaconhs/forms-core validator
    // against the *combined* payload (so the server sees the same shape).
    const globalErrs = validateResponse(schema, payload, 'submit')
    if (globalErrs.length > 0) {
      const map = new Map<string, string>()
      for (const e of globalErrs) map.set(e.fieldId, e.message)
      setErrors(map)
      // Walk back to the first step with an error.
      const firstSection = globalErrs[0]!.sectionId
      if (firstSection) {
        const ownerSec = schema.sections.find((s) => s.id === firstSection)
        if (ownerSec) {
          const targetStepKey = ownerSec.step ?? steps[0]!.key
          const idx = steps.findIndex((s) => s.key === targetStepKey)
          if (idx >= 0) setStepIndex(idx)
        }
      }
      return
    }
    start(async () => {
      const res = await submitFormResponse({
        templateId,
        data: payload,
        siteOrgUnitId: siteId || null,
      })
      if (!res.ok) {
        if (res.errors) {
          setErrors(new Map(res.errors.map((e) => [e.fieldId, e.message])))
          toast.error('Submit failed — see field errors')
        } else {
          setServerError('Submit failed')
          toast.error('Submit failed')
        }
      } else {
        toast.success('Form submitted')
      }
      // ok-path navigates via server redirect.
    })
  }

  const completion = Math.round(((stepIndex + 1) / Math.max(1, totalSteps)) * 100)

  return (
    <WizardLayout
      header={
        <div className="space-y-3">
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
          {/* Progress strip — every workflow step as a clickable pill */}
          <ol className="flex flex-wrap items-center gap-1 text-xs">
            {steps.map((s, i) => {
              const isCurrent = i === stepIndex
              const isCompleted = completedSteps.has(s.key)
              const isClickable = i <= stepIndex || isCompleted
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    disabled={!isClickable}
                    onClick={() => jumpTo(i)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                      isCurrent
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : isCompleted
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          : 'border-slate-200 bg-white text-slate-600'
                    } ${!isClickable ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <span
                      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                        isCurrent
                          ? 'bg-white text-teal-700'
                          : isCompleted
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {isCompleted && !isCurrent ? <Check size={10} /> : i + 1}
                    </span>
                    <span className="truncate">{s.title?.en ?? s.key}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="h-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-teal-600 transition-all"
              style={{ width: `${Math.max(8, completion)}%` }}
            />
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
            <Button variant="outline" onClick={back} disabled={stepIndex === 0}>
              <ChevronLeft size={14} />
              Back
            </Button>
            {stepIndex < totalSteps - 1 ? (
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
      {stepIndex === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      ) : null}

      {stepSections.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{step.title?.en ?? step.key}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              No sections bound to this step. Click Submit to finalise.
            </p>
          </CardContent>
        </Card>
      ) : (
        stepSections.map((sec) => {
          // Section-level visibility — completely hide the section if showIf
          // is false against the current values.
          if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) return null
          return (
            <Card key={sec.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {sec.title?.en ?? sec.id}
                  {sec.repeating ? (
                    <Badge variant="secondary" className="ml-2">
                      repeating
                    </Badge>
                  ) : null}
                </CardTitle>
                {sec.description?.en ? (
                  <p className="text-xs text-slate-500">{sec.description.en}</p>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {sec.repeating ? (
                  <RepeatingSection
                    section={sec}
                    rows={rowsByStep[sec.id] ?? []}
                    onAdd={() => addRow(sec)}
                    onRemove={(i) => removeRow(sec, i)}
                    onUpdate={(i, patch) => updateRow(sec, i, patch)}
                    people={people}
                    evalCtx={evalCtx}
                    errors={errors}
                    sectionError={errors.get(`__section_${sec.id}`) ?? null}
                  />
                ) : (
                  sec.fields.map((f) => {
                    if (f.showIf && !evaluateLogicRule(f.showIf, evalCtx)) return null
                    return (
                      <FieldRow
                        key={f.id}
                        field={f}
                        value={values[f.id]}
                        onChange={(v) => setValue(f.id, v)}
                        error={errors.get(f.id)}
                        people={people}
                        evalCtx={evalCtx}
                        loading={pickerLoading.has(f.id)}
                      />
                    )
                  })
                )}
              </CardContent>
            </Card>
          )
        })
      )}
    </WizardLayout>
  )
}

// --- Repeating section -----------------------------------------------------

function RepeatingSection({
  section,
  rows,
  onAdd,
  onRemove,
  onUpdate,
  people,
  evalCtx,
  errors,
  sectionError,
}: {
  section: FormSection
  rows: Record<string, unknown>[]
  onAdd: () => void
  onRemove: (i: number) => void
  onUpdate: (i: number, patch: Record<string, unknown>) => void
  people: { id: string; firstName: string; lastName: string }[]
  evalCtx: EvalContext
  errors: Map<string, string>
  sectionError: string | null
}) {
  const max = section.maxRows
  const min = section.minRows ?? 0

  return (
    <div className="space-y-3">
      {sectionError ? (
        <Alert variant="destructive">
          <AlertDescription>{sectionError}</AlertDescription>
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No rows yet.
          {min > 0 ? ` At least ${min} required.` : ''}
        </p>
      ) : (
        rows.map((row, i) => {
          // Per-row eval context merges the row's own values atop the global
          // so showIf within the row can compare against its own fields.
          const rowCtx: EvalContext = {
            ...evalCtx,
            values: { ...evalCtx.values, ...row },
          }
          return (
            <div key={i} className="rounded-md border border-slate-200 bg-slate-50/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {formatRowLabel(section, i, row)}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-slate-400 hover:text-red-500"
                  title="Remove row"
                  disabled={rows.length <= min}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="space-y-3">
                {section.fields.map((f) => {
                  if (f.showIf && !evaluateLogicRule(f.showIf, rowCtx)) return null
                  return (
                    <FieldRow
                      key={f.id}
                      field={f}
                      value={row[f.id]}
                      onChange={(v) => onUpdate(i, { [f.id]: v })}
                      error={errors.get(`${section.id}.${i}.${f.id}`)}
                      people={people}
                      evalCtx={rowCtx}
                    />
                  )
                })}
              </div>
            </div>
          )
        })
      )}
      <Button
        variant="outline"
        onClick={onAdd}
        disabled={max !== undefined && rows.length >= max}
      >
        <Plus size={14} />
        Add row
      </Button>
    </div>
  )
}

// Format the section row header from the optional rowLabelTemplate.
// Supports `{index}`, `{index+1}`, and `{<fieldKey>}` interpolation.
function formatRowLabel(
  section: FormSection,
  index: number,
  row: Record<string, unknown>,
): string {
  const tmpl = section.rowLabelTemplate ?? `Row {index+1}`
  return tmpl
    .replace(/\{index\+1\}/g, String(index + 1))
    .replace(/\{index\}/g, String(index))
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      const v = row[key]
      return v === undefined || v === null ? '' : String(v)
    })
}

// --- Field row + input -----------------------------------------------------

function FieldRow({
  field,
  value,
  onChange,
  error,
  people,
  evalCtx,
  loading,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  error?: string
  people: { id: string; firstName: string; lastName: string }[]
  evalCtx: EvalContext
  // True when an `entity_attr` fetch is in flight for this picker. Renders
  // a tiny "Looking up…" hint next to the label so users don't think the
  // downstream entity-attr fields are broken during the 200ms round trip.
  loading?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label>
        {field.label?.en ?? field.id}
        {field.required || field.validation?.required ? (
          <span className="text-red-600"> *</span>
        ) : null}
        {loading ? (
          <span className="ml-2 text-[10px] font-normal text-slate-400">
            Looking up…
          </span>
        ) : null}
      </Label>
      {field.helpText?.en ? (
        <p className="text-xs text-slate-500">{field.helpText.en}</p>
      ) : null}
      <FieldInput field={field} value={value} onChange={onChange} people={people} evalCtx={evalCtx} />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
  people,
  evalCtx,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  people: { id: string; firstName: string; lastName: string }[]
  evalCtx: EvalContext
}) {
  // Formula fields are render-only: recompute the value on every render via
  // the evaluator and pass through to the display input. When the formula
  // resolves to null (e.g. an `entity_attr` whose picker is empty) we show
  // the optional `field.config.defaultDisplay` placeholder or an em-dash.
  if ((field.type === 'formula' || field.type === 'calc') && field.formula) {
    const computed = evaluateFormulaTree(field.formula as FormulaExpression, evalCtx)
    const fallback =
      (field.config?.defaultDisplay as string | undefined) ?? '—'
    const display =
      computed === null || computed === undefined || computed === ''
        ? fallback
        : String(computed)
    return (
      <Input
        value={display}
        disabled
        className="bg-slate-50 font-mono text-sm"
        title="Computed value — recomputed automatically"
      />
    )
  }

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'url':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'url' ? 'url' : 'text'}
        />
      )
    case 'textarea':
    case 'long_text':
      return <Textarea rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
    case 'rating':
      return (
        <Input
          type="number"
          value={(value as number | string) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      )
    case 'formula':
    case 'calc':
      // No formula configured — fall back to a read-only blank.
      return <Input disabled placeholder="(no formula)" />
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
    case 'multi_person_picker': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2 max-h-48 overflow-y-auto">
          {people.length === 0 ? (
            <p className="text-xs text-slate-500">No people available.</p>
          ) : (
            people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={arr.includes(p.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...arr, p.id]
                        : arr.filter((v) => v !== p.id),
                    )
                  }
                />
                {p.lastName}, {p.firstName}
              </label>
            ))
          )}
        </div>
      )
    }
    case 'site_picker':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="(site id — see top-of-form site picker)"
        />
      )
    case 'signature':
      return <SignatureField value={(value as string | null) ?? null} onChange={onChange} />
    case 'photo':
    case 'photo_upload':
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

// --- Field-level validation helper -----------------------------------------
//
// Mirrors the per-field rules from @beaconhs/forms-core validator so we can
// show inline errors on Next-button click without re-running the full
// schema-wide validator.

function validateOne(field: FormField, value: unknown): string | null {
  const v = field.validation
  const required = field.required || v?.required
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  if (required && isEmpty) return v?.message ?? 'Required'
  if (isEmpty) return null

  switch (field.type) {
    case 'number':
    case 'rating': {
      const n = Number(value)
      if (Number.isNaN(n)) return v?.message ?? 'Must be a number'
      if (v?.min !== undefined && n < v.min) return v?.message ?? `Must be >= ${v.min}`
      if (v?.max !== undefined && n > v.max) return v?.message ?? `Must be <= ${v.max}`
      return null
    }
    case 'text':
    case 'textarea':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url': {
      const s = String(value)
      if (v?.minLength && s.length < v.minLength) return v?.message ?? `Min ${v.minLength} chars`
      if (v?.maxLength && s.length > v.maxLength) return v?.message ?? `Max ${v.maxLength} chars`
      if (v?.pattern && !new RegExp(v.pattern).test(s)) return v?.message ?? 'Invalid format'
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return v?.message ?? 'Invalid email'
      if (field.type === 'url' && !/^https?:\/\/.+/.test(s)) return v?.message ?? 'Invalid URL'
      return null
    }
    default:
      return null
  }
}

// --- Signature -------------------------------------------------------------
//
// The signature pad lives in @beaconhs/ui and is being built by a parallel
// agent; we render the existing component and stash an {attachmentId, url}
// pair on the field value (the response viewer reads the url for display,
// the PDF renderer reads the attachmentId for embed).

function SignatureField({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: { attachmentId: string; url: string } | null) => void
}) {
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

// Re-export the type so the file is self-contained.
export type { LogicRule }
