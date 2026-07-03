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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Bold,
  Check,
  ClipboardList,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  CloudOff,
  Eye,
  Italic,
  Link as LinkIcon,
  List,
  MapPin,
  Minus,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  Input,
  Label,
  SearchSelect,
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
  type TableColumn,
  type TableConfig,
} from '@beaconhs/forms-core'
import {
  analyzePhotos,
  createDraftResponse,
  fetchEntityAttrs,
  listOrgUnitOptions,
  saveFormResponseDraft,
  submitFormResponse,
  updateResponseField,
} from './actions'
import type { SafetyVisionAnalysis } from '@beaconhs/ai'
import {
  aggregateDataSource,
  queryDataSource,
  type DataAggregateResult,
  type DataQueryResult,
  type DataRow,
} from '@/app/(app)/apps/_lib/data-sources'
import { SignaturePad } from '@/components/signature-pad'
import { SketchPad, type SketchScene } from '@/components/sketch-pad'
import { FileUpload, dataUrlToFile, type AttachedFile } from '@/components/file-upload'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { WizardLayout } from '@/components/page-layout'
import { PremiumSection } from '@/components/premium-section'
import { Section } from '@/components/section'
import { toast } from '@/lib/toast'
import { canvasCss, columnsCss, gridClass, resolveCanvas } from '@/app/(app)/apps/_lib/canvas'

type CurrentUser = {
  personId: string | null
  name: string | null
}

// Cycle a tasteful tone palette across the dynamic schema sections so the fill
// page gets the same premium, colorful section cards as the incident /
// hazard-assessment pages (which assign tones semantically per section).
const SECTION_TONES = [
  'teal',
  'blue',
  'purple',
  'amber',
  'indigo',
  'emerald',
  'rose',
  'slate',
] as const

// Read-only context — when true, custom (non-form-control) inputs that a
// disabled <fieldset> can't reach (signature/sketch canvases, the rich-text
// contentEditable) render static. Provided by FormRenderer in record/view mode.
const FillReadOnlyContext = createContext(false)

// Per-MOUNT cache of org-unit picker options, keyed by level. Deliberately
// React state (provided by FormRenderer), never module scope: a tenant switch
// remounts the page subtree, so a fresh mount refetches instead of serving the
// previous tenant's org units.
const OrgUnitOptionsCacheContext = createContext<Record<
  string,
  OrgUnitOption[] | undefined
> | null>(null)

export function FormRenderer({
  templateId,
  templateName,
  version,
  schema,
  sites,
  people,
  entitiesByField: initialEntitiesByField,
  currentUser,
  initialResponseId = null,
  initialValues = {},
  initialRows = {},
  initialStepIndex = 0,
  isResumed = false,
  returnTo = null,
  readOnly = false,
  responseStatus = null,
  reviewHref = null,
  inlineAutosave = false,
}: {
  templateId: string
  templateName: string
  version: number
  schema: FormSchemaV1
  sites: { id: string; name: string }[]
  people: { id: string; firstName: string; lastName: string; employeeNo?: string | null }[]
  // Per-picker entity-attribute maps preloaded server-side. Keyed by picker
  // field id (NOT entity id) so the runtime can pick up the right map by
  // field key in the evaluator. The client refreshes individual entries via
  // `fetchEntityAttrs` when a picker selection changes.
  entitiesByField: EntityAttrsByField
  currentUser: CurrentUser
  // Autosave resume-path props. When non-null the renderer hydrates with the
  // saved draft state and continues writing against the same response id.
  initialResponseId?: string | null
  initialValues?: Record<string, unknown>
  initialRows?: Record<string, Array<Record<string, unknown>>>
  initialStepIndex?: number
  // True when we successfully resumed a saved draft — drives the "Welcome
  // back, your draft was restored" toast on mount.
  isResumed?: boolean
  returnTo?: string | null
  // When true, render as a read-only record: every input disabled, the
  // submit/next footer hidden, autosave suppressed. Drives the unified record
  // page for submitted entries / view-only users.
  readOnly?: boolean
  // The response's status — shown in the read-only banner ("submitted", …).
  responseStatus?: string | null
  // Admin review surface (CAPA/comments/audit) for this response, shown as a
  // "Review" header action. Null hides it (no responseId or no permission).
  reviewHref?: string | null
  // Opt-in INLINE editing mode (native LiveField parity). When true the
  // renderer drops the wizard stepper / footer / DetailHeader entirely and
  // renders every section as a vertical stack of self-autosaving fields, each
  // writing one key to the canonical `data` via `updateResponseField`. The
  // parent page owns all chrome. `initialResponseId` is always present here.
  inlineAutosave?: boolean
}) {
  // Per-step progress so users can click back into completed steps.
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  // Per-mount org-unit options cache shared by every org-unit picker in this
  // render tree (see OrgUnitOptionsCacheContext).
  const [orgUnitOptionsCache] = useState<Record<string, OrgUnitOption[] | undefined>>(() => ({}))
  const [stepIndex, setStepIndex] = useState(initialStepIndex)
  // Presentational tabs (single-step apps only). activeTabId drives which tab's
  // sections render; validation still spans every tab.
  const appTabs = schema.tabs ?? []
  const [activeTabId, setActiveTabId] = useState(appTabs[0]?.id ?? '')
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [rowsByStep, setRowsByStep] =
    useState<Record<string, Record<string, unknown>[]>>(initialRows)
  const [siteId, setSiteId] = useState<string | ''>('')
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // High-contrast, large-type "field mode" for direct sunlight. Persisted.
  const [fieldMode, setFieldMode] = useState(false)
  const appliedDefaults = useRef<Set<string>>(new Set())

  // Restore the persisted field-mode preference on mount, and expose a toggle.
  useEffect(() => {
    try {
      setFieldMode(localStorage.getItem('bhs_field_mode') === '1')
    } catch {
      /* storage unavailable — default off */
    }
  }, [])
  const toggleFieldMode = useCallback(() => {
    setFieldMode((on) => {
      const next = !on
      try {
        localStorage.setItem('bhs_field_mode', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // --- Autosave state -------------------------------------------------------
  //
  // `responseId` is the row we're writing against on each draft save. It's
  // null until the user makes a content change AND `createDraftResponse`
  // returns — see the dirty-tracking effect below. Once non-null, every
  // subsequent save updates the same row.
  const [responseId, setResponseId] = useState<string | null>(initialResponseId)
  // 'idle' before any change; 'pending' during in-flight save; 'saved' on
  // success; 'error' on failure. Drives the indicator in the header.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Tick state so "Saved Xs ago" updates without us calling render every
  // change. Bumped every 5s by an effect once a save has happened.
  const [, setSavedTick] = useState(0)
  // Tracks whether the user has actually interacted with the form. Stops us
  // from creating empty draft rows on a page that's just been opened (a
  // requirement: "Don't save if the user hasn't typed anything"). Always
  // starts false — a resumed draft already has its state persisted, so no
  // beacon-on-unload is needed until the user actually changes something.
  const dirtyRef = useRef<boolean>(false)
  // Whether a draft-creation request is in flight. Guards against double
  // inserts when changes arrive faster than the create round-trip.
  const creatingRef = useRef<boolean>(false)
  // The latest values + rows + stepIndex, captured in a ref so the
  // beforeunload handler can read them synchronously without re-binding.
  const latestRef = useRef<{
    values: Record<string, unknown>
    rows: Record<string, Array<Record<string, unknown>>>
    stepIndex: number
    responseId: string | null
  }>({
    values: initialValues,
    rows: initialRows,
    stepIndex: initialStepIndex,
    responseId: initialResponseId,
  })
  // Per-picker entity attribute maps, fed into the evaluator on every render
  // so `entity_attr` formula fields stay live. Refreshed via the
  // fetchEntityAttrs server action whenever a picker's value changes.
  const [entitiesByField, setEntitiesByField] = useState<EntityAttrsByField>(initialEntitiesByField)
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
  // Tabs apply to single-step apps (multi-step wizards keep their own nav). We
  // filter only the RENDERED sections — validation still spans every tab.
  const tabbed = appTabs.length >= 2 && totalSteps === 1
  const renderedSections = tabbed
    ? stepSections.filter((s) => (s.tabId ?? appTabs[0]!.id) === activeTabId)
    : stepSections

  // Build the eval context used by visibility + formula evaluation. Includes
  // every section's rows under its section id so cross-step sum_section works,
  // and the per-picker entity-attr maps that `entity_attr` reads from.
  const evalCtx = useMemo<EvalContext>(() => {
    const requestContext = {
      now: new Date(),
      currentUserPersonId: currentUser.personId,
      currentUserName: currentUser.name,
    }
    // Materialize per-row computed (formula/calc) fields into the rows the
    // evaluator sees, so `sum_section` / `avg_section` can roll up a computed
    // column. Consistent with the read-time-projection model: computed values
    // are never persisted (buildPayload uses the raw rows) — only derived here
    // for evaluation + display. Pure derivation, so no setState / loop risk.
    const materializedRows: Record<string, Array<Record<string, unknown>>> = {}
    for (const sec of schema.sections) {
      if (!sec.repeating) continue
      const raw = rowsByStep[sec.id] ?? []
      const formulaFields = sec.fields.filter(
        (f) => (f.type === 'formula' || f.type === 'calc') && f.formula,
      )
      if (formulaFields.length === 0) {
        materializedRows[sec.id] = raw
        continue
      }
      materializedRows[sec.id] = raw.map((row) => {
        const rowCtx: EvalContext = {
          values: { ...values, ...row },
          rows: rowsByStep,
          entities: entitiesByField,
          requestContext,
        }
        const merged: Record<string, unknown> = { ...row }
        for (const f of formulaFields) {
          const computed = evaluateFormulaTree(f.formula as FormulaExpression, rowCtx)
          if (computed !== null && computed !== undefined) merged[f.id] = computed
        }
        return merged
      })
    }
    // Carry through any rows for sections not in the schema (defensive).
    for (const [k, v] of Object.entries(rowsByStep)) {
      if (!(k in materializedRows)) materializedRows[k] = v
    }
    return { values, rows: materializedRows, entities: entitiesByField, requestContext }
  }, [values, rowsByStep, entitiesByField, currentUser, schema])

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

  // --- Autosave -------------------------------------------------------------
  //
  // Keep the latest values/rows/step in a ref so the beforeunload handler can
  // read them synchronously when the browser is tearing down.
  useEffect(() => {
    latestRef.current = {
      values,
      rows: rowsByStep,
      stepIndex,
      responseId,
    }
  }, [values, rowsByStep, stepIndex, responseId])

  // Surface a one-shot toast when we resumed from a saved draft so the user
  // understands they're not on a fresh form.
  useEffect(() => {
    if (isResumed) {
      toast.success('Draft restored — pick up where you left off')
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick "Saved Xs ago" every 5s once a save has happened so the label
  // stays current without re-saving.
  useEffect(() => {
    if (!lastSavedAt) return
    const t = setInterval(() => setSavedTick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [lastSavedAt])

  // Core save helper. Centralised so the debounced effect, step navigation,
  // and the retry-on-click path all share one implementation. Returns true
  // on a successful save.
  const persistDraft = useCallback(
    async (args: {
      values: Record<string, unknown>
      rows: Record<string, Array<Record<string, unknown>>>
      stepIndex: number
    }): Promise<boolean> => {
      // Lazily create a draft row on the first save. If the create-call
      // races with another save, just wait it out by skipping this round —
      // the next debounce tick will hit the now-set responseId.
      let id = latestRef.current.responseId
      if (!id) {
        if (creatingRef.current) return false
        creatingRef.current = true
        try {
          const res = await createDraftResponse({ templateId })
          if (!res.ok) {
            setSaveStatus('error')
            setSaveError(res.error)
            return false
          }
          id = res.responseId
          setResponseId(id)
          latestRef.current.responseId = id
        } finally {
          creatingRef.current = false
        }
      }
      setSaveStatus('pending')
      setSaveError(null)
      const res = await saveFormResponseDraft({
        responseId: id,
        values: args.values,
        rows: args.rows,
        stepIndex: args.stepIndex,
      })
      if (!res.ok) {
        setSaveStatus('error')
        setSaveError(res.error)
        return false
      }
      setSaveStatus('saved')
      setLastSavedAt(new Date(res.savedAt))
      // Clear dirty so the unload handler doesn't beacon a no-op. The next
      // user change calls markDirty() to flip it back on.
      dirtyRef.current = false
      return true
    },
    [templateId],
  )

  // Debounced autosave on any values / rows / step change. The 1500ms delay
  // is the spec; each new change cancels and reschedules. We also gate on
  // dirtyRef so the very first render (just hydrated state) doesn't trigger
  // a no-op save.
  useEffect(() => {
    if (!dirtyRef.current) return
    const handle = setTimeout(() => {
      void persistDraft({ values, rows: rowsByStep, stepIndex })
    }, 1500)
    return () => clearTimeout(handle)
  }, [values, rowsByStep, stepIndex, persistDraft])

  // Save-on-unload. Uses navigator.sendBeacon — only this API reliably
  // delivers a POST as the document unloads. Best-effort: failure is
  // silent (the in-app autosave will have run on the previous keystroke).
  useEffect(() => {
    function handleUnload() {
      if (!dirtyRef.current) return
      const { values: v, rows, stepIndex: si, responseId: rid } = latestRef.current
      if (!rid) return // No draft row yet — nothing to persist to.
      try {
        const payload = JSON.stringify({
          responseId: rid,
          values: v,
          rows,
          stepIndex: si,
        })
        const blob = new Blob([payload], { type: 'application/json' })
        navigator.sendBeacon?.('/api/apps/draft-save', blob)
      } catch {
        // Swallow — there's nothing we can do mid-unload.
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    // visibilitychange catches the "switched apps on mobile" case where
    // beforeunload doesn't fire reliably.
    function handleVisibility() {
      if (document.visibilityState === 'hidden') handleUnload()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  function markDirty() {
    // In read-only mode nothing is editable; never flip dirty so autosave +
    // the unload beacon stay silent.
    if (readOnly) return
    if (!dirtyRef.current) dirtyRef.current = true
  }

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
    markDirty()
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
    markDirty()
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
    setRows(
      section.id,
      rows.filter((_, i) => i !== idx),
    )
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
          errs.set(
            `__section_${sec.id}`,
            `Add at least ${sec.minRows} row${sec.minRows === 1 ? '' : 's'}`,
          )
        }
        for (let i = 0; i < rows.length; i++) {
          for (const f of sec.fields) {
            // Per-row visibility is evaluated against the row's own values.
            const rowCtx: EvalContext = { ...evalCtx, values: { ...evalCtx.values, ...rows[i] } }
            if (f.showIf && !evaluateLogicRule(f.showIf, rowCtx)) continue
            // Computed fields are derived, never user-validated.
            if (f.type === 'formula' || f.type === 'calc') continue
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

  // Save-before-navigation. Best-effort and time-boxed: the user shouldn't
  // be blocked by a slow save when they want to switch steps. If the save
  // hasn't returned in 500ms we proceed anyway — the next debounce tick
  // will catch up on the new step.
  async function saveBeforeNavigation(targetStepIndex: number) {
    if (!dirtyRef.current || !responseId) return
    const savePromise = persistDraft({
      values,
      rows: rowsByStep,
      stepIndex: targetStepIndex,
    })
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 500),
    )
    const result = await Promise.race([savePromise, timeoutPromise])
    if (result === false) {
      // persistDraft already set saveStatus/saveError; show a toast so the
      // user knows their navigation succeeded but the save lagged.
      toast.error('Could not save before navigation — will retry')
    }
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
    const target = Math.min(totalSteps - 1, stepIndex + 1)
    void saveBeforeNavigation(target)
    setStepIndex(target)
  }

  function back() {
    const target = Math.max(0, stepIndex - 1)
    void saveBeforeNavigation(target)
    setStepIndex(target)
    setErrors(new Map())
  }

  function jumpTo(i: number) {
    // Allow jumping to completed steps + the current step. Anything later is
    // gated by per-step validation.
    if (i === stepIndex) return
    if (i < stepIndex || completedSteps.has(steps[i]!.key)) {
      void saveBeforeNavigation(i)
      setStepIndex(i)
      setErrors(new Map())
    }
  }

  // Jump to the tab that owns a field id (so submit errors are never hidden
  // behind an inactive tab).
  function switchToFieldTab(fieldId: string | undefined) {
    if (!tabbed || !fieldId) return
    const owner = stepSections.find((s) => s.fields.some((f) => f.id === fieldId))
    if (owner) setActiveTabId(owner.tabId ?? appTabs[0]!.id)
  }

  function submit() {
    setServerError(null)
    const stepErrs = validateCurrentStep()
    if (stepErrs.size > 0) {
      setErrors(stepErrs)
      switchToFieldTab(stepErrs.keys().next().value)
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
      // Walk back to the first step (or tab) with an error.
      const firstSection = globalErrs[0]!.sectionId
      if (firstSection) {
        const ownerSec = schema.sections.find((s) => s.id === firstSection)
        if (ownerSec) {
          if (tabbed) {
            setActiveTabId(ownerSec.tabId ?? appTabs[0]!.id)
          } else {
            const targetStepKey = ownerSec.step ?? steps[0]!.key
            const idx = steps.findIndex((s) => s.key === targetStepKey)
            if (idx >= 0) setStepIndex(idx)
          }
        }
      }
      return
    }
    start(async () => {
      const res = await submitFormResponse({
        templateId,
        data: payload,
        siteOrgUnitId: siteId || null,
        // Pass the in-flight draft id (if any) so the server finalizes that
        // row in-place rather than inserting a duplicate.
        responseId,
        returnTo,
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
        // Clear dirty so the unload-handler doesn't try to overwrite our
        // freshly-submitted row with a stale draft payload.
        dirtyRef.current = false
        toast.success('Form submitted')
      }
      // ok-path navigates via server redirect.
    })
  }

  const completion = Math.round(((stepIndex + 1) / Math.max(1, totalSteps)) * 100)

  // --- Inline autosave mode -------------------------------------------------
  //
  // An opt-in body that REPLACES the wizard (no stepper, no footer, no
  // DetailHeader — the parent page owns chrome). Renders every section as a
  // vertical stack; each visible field saves itself via `updateResponseField`.
  // Repeating sections + `table` fields persist their WHOLE array on any row
  // add/remove/cell change. Computed/static elements never save.
  if (inlineAutosave) {
    // `initialResponseId` is always present in this mode (the parent page
    // creates/loads the row). Fall back to live `responseId` defensively.
    const rid = (initialResponseId ?? responseId) as string

    // Persist one top-level field (scalar/array/object) by its id, validating
    // first. Returns void; the per-field hook owns the status indicator.
    const saveField = (field: FormField, v: unknown) => {
      const err = validateOne(field, v)
      setErrors((m) => {
        const next = new Map(m)
        if (err) next.set(field.id, err)
        else next.delete(field.id)
        return next
      })
      if (err) return Promise.resolve<{ ok: boolean; error?: string }>({ ok: false, error: err })
      return updateResponseField({ responseId: rid, fieldId: field.id, value: v })
    }

    // Persist a whole repeating-section / table array under its id (no
    // per-field validation — submit-time still runs full validation).
    const saveArray = (id: string, arr: unknown) =>
      updateResponseField({ responseId: rid, fieldId: id, value: arr })

    // Presentational content tabs (same model as the wizard/fill path). When
    // the app authored 2+ tabs, render a tab bar and show only the active
    // tab's sections. Sections with no `tabId` belong to the first tab —
    // mirrors the wizard filter exactly.
    const inlineTabbed = appTabs.length >= 2
    const inlineSections = inlineTabbed
      ? schema.sections.filter((s) => (s.tabId ?? appTabs[0]!.id) === activeTabId)
      : schema.sections

    return (
      <FillReadOnlyContext.Provider value={readOnly}>
        <OrgUnitOptionsCacheContext.Provider value={orgUnitOptionsCache}>
          <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-5 border-0 p-0">
            {inlineTabbed ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2 dark:border-slate-800">
                {appTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTabId(t.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      t.id === activeTabId
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {t.title?.en ?? t.id}
                  </button>
                ))}
              </div>
            ) : null}
            {inlineSections.map((sec) => {
              if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) return null
              return (
                <Section
                  key={sec.id}
                  title={sec.title?.en ?? sec.id}
                  subtitle={
                    sec.description?.en ?? (sec.repeating ? 'Repeatable section' : undefined)
                  }
                >
                  <div className="space-y-4">
                    {sec.repeating ? (
                      <RepeatingSection
                        section={sec}
                        rows={rowsByStep[sec.id] ?? []}
                        onAdd={() => {
                          addRow(sec)
                          // addRow mutates state async; persist the resulting array.
                          const existing = rowsByStep[sec.id] ?? []
                          if (sec.maxRows !== undefined && existing.length >= sec.maxRows) return
                          const next: Record<string, unknown> = {}
                          for (const f of sec.fields) {
                            if (!f.defaultValue) continue
                            const dv = resolveDefaultValue(
                              f.defaultValue as DefaultValueExpression,
                              evalCtx,
                            )
                            if (dv !== undefined && dv !== null) next[f.id] = dv
                          }
                          void saveArray(sec.id, [...existing, next])
                        }}
                        onRemove={(i) => {
                          removeRow(sec, i)
                          const arr = (rowsByStep[sec.id] ?? []).filter((_, idx) => idx !== i)
                          void saveArray(sec.id, arr)
                        }}
                        onUpdate={(i, patch) => {
                          updateRow(sec, i, patch)
                          const arr = (rowsByStep[sec.id] ?? []).map((r, idx) =>
                            idx === i ? { ...r, ...patch } : r,
                          )
                          void saveArray(sec.id, arr)
                        }}
                        people={people}
                        evalCtx={evalCtx}
                        errors={errors}
                        sectionError={errors.get(`__section_${sec.id}`) ?? null}
                      />
                    ) : (
                      sec.fields.map((f) => {
                        if (f.showIf && !evaluateLogicRule(f.showIf, evalCtx)) return null
                        return (
                          <InlineFieldRow
                            key={f.id}
                            field={f}
                            value={values[f.id]}
                            onChange={(v) => setValue(f.id, v)}
                            setFieldValue={setValue}
                            error={errors.get(f.id)}
                            people={people}
                            evalCtx={evalCtx}
                            loading={pickerLoading.has(f.id)}
                            readOnly={readOnly}
                            saveField={saveField}
                            saveArray={saveArray}
                          />
                        )
                      })
                    )}
                  </div>
                </Section>
              )
            })}
          </fieldset>
        </OrgUnitOptionsCacheContext.Provider>
      </FillReadOnlyContext.Provider>
    )
  }

  // Single-step apps + any read-only view render with a native DetailHeader
  // (like the hazard/incident detail pages). Multi-step editing keeps the
  // wizard header (with its step progress strip).
  const recordLayout = readOnly || totalSteps === 1
  const reviewLink = reviewHref ? (
    <Link href={reviewHref}>
      <Button variant="outline" size="sm">
        <Eye size={14} /> Review
      </Button>
    </Link>
  ) : null

  return (
    <FillReadOnlyContext.Provider value={readOnly}>
      <OrgUnitOptionsCacheContext.Provider value={orgUnitOptionsCache}>
        <WizardLayout
          className={`ff-surface ${fieldMode ? 'field-mode' : ''}`}
          wide={readOnly}
          header={
            recordLayout ? (
              <DetailHeader
                back={{
                  href: returnTo ?? `/apps/templates/${templateId}/records`,
                  label: returnTo ? 'Back to assessment' : 'Back',
                }}
                title={templateName}
                subtitle={
                  initialResponseId
                    ? `${initialResponseId.slice(0, 8)} · v${version}`
                    : `v${version}`
                }
                badge={
                  readOnly ? (
                    responseStatus ? (
                      <Badge variant="secondary">{responseStatus.replace(/_/g, ' ')}</Badge>
                    ) : null
                  ) : (
                    <SaveStatus
                      status={saveStatus}
                      lastSavedAt={lastSavedAt}
                      error={saveError}
                      onRetry={() => {
                        void persistDraft({ values, rows: rowsByStep, stepIndex })
                      }}
                    />
                  )
                }
                actions={
                  <>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={toggleFieldMode}
                        aria-pressed={fieldMode}
                        title="High-contrast field mode"
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                          fieldMode
                            ? 'border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-500 dark:bg-amber-900/40 dark:text-amber-200'
                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                        }`}
                      >
                        <Sun size={15} />
                      </button>
                    ) : null}
                    {reviewLink}
                  </>
                }
              />
            ) : (
              <div className="space-y-3">
                <Link
                  href={returnTo ?? `/apps/templates/${templateId}/records`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
                >
                  <ChevronLeft size={13} /> {returnTo ? 'Back to assessment' : 'Back'}
                </Link>
                <div className="flex items-center justify-between gap-2">
                  <h1 className="truncate text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {templateName}
                  </h1>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleFieldMode}
                      aria-pressed={fieldMode}
                      title="High-contrast field mode"
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                        fieldMode
                          ? 'border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-500 dark:bg-amber-900/40 dark:text-amber-200'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      <Sun size={15} />
                    </button>
                    <SaveStatus
                      status={saveStatus}
                      lastSavedAt={lastSavedAt}
                      error={saveError}
                      onRetry={() => {
                        void persistDraft({ values, rows: rowsByStep, stepIndex })
                      }}
                    />
                    <Badge variant="outline">v{version}</Badge>
                    {reviewLink}
                  </div>
                </div>
                {/* Progress strip — every workflow step as a clickable pill. Hidden
              on single-step apps (e.g. the Lift Plan), where a one-pill strip
              + progress bar is just noise and makes the header needlessly tall. */}
                {totalSteps > 1 ? (
                  <>
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
                              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                                isCurrent
                                  ? 'border-teal-600 bg-teal-600 text-white'
                                  : isCompleted
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300'
                                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                              } ${!isClickable ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              <span
                                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                                  isCurrent
                                    ? 'bg-white text-teal-700'
                                    : isCompleted
                                      ? 'bg-emerald-500 text-white'
                                      : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
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
                    <div className="h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-teal-600 transition-all"
                        style={{ width: `${Math.max(8, completion)}%` }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            )
          }
          footer={
            readOnly ? undefined : (
              <div className="space-y-2">
                {serverError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Submit failed</AlertTitle>
                    <AlertDescription>{serverError}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={back}
                    disabled={stepIndex === 0}
                    className="h-12 px-4"
                  >
                    <ChevronLeft size={16} />
                    Back
                  </Button>
                  {stepIndex < totalSteps - 1 ? (
                    <Button onClick={next} size="lg" className="h-12 flex-1 text-base">
                      Next <ChevronRight size={16} />
                    </Button>
                  ) : (
                    <Button
                      onClick={submit}
                      disabled={pending}
                      size="lg"
                      className="h-12 flex-1 text-base"
                    >
                      <Check size={16} />
                      {pending ? 'Submitting…' : 'Submit'}
                    </Button>
                  )}
                </div>
              </div>
            )
          }
        >
          {readOnly ? (
            <Alert variant="warning">
              <AlertTitle>View only</AlertTitle>
              <AlertDescription>
                {responseStatus
                  ? `This entry is ${responseStatus.replace(/_/g, ' ')}. You don't have permission to edit it.`
                  : "You don't have permission to edit this entry."}
              </AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-5 border-0 p-0">
            {stepIndex === 0 ? (
              <PremiumSection
                title="Site"
                subtitle="Where this is being recorded"
                icon={<MapPin size={20} />}
                tone="teal"
              >
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
              </PremiumSection>
            ) : null}

            {tabbed ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2 dark:border-slate-800">
                {appTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTabId(t.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      t.id === activeTabId
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {t.title?.en ?? t.id}
                  </button>
                ))}
              </div>
            ) : null}

            {renderedSections.length === 0 ? (
              <PremiumSection
                title={step.title?.en ?? step.key}
                icon={<ClipboardList size={20} />}
                tone="slate"
              >
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {tabbed
                    ? 'This tab has no sections.'
                    : 'No sections bound to this step. Submit to finalise.'}
                </p>
              </PremiumSection>
            ) : (
              renderedSections.map((sec, i) => {
                // Section-level visibility — completely hide the section if showIf
                // is false against the current values.
                if (sec.showIf && !evaluateLogicRule(sec.showIf, evalCtx)) return null
                return (
                  <PremiumSection
                    key={sec.id}
                    title={sec.title?.en ?? sec.id}
                    subtitle={
                      sec.description?.en ?? (sec.repeating ? 'Repeatable section' : undefined)
                    }
                    icon={<ClipboardList size={20} />}
                    tone={SECTION_TONES[i % SECTION_TONES.length]}
                    count={sec.repeating ? (rowsByStep[sec.id]?.length ?? 0) : undefined}
                  >
                    <div className="space-y-4">
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
                      ) : sec.canvas ? (
                        (() => {
                          const cls = gridClass(sec.id)
                          const canvas = sec.canvas
                          const visible = sec.fields.filter(
                            (f) => !f.showIf || evaluateLogicRule(f.showIf, evalCtx),
                          )
                          const { order, byId } = resolveCanvas(
                            visible.map((f) => f.id),
                            canvas.items,
                            canvas.cols,
                          )
                          const byField = new Map(visible.map((f) => [f.id, f]))
                          return (
                            <div className={cls}>
                              <style>{canvasCss(cls, canvas.cols, canvas.rowHeight, byId)}</style>
                              {order.map((id) => {
                                const f = byField.get(id)!
                                return (
                                  <div key={id} data-ci={id}>
                                    <FieldRow
                                      field={f}
                                      value={values[f.id]}
                                      onChange={(v) => setValue(f.id, v)}
                                      setFieldValue={setValue}
                                      error={errors.get(f.id)}
                                      people={people}
                                      evalCtx={evalCtx}
                                      loading={pickerLoading.has(f.id)}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()
                      ) : sec.layout && sec.layout.columns > 1 ? (
                        (() => {
                          const cls = gridClass(sec.id)
                          const cols = sec.layout.columns
                          const visible = sec.fields.filter(
                            (f) => !f.showIf || evaluateLogicRule(f.showIf, evalCtx),
                          )
                          const css = columnsCss(
                            cls,
                            cols,
                            visible.map((f) => ({ id: f.id, span: f.colSpan ?? cols })),
                          )
                          return (
                            <div className={cls}>
                              <style>{css}</style>
                              {visible.map((f) => (
                                <div key={f.id} data-cs={f.id}>
                                  <FieldRow
                                    field={f}
                                    value={values[f.id]}
                                    onChange={(v) => setValue(f.id, v)}
                                    setFieldValue={setValue}
                                    error={errors.get(f.id)}
                                    people={people}
                                    evalCtx={evalCtx}
                                    loading={pickerLoading.has(f.id)}
                                  />
                                </div>
                              ))}
                            </div>
                          )
                        })()
                      ) : (
                        sec.fields.map((f) => {
                          if (f.showIf && !evaluateLogicRule(f.showIf, evalCtx)) return null
                          return (
                            <FieldRow
                              key={f.id}
                              field={f}
                              value={values[f.id]}
                              onChange={(v) => setValue(f.id, v)}
                              setFieldValue={setValue}
                              error={errors.get(f.id)}
                              people={people}
                              evalCtx={evalCtx}
                              loading={pickerLoading.has(f.id)}
                            />
                          )
                        })
                      )}
                    </div>
                  </PremiumSection>
                )
              })
            )}
          </fieldset>
        </WizardLayout>
      </OrgUnitOptionsCacheContext.Provider>
    </FillReadOnlyContext.Provider>
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
  people: { id: string; firstName: string; lastName: string; employeeNo?: string | null }[]
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
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No rows.
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
            <div
              key={i}
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  {formatRowLabel(section, i, row)}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="ff-chip flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-950/40"
                  title="Remove"
                  disabled={rows.length <= min}
                >
                  <Trash2 size={16} />
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
                      setFieldValue={(id, v) => onUpdate(i, { [id]: v })}
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
        size="lg"
        onClick={onAdd}
        disabled={max !== undefined && rows.length >= max}
        className="ff-chip h-12 w-full border-dashed"
      >
        <Plus size={16} />
        Add row
      </Button>
    </div>
  )
}

// Format the section row header from the optional rowLabelTemplate.
// Supports `{index}`, `{index+1}`, and `{<fieldKey>}` interpolation.
function formatRowLabel(section: FormSection, index: number, row: Record<string, unknown>): string {
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
  setFieldValue,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  error?: string
  people: { id: string; firstName: string; lastName: string; employeeNo?: string | null }[]
  evalCtx: EvalContext
  // True when an `entity_attr` fetch is in flight for this picker. Renders
  // a tiny "Looking up…" hint next to the label so users don't think the
  // downstream entity-attr fields are broken during the 200ms round trip.
  loading?: boolean
  // Sibling-field setter — used by `lookup` auto-fill to write the picked
  // row's columns into other fields. Scoped to the current repeating row when
  // rendered inside one.
  setFieldValue?: (fieldId: string, v: unknown) => void
}) {
  return (
    <div className="space-y-1">
      <Label>
        {field.label?.en ?? field.id}
        {field.required || field.validation?.required ? (
          <span className="text-red-600"> *</span>
        ) : null}
        {loading ? (
          <span className="ml-2 text-[10px] font-normal text-slate-400">Looking up…</span>
        ) : null}
      </Label>
      {field.helpText?.en ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{field.helpText.en}</p>
      ) : null}
      <FieldInput
        field={field}
        value={value}
        onChange={onChange}
        people={people}
        evalCtx={evalCtx}
        setFieldValue={setFieldValue}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

// --- Inline autosave field (LiveField parity) ------------------------------
//
// Render-only element types that hold no value and must never trigger a save
// in inline mode. Their FieldInput render path is purely presentational.
const INLINE_NON_SAVING_TYPES = new Set([
  'formula',
  'calc',
  'metric',
  'heading',
  'paragraph',
  'divider',
  'image',
])

type InlineSaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Per-field autosave hook for inline mode — modelled on live-field.tsx
 * `useAutoSave` but value-agnostic: it accepts any JSON `value: unknown` and
 * persists it through a caller-supplied saver (which wires the right
 * `updateResponseField` payload). Coalesces while a save is in flight and
 * re-saves the latest value when the previous round-trip returns.
 */
// Sentinel so the very first save always runs even when the value is undefined.
const UNSAVED = Symbol('unsaved')

function useFieldAutosave(saver: (value: unknown) => Promise<{ ok: boolean; error?: string }>) {
  const [state, setState] = useState<InlineSaveState>('idle')
  const [, start] = useTransition()
  const latest = useRef<unknown>(undefined)
  const saved = useRef<unknown>(UNSAVED)
  const inFlight = useRef(false)
  const saverRef = useRef(saver)
  useEffect(() => {
    saverRef.current = saver
  }, [saver])

  const save = useCallback((value: unknown) => {
    latest.current = value
    if (inFlight.current) return
    inFlight.current = true
    setState('saving')
    start(async () => {
      let ok = true
      // Drain: keep persisting until the newest value is saved (the user may
      // have typed more while a round-trip was in flight). A loop, not
      // recursion, so the callback never references itself before declaration.
      while (latest.current !== saved.current) {
        const v = latest.current
        try {
          const res = await saverRef.current(v)
          if (!res.ok) {
            ok = false
            break
          }
          saved.current = v
        } catch {
          ok = false
          break
        }
      }
      inFlight.current = false
      if (ok) {
        setState('saved')
        setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2000)
      } else {
        setState('error')
      }
    })
  }, [])

  return { state, save }
}

function InlineSaveDot({ state }: { state: InlineSaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={
        state === 'saving'
          ? 'text-[11px] font-medium text-slate-400'
          : state === 'saved'
            ? 'text-[11px] font-medium text-emerald-600'
            : 'text-[11px] font-medium text-red-600'
      }
    >
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Not saved — retry'}
    </span>
  )
}

/**
 * Inline-mode field wrapper. Reuses the exact `FieldInput` control but
 * autosaves THIS field on its own: debounce ~800ms after a change + save on
 * blur. `table` fields persist their whole array; render-only element types
 * never save. The per-field status dot mirrors live-field.tsx.
 */
function InlineFieldRow({
  field,
  value,
  onChange,
  setFieldValue,
  error,
  people,
  evalCtx,
  loading,
  readOnly,
  saveField,
  saveArray,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  setFieldValue?: (fieldId: string, v: unknown) => void
  error?: string
  people: { id: string; firstName: string; lastName: string; employeeNo?: string | null }[]
  evalCtx: EvalContext
  loading?: boolean
  readOnly: boolean
  // Saves one top-level field (validates first). Resolves to {ok}.
  saveField: (field: FormField, v: unknown) => Promise<{ ok: boolean; error?: string }>
  // Saves a whole array (table / repeating) by id. Resolves to {ok}.
  saveArray: (id: string, arr: unknown) => Promise<{ ok: boolean; error?: string }>
}) {
  const nonSaving = INLINE_NON_SAVING_TYPES.has(field.type)
  const isTable = field.type === 'table'

  const { state, save } = useFieldAutosave(
    useCallback(
      (v: unknown) => (isTable ? saveArray(field.id, v) : saveField(field, v)),
      [isTable, field, saveField, saveArray],
    ),
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function commit(v: unknown) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (readOnly || nonSaving) return
    save(v)
  }

  function handleChange(v: unknown) {
    onChange(v)
    if (readOnly || nonSaving) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(v), 800)
  }

  return (
    <div className="space-y-1" onBlur={() => commit(value)}>
      <div className="flex items-center justify-between gap-2">
        <Label>
          {field.label?.en ?? field.id}
          {field.required || field.validation?.required ? (
            <span className="text-red-600"> *</span>
          ) : null}
          {loading ? (
            <span className="ml-2 text-[10px] font-normal text-slate-400">Looking up…</span>
          ) : null}
        </Label>
        {nonSaving ? null : <InlineSaveDot state={state} />}
      </div>
      {field.helpText?.en ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{field.helpText.en}</p>
      ) : null}
      <FieldInput
        field={field}
        value={value}
        onChange={handleChange}
        people={people}
        evalCtx={evalCtx}
        setFieldValue={setFieldValue}
      />
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
  setFieldValue,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  people: { id: string; firstName: string; lastName: string; employeeNo?: string | null }[]
  evalCtx: EvalContext
  setFieldValue?: (fieldId: string, v: unknown) => void
}) {
  // Formula fields are render-only: recompute the value on every render via
  // the evaluator and pass through to the display input. When the formula
  // resolves to null (e.g. an `entity_attr` whose picker is empty) we show
  // the optional `field.config.defaultDisplay` placeholder or an em-dash.
  if ((field.type === 'formula' || field.type === 'calc') && field.formula) {
    const computed = evaluateFormulaTree(field.formula as FormulaExpression, evalCtx)
    const fallback = (field.config?.defaultDisplay as string | undefined) ?? '—'
    const display =
      computed === null || computed === undefined || computed === '' ? fallback : String(computed)
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
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : field.type === 'url'
                  ? 'url'
                  : 'text'
          }
          inputMode={
            field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : field.type === 'url'
                  ? 'url'
                  : 'text'
          }
          autoComplete={
            field.type === 'email'
              ? 'email'
              : field.type === 'phone'
                ? 'tel'
                : field.type === 'url'
                  ? 'url'
                  : 'off'
          }
          enterKeyHint="next"
        />
      )
    case 'textarea':
    case 'long_text':
      return (
        <Textarea
          rows={3}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return <NumberStepper field={field} value={value} onChange={onChange} />
    case 'rating':
      return <RatingButtons field={field} value={value} onChange={onChange} />
    case 'slider': {
      const c = (field.config ?? {}) as { min?: number; max?: number; step?: number; unit?: string }
      const min = c.min ?? 0
      const max = c.max ?? 10
      const step = c.step ?? 1
      const v = typeof value === 'number' ? value : min
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-teal-600"
          />
          <span className="w-12 text-right text-sm font-semibold text-slate-700 tabular-nums">
            {v}
            {c.unit ? ` ${c.unit}` : ''}
          </span>
        </div>
      )
    }
    case 'gps': {
      const loc = value as { lat: number; lng: number; accuracy?: number } | null
      return (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (typeof navigator === 'undefined' || !navigator.geolocation) {
                toast.error('Location is not available on this device')
                return
              }
              navigator.geolocation.getCurrentPosition(
                (p) =>
                  onChange({
                    lat: p.coords.latitude,
                    lng: p.coords.longitude,
                    accuracy: p.coords.accuracy,
                    capturedAt: new Date().toISOString(),
                  }),
                () => toast.error('Could not get your location — check permissions'),
                { enableHighAccuracy: true, timeout: 10_000 },
              )
            }}
          >
            <MapPin size={14} /> {loc ? 'Update location' : 'Capture location'}
          </Button>
          {loc ? (
            <p className="text-xs text-slate-500">
              {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
              {loc.accuracy ? ` · ±${Math.round(loc.accuracy)}m` : ''}
            </p>
          ) : null}
        </div>
      )
    }
    case 'matrix': {
      const c = (field.config ?? {}) as {
        rows?: { key: string; label: string }[]
        scale?: { value: string; label: string }[]
      }
      const rows = c.rows ?? []
      const scale = c.scale ?? []
      const v = (value as Record<string, string> | null) ?? {}
      if (rows.length === 0 || scale.length === 0) {
        return (
          <p className="text-xs text-slate-400">
            Add rows and a scale to this grid in the element settings.
          </p>
        )
      }
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-1.5" />
                {scale.map((s) => (
                  <th
                    key={s.value}
                    className="p-1.5 text-center text-xs font-medium text-slate-500"
                  >
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 text-slate-700">{r.label}</td>
                  {scale.map((s) => (
                    <td key={s.value} className="p-1.5 text-center">
                      <input
                        type="radio"
                        name={`${field.id}_${r.key}`}
                        checked={v[r.key] === s.value}
                        onChange={() => onChange({ ...v, [r.key]: s.value })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'formula':
    case 'calc':
      // No formula configured — fall back to a read-only blank.
      return <Input disabled placeholder="(no formula)" />
    case 'date':
      return (
        <Input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'datetime':
      return (
        <Input
          type="datetime-local"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'time':
      return (
        <Input
          type="time"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'select': {
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
    case 'radio': {
      // Big tappable chips — far easier than a dropdown with gloves on.
      const opts = field.validation?.options ?? []
      const cur = (value as string) ?? ''
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {opts.map((o) => {
            const sel = cur === o.value
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={sel}
                onClick={() => onChange(sel ? '' : o.value)}
                className={`ff-chip flex min-h-[48px] items-center gap-2.5 rounded-md border px-4 text-left text-sm font-medium ${
                  sel
                    ? 'border-teal-500 bg-teal-50 text-teal-900 dark:border-teal-600 dark:bg-teal-950/40 dark:text-teal-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    sel ? 'border-teal-600' : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {sel ? <span className="h-2.5 w-2.5 rounded-full bg-teal-600" /> : null}
                </span>
                {o.label?.en ?? o.value}
              </button>
            )
          })}
        </div>
      )
    }
    case 'multi_select':
    case 'checkbox_group': {
      const opts = field.validation?.options ?? []
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-2">
          {opts.map((o) => {
            const sel = arr.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={sel}
                onClick={() => onChange(sel ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
                className={`ff-chip flex min-h-[48px] w-full items-center gap-3 rounded-md border px-4 text-left text-sm font-medium ${
                  sel
                    ? 'border-teal-500 bg-teal-50 text-teal-900 dark:border-teal-600 dark:bg-teal-950/40 dark:text-teal-100'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                    sel
                      ? 'border-teal-600 bg-teal-600 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {sel ? <Check size={13} /> : null}
                </span>
                {o.label?.en ?? o.value}
              </button>
            )
          })}
        </div>
      )
    }
    case 'pass_fail_na':
      return (
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { v: 'pass', label: 'Pass' },
              { v: 'fail', label: 'Fail' },
              { v: 'n_a', label: 'N/A' },
            ] as const
          ).map(({ v, label }) => {
            const sel = value === v
            const tone = sel
              ? v === 'pass'
                ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-100'
                : v === 'fail'
                  ? 'border-red-500 bg-red-100 text-red-900 dark:border-red-500 dark:bg-red-900/40 dark:text-red-100'
                  : 'border-slate-400 bg-slate-100 text-slate-800 dark:border-slate-400 dark:bg-slate-700/60 dark:text-slate-100'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            return (
              <button
                key={v}
                type="button"
                aria-pressed={sel}
                onClick={() => onChange(sel ? '' : v)}
                className={`ff-chip flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-md border text-sm font-semibold ${tone}`}
              >
                {v === 'pass' ? <Check size={18} /> : v === 'fail' ? <X size={18} /> : null}
                {label}
              </button>
            )
          })}
        </div>
      )
    case 'yes_no_comment': {
      const v = (value as { answer?: string; comment?: string } | undefined) ?? {}
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { opt: 'yes', label: 'Yes' },
                { opt: 'no', label: 'No' },
              ] as const
            ).map(({ opt, label }) => {
              const sel = v.answer === opt
              const tone = sel
                ? opt === 'yes'
                  ? 'border-emerald-500 bg-emerald-100 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-100'
                  : 'border-red-500 bg-red-100 text-red-900 dark:border-red-500 dark:bg-red-900/40 dark:text-red-100'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => onChange({ ...v, answer: opt })}
                  className={`ff-chip flex min-h-[48px] items-center justify-center gap-2 rounded-md border text-sm font-semibold ${tone}`}
                >
                  {opt === 'yes' ? <Check size={18} /> : <X size={18} />}
                  {label}
                </button>
              )
            })}
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
        <div className="grid grid-cols-3 gap-2">
          {[
            {
              v: 'green',
              label: 'Green',
              dot: 'bg-emerald-500',
              sel: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
            },
            {
              v: 'yellow',
              label: 'Yellow',
              dot: 'bg-amber-400',
              sel: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40',
            },
            {
              v: 'red',
              label: 'Red',
              dot: 'bg-red-500',
              sel: 'border-red-500 bg-red-50 dark:bg-red-950/40',
            },
          ].map((opt) => {
            const sel = value === opt.v
            return (
              <button
                key={opt.v}
                type="button"
                aria-pressed={sel}
                onClick={() => onChange(sel ? '' : opt.v)}
                className={`ff-chip flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-md border text-sm font-medium ${
                  sel
                    ? `${opt.sel} text-slate-900 dark:text-slate-100`
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full ${opt.dot}`} />
                {opt.label}
              </button>
            )
          })}
        </div>
      )
    case 'person_picker':
      return (
        <SearchSelect
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v)}
          options={people.map((p) => ({
            value: p.id,
            label: `${p.lastName}, ${p.firstName}`,
            hint: p.employeeNo ?? undefined,
          }))}
          placeholder="Select a person…"
          searchPlaceholder="Search people…"
          sheetTitle="Select a person"
          clearable
          emptyLabel="—"
        />
      )
    case 'multi_person_picker': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      const byId = new Map(people.map((p) => [p.id, p]))
      return (
        <div className="space-y-2">
          {arr.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {arr.map((id) => {
                const p = byId.get(id)
                const label = p ? `${p.lastName}, ${p.firstName}` : id.slice(0, 8)
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pr-1 pl-2.5 text-xs text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => onChange(arr.filter((v) => v !== id))}
                      aria-label={`Remove ${label}`}
                      className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 hover:text-teal-900 dark:text-teal-400 dark:hover:bg-teal-900"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )
              })}
            </div>
          ) : null}
          <SearchSelect
            value=""
            onChange={(id) => {
              if (id && !arr.includes(id)) onChange([...arr, id])
            }}
            options={people
              .filter((p) => !arr.includes(p.id))
              .map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
            placeholder="Add person…"
            searchPlaceholder="Search people…"
            sheetTitle="Add a person"
          />
        </div>
      )
    }
    case 'customer_picker':
      return <OrgUnitPickerInput level="customer" value={value} onChange={onChange} />
    case 'project_picker':
      return <OrgUnitPickerInput level="project" value={value} onChange={onChange} />
    case 'site_picker':
      return <OrgUnitPickerInput level="site" value={value} onChange={onChange} />
    case 'area_picker':
      return <OrgUnitPickerInput level="area" value={value} onChange={onChange} />
    case 'signature':
      return <SignatureField value={(value as string | null) ?? null} onChange={onChange} />
    case 'sketch':
      return <SketchField value={value} onChange={onChange} />
    case 'photo':
    case 'photo_upload':
      return (
        <FileUpload
          variant="photo"
          value={Array.isArray(value) ? (value as AttachedFile[]) : []}
          onChange={(files) => onChange(files)}
        />
      )
    case 'photo_ai':
      return <PhotoAiInput value={value} onChange={onChange} />
    case 'photo_annotated':
      return <PhotoAnnotateInput value={value} onChange={onChange} />
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
    case 'image':
      return <ImageDisplay field={field} />
    case 'typed_attestation':
      return <TypedAttestationField field={field} value={value} onChange={onChange} />
    case 'table':
      return <TableField field={field} value={value} onChange={onChange} />
    case 'lookup':
      return (
        <LookupInput
          field={field}
          value={value}
          onChange={onChange}
          evalCtx={evalCtx}
          setFieldValue={setFieldValue}
        />
      )
    case 'data_table':
      return <DataTableInput field={field} value={value} onChange={onChange} evalCtx={evalCtx} />
    case 'metric':
      return <MetricBlock field={field} evalCtx={evalCtx} />
    case 'qr_scanner':
      return <QrScannerInput value={value} onChange={onChange} />
    case 'ranking':
      return <RankingInput field={field} value={value} onChange={onChange} />
    case 'rich_text':
      return <RichTextInput value={value} onChange={onChange} />
    case 'address':
      return <AddressInput value={value} onChange={onChange} />
    default:
      return <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
  }
}

// --- Number stepper + rating (big touch targets) ---------------------------

// Numeric entry with −/+ steppers either side of a centred field. The keypad
// is forced via inputMode='decimal' (we avoid type='number' so custom styling
// and the steppers behave consistently across iOS Safari).
function NumberStepper({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const c = (field.config ?? {}) as { min?: number; max?: number; step?: number; unit?: string }
  const step = c.step ?? 1
  const num =
    typeof value === 'number' ? value : value === '' || value == null ? null : Number(value)
  const clamp = (n: number) => {
    let v = n
    if (c.min !== undefined) v = Math.max(c.min, v)
    if (c.max !== undefined) v = Math.min(c.max, v)
    return Number(v.toFixed(6))
  }
  const bump = (dir: -1 | 1) => onChange(clamp((num ?? 0) + dir * step))
  const btn =
    'ff-chip flex w-14 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:scale-95 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
  return (
    <div className="flex items-stretch gap-2">
      <button type="button" className={btn} onClick={() => bump(-1)} aria-label="Decrease">
        <Minus size={18} />
      </button>
      <div className="relative flex-1">
        <Input
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          className="h-full text-center text-lg font-semibold"
          value={num ?? ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.-]/g, '')
            if (raw === '' || raw === '-' || raw === '.') return onChange(raw === '' ? '' : raw)
            const n = Number(raw)
            onChange(Number.isNaN(n) ? '' : n)
          }}
        />
        {c.unit ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-slate-400">
            {c.unit}
          </span>
        ) : null}
      </div>
      <button type="button" className={btn} onClick={() => bump(1)} aria-label="Increase">
        <Plus size={18} />
      </button>
    </div>
  )
}

// 1..max rating as big tappable buttons. Tap again to clear.
function RatingButtons({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const c = (field.config ?? {}) as { max?: number }
  const max = c.max ?? 5
  const cur = typeof value === 'number' ? value : null
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const sel = cur === n
        return (
          <button
            key={n}
            type="button"
            aria-pressed={sel}
            onClick={() => onChange(sel ? '' : n)}
            className={`ff-chip flex h-12 min-w-12 flex-1 items-center justify-center rounded-md border text-lg font-semibold ${
              sel
                ? 'border-teal-500 bg-teal-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            {n}
          </button>
        )
      })}
    </div>
  )
}

// --- Table field ------------------------------------------------------------

function TableField({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const config = (field.config ?? {}) as Partial<TableConfig>
  const columns = (config.columns ?? []) as TableColumn[]
  const rowMode = config.rowMode === 'fixed' ? 'fixed' : 'addable'
  const fixedRows = config.rows ?? []
  const minRows = config.minRows ?? 0
  const maxRows = config.maxRows

  const stored = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
  // In fixed mode the row set is defined by the template; pad stored values so
  // every predefined row renders.
  const rows = rowMode === 'fixed' ? fixedRows.map((_, i) => stored[i] ?? {}) : stored

  function setCell(i: number, key: string, v: unknown) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))
  }
  function addRow() {
    if (maxRows != null && rows.length >= maxRows) return
    onChange([...rows, {}])
  }
  function removeRow(i: number) {
    if (rows.length <= minRows) return
    onChange(rows.filter((_, idx) => idx !== i))
  }

  if (columns.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
        This table has no columns configured.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {/* Desktop / wide: full table */}
      <div className="hidden overflow-x-auto rounded-md border border-slate-200 sm:block dark:border-slate-700">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60">
              {rowMode === 'fixed' ? (
                <th className="border-b border-slate-200 px-2 py-1.5 text-left text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300" />
              ) : null}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="border-b border-slate-200 px-2 py-1.5 text-left text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  {c.label || c.key}
                </th>
              ))}
              {rowMode === 'addable' ? (
                <th className="w-8 border-b border-slate-200 dark:border-slate-700" />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-2 py-3 text-center text-xs text-slate-400"
                >
                  No rows. Add one below.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
                >
                  {rowMode === 'fixed' ? (
                    <td className="px-2 py-1 text-xs font-medium whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {fixedRows[i]?.label ?? `Row ${i + 1}`}
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td key={c.key} className="px-1.5 py-1 align-top">
                      <TableCell
                        column={c}
                        value={row[c.key]}
                        onChange={(v) => setCell(i, c.key, v)}
                      />
                    </td>
                  ))}
                  {rowMode === 'addable' ? (
                    <td className="px-1 py-1 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        disabled={rows.length <= minRows}
                        title="Remove row"
                        className="rounded p-1 text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {rowMode === 'addable' ? (
          <div className="border-t border-slate-200 p-1.5 dark:border-slate-700">
            <button
              type="button"
              onClick={addRow}
              disabled={maxRows != null && rows.length >= maxRows}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={13} /> Add row
            </button>
          </div>
        ) : null}
      </div>

      {/* Mobile: one card per row — never a horizontal scroll on a phone. */}
      <div className="space-y-3 sm:hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No rows yet.</p>
        ) : (
          rows.map((row, i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {rowMode === 'fixed' ? (fixedRows[i]?.label ?? `Row ${i + 1}`) : `Row ${i + 1}`}
                </span>
                {rowMode === 'addable' ? (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={rows.length <= minRows}
                    title="Remove row"
                    className="ff-chip flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-950/40"
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
              <div className="space-y-2.5">
                {columns.map((c) => (
                  <div key={c.key} className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">{c.label || c.key}</label>
                    <TableCell
                      column={c}
                      value={row[c.key]}
                      onChange={(v) => setCell(i, c.key, v)}
                      mobile
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        {rowMode === 'addable' ? (
          <button
            type="button"
            onClick={addRow}
            disabled={maxRows != null && rows.length >= maxRows}
            className="ff-chip flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-teal-300"
          >
            <Plus size={16} /> Add row
          </button>
        ) : null}
      </div>
    </div>
  )
}

function TableCell({
  column,
  value,
  onChange,
  mobile,
}: {
  column: TableColumn
  value: unknown
  onChange: (v: unknown) => void
  // In the mobile card view cells are full-width; drop the compact h-8 so the
  // shared .ff-surface touch sizing (48px) applies.
  mobile?: boolean
}) {
  const sizeCls = mobile ? '' : 'h-8 text-sm'
  switch (column.type) {
    case 'number':
      return (
        <Input
          type="text"
          inputMode="decimal"
          className={sizeCls}
          value={(value as number | string | null) ?? ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.-]/g, '')
            onChange(raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw))
          }}
        />
      )
    case 'date':
      return (
        <Input
          type="date"
          className={sizeCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'checkbox':
      return (
        <div className={`flex items-center ${mobile ? 'h-10' : 'h-8 justify-center'}`}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-5 w-5"
          />
        </div>
      )
    case 'select':
      return (
        <Select
          className={sizeCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(column.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label || o.value}
            </option>
          ))}
        </Select>
      )
    default:
      return (
        <Input
          className={sizeCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

// --- Typed attestation + display image (previously fell back to a text box) --

function TypedAttestationField({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const v = (value ?? {}) as { name?: string; agreed?: boolean }
  const statement =
    (field.config?.statement as string | undefined) ??
    field.helpText?.en ??
    'I attest that the information above is true and accurate.'
  return (
    <div className="space-y-2">
      <Input
        placeholder="Type your full name"
        value={v.name ?? ''}
        onChange={(e) => onChange({ ...v, name: e.target.value })}
      />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={!!v.agreed}
          onChange={(e) => onChange({ ...v, agreed: e.target.checked })}
        />
        <span>{statement}</span>
      </label>
    </div>
  )
}

function ImageDisplay({ field }: { field: FormField }) {
  const url = (field.config?.url ?? field.config?.src) as string | undefined
  if (!url) {
    return <p className="text-xs text-slate-400">No image configured for this field.</p>
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={field.label?.en ?? 'Image'}
      className="max-h-64 w-auto rounded border border-slate-200"
    />
  )
}

// --- Field-level validation helper -----------------------------------------
//
// Mirrors the per-field rules from @beaconhs/forms-core validator so we can
// show inline errors on Next-button click without re-running the full
// schema-wide validator.

// --- Data-bound element runtimes -------------------------------------------

function labelForRow(row: DataRow, labelCol?: string): string {
  if (labelCol && row[labelCol] != null && row[labelCol] !== '') return String(row[labelCol])
  // Fall back to the first non-meta column with a value.
  for (const k of Object.keys(row)) {
    if (!k.startsWith('__') && row[k] != null && row[k] !== '') return String(row[k])
  }
  return String(row.__rowId ?? '—')
}

// --- Org-unit pickers -------------------------------------------------------
//
// One searchable dropdown per org_units level (customer / project / site /
// area). Self-contained: each fetches its own options via listOrgUnitOptions
// (mirrors LookupInput), so no prop threading. Options are cached per level in
// the per-mount OrgUnitOptionsCacheContext — many instances / re-renders hit
// the server at most once per level, and a remount (e.g. tenant switch)
// refetches instead of leaking another tenant's units.

type OrgUnitOption = { id: string; name: string; code: string | null }
const ORG_PICKER_COPY: Record<string, { noun: string; article: string }> = {
  customer: { noun: 'customer', article: 'a' },
  project: { noun: 'project', article: 'a' },
  site: { noun: 'site', article: 'a' },
  area: { noun: 'area', article: 'an' },
}

function OrgUnitPickerInput({
  level,
  value,
  onChange,
}: {
  level: 'customer' | 'project' | 'site' | 'area'
  value: unknown
  onChange: (v: unknown) => void
}) {
  const contextCache = useContext(OrgUnitOptionsCacheContext)
  // Defensive per-instance fallback for a render outside FormRenderer's
  // provider. Lazy state (not a ref) so reading it during render is legal.
  const [fallbackCache] = useState<Record<string, OrgUnitOption[] | undefined>>(() => ({}))
  const cache = contextCache ?? fallbackCache
  const [options, setOptions] = useState<OrgUnitOption[]>(() => cache[level] ?? [])
  const [loading, setLoading] = useState(() => cache[level] === undefined)

  useEffect(() => {
    // Cache hit → initial state already correct; no fetch / no setState needed.
    if (cache[level] !== undefined) return
    let alive = true
    listOrgUnitOptions(level)
      .then((rows) => {
        cache[level] = rows
        if (alive) {
          setOptions(rows)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // `cache` is a stable per-mount object (context / lazy state) — safe dep.
  }, [level, cache])

  const { noun, article } = ORG_PICKER_COPY[level] ?? { noun: level, article: 'a' }
  return (
    <SearchSelect
      value={(value as string) ?? ''}
      onChange={(v) => onChange(v)}
      options={options.map((o) => ({
        value: o.id,
        label: o.name,
        hint: o.code ?? undefined,
      }))}
      placeholder={loading ? 'Loading…' : `Select ${article} ${noun}…`}
      searchPlaceholder={`Search ${noun}s…`}
      sheetTitle={`Select ${article} ${noun}`}
      clearable
      emptyLabel="—"
    />
  )
}

// A data-bound dropdown. Fetches rows from its source (optionally cascaded by a
// parent field's value), and on selection can auto-fill sibling fields.

function LookupInput({
  field,
  value,
  onChange,
  evalCtx,
  setFieldValue,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  evalCtx: EvalContext
  setFieldValue?: (fieldId: string, v: unknown) => void
}) {
  const b = field.binding
  const parentVal = b?.filterByField ? evalCtx.values[b.filterByField] : undefined
  const hasCascade = !!b?.filterByField && !!b?.filterColumn
  const parentKey = String(parentVal ?? '')
  const [rows, setRows] = useState<DataRow[]>([])
  const [loading, setLoading] = useState(false)
  const whereKey = JSON.stringify(b?.where ?? null)

  useEffect(() => {
    if (!b?.sourceKey) return
    let alive = true
    setLoading(true)
    queryDataSource({
      sourceKey: b.sourceKey,
      where: b.where,
      filterColumn: hasCascade ? b.filterColumn : undefined,
      filterValue: hasCascade ? parentVal : undefined,
      limit: b.limit ?? 200,
    })
      .then((res) => {
        if (alive) setRows(res.rows)
      })
      .catch(() => {
        if (alive) setRows([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.sourceKey, b?.filterByField, b?.filterColumn, whereKey, parentKey, b?.limit])

  if (!b?.sourceKey) {
    return (
      <Select disabled>
        <option>Configure a data source…</option>
      </Select>
    )
  }

  const valueCol = b.valueColumn || '__rowId'
  const waitingParent = hasCascade && (parentVal == null || parentVal === '')

  const pick = (rowVal: string) => {
    onChange(rowVal)
    if (setFieldValue && b.autofill?.length) {
      const row = rows.find((r) => String(r[valueCol] ?? '') === rowVal)
      if (row) for (const m of b.autofill) setFieldValue(m.targetFieldId, row[m.column] ?? null)
    }
  }

  return (
    <Select
      value={(value as string) ?? ''}
      onChange={(e) => pick(e.target.value)}
      disabled={waitingParent}
    >
      <option value="">
        {loading ? 'Loading…' : waitingParent ? 'Select the previous field first…' : 'Select…'}
      </option>
      {rows.map((r, i) => {
        const v = String(r[valueCol] ?? '')
        return (
          <option key={`${v}-${i}`} value={v}>
            {labelForRow(r, b.labelColumn)}
          </option>
        )
      })}
    </Select>
  )
}

// A data-bound table — displays (and optionally lets the user select) rows from
// a source. Selection stores the chosen rows' ids in the response value.
function DataTableInput({
  field,
  value,
  onChange,
  evalCtx,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
  evalCtx: EvalContext
}) {
  const b = field.binding
  const parentVal = b?.filterByField ? evalCtx.values[b.filterByField] : undefined
  const hasCascade = !!b?.filterByField && !!b?.filterColumn
  const parentKey = String(parentVal ?? '')
  const [res, setRes] = useState<DataQueryResult>({ columns: [], rows: [] })
  const [loading, setLoading] = useState(false)
  const whereKey = JSON.stringify(b?.where ?? null)

  useEffect(() => {
    if (!b?.sourceKey) return
    let alive = true
    setLoading(true)
    queryDataSource({
      sourceKey: b.sourceKey,
      where: b.where,
      filterColumn: hasCascade ? b.filterColumn : undefined,
      filterValue: hasCascade ? parentVal : undefined,
      limit: b.limit ?? 50,
    })
      .then((r) => {
        if (alive) setRes(r)
      })
      .catch(() => {
        if (alive) setRes({ columns: [], rows: [] })
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.sourceKey, b?.filterByField, b?.filterColumn, whereKey, parentKey, b?.limit])

  if (!b?.sourceKey) return <p className="text-xs text-slate-400">Configure a data source…</p>

  const selectable = b.selectable ?? 'none'
  const showCols = b.columns?.length
    ? res.columns.filter((c) => b.columns!.includes(c.key))
    : res.columns.filter((c) => !c.key.startsWith('__'))
  const selected = Array.isArray(value) ? (value as string[]) : []
  const toggle = (rowId: string) => {
    if (selectable === 'single') onChange([rowId])
    else
      onChange(
        selected.includes(rowId) ? selected.filter((x) => x !== rowId) : [...selected, rowId],
      )
  }

  if (loading && res.rows.length === 0) return <p className="text-xs text-slate-400">Loading…</p>
  if (res.rows.length === 0) return <p className="text-xs text-slate-400">No matching records.</p>

  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            {selectable !== 'none' ? <th className="w-8 px-2 py-1.5" /> : null}
            {showCols.map((c) => (
              <th key={c.key} className="px-2 py-1.5 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {res.rows.map((r, i) => {
            const rowId = String(r.__rowId ?? i)
            const isSel = selected.includes(rowId)
            return (
              <tr
                key={rowId}
                className={`border-b border-slate-100 ${isSel ? 'bg-teal-50' : ''} ${
                  selectable !== 'none' ? 'cursor-pointer hover:bg-slate-50' : ''
                }`}
                onClick={selectable !== 'none' ? () => toggle(rowId) : undefined}
              >
                {selectable !== 'none' ? (
                  <td className="px-2 py-1.5">
                    <input
                      type={selectable === 'single' ? 'radio' : 'checkbox'}
                      checked={isSel}
                      onChange={() => toggle(rowId)}
                    />
                  </td>
                ) : null}
                {showCols.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-slate-700">
                    {r[c.key] == null || r[c.key] === '' ? '—' : String(r[c.key])}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// A display-only KPI / chart — aggregates its source server-side and renders a
// single number, a bar/line chart, or a proportion list (pie).
function MetricBlock({ field, evalCtx }: { field: FormField; evalCtx: EvalContext }) {
  const b = field.binding
  const parentVal = b?.filterByField ? evalCtx.values[b.filterByField] : undefined
  const hasCascade = !!b?.filterByField && !!b?.filterColumn
  const parentKey = String(parentVal ?? '')
  const [res, setRes] = useState<DataAggregateResult | null>(null)
  const whereKey = JSON.stringify(b?.where ?? null)
  const agg = b?.aggregate

  useEffect(() => {
    if (!b?.sourceKey) return
    let alive = true
    aggregateDataSource({
      sourceKey: b.sourceKey,
      fn: agg?.fn ?? 'count',
      column: agg?.column,
      groupBy: agg?.groupBy,
      where: b.where,
      filterColumn: hasCascade ? b.filterColumn : undefined,
      filterValue: hasCascade ? parentVal : undefined,
      limit: b.limit,
    })
      .then((r) => {
        if (alive) setRes(r)
      })
      .catch(() => {
        if (alive) setRes(null)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    b?.sourceKey,
    b?.filterByField,
    b?.filterColumn,
    b?.limit,
    agg?.fn,
    agg?.column,
    agg?.groupBy,
    whereKey,
    parentKey,
  ])

  if (!b?.sourceKey) return <p className="text-xs text-slate-400">Configure a data source…</p>

  const fmt = (n: number | null) =>
    n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1)

  if (res?.groups && res.groups.length > 0) {
    const display = b.display ?? 'bar'
    if (display === 'pie') {
      const total = res.groups.reduce((a, g) => a + g.value, 0) || 1
      return (
        <div className="space-y-1.5">
          {res.groups.slice(0, 8).map((g) => (
            <div key={g.key} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate text-slate-600">{g.key}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${(g.value / total) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-slate-500 tabular-nums">{fmt(g.value)}</span>
            </div>
          ))}
        </div>
      )
    }
    const max = Math.max(...res.groups.map((g) => g.value), 1)
    return (
      <div className="flex items-end gap-1.5" style={{ height: 120 }}>
        {res.groups.slice(0, 12).map((g) => (
          <div key={g.key} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full rounded-t bg-teal-400"
              style={{ height: `${Math.max((g.value / max) * 100, 3)}%` }}
              title={`${g.key}: ${fmt(g.value)}`}
            />
            <span className="w-full truncate text-center text-[9px] text-slate-400">{g.key}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="inline-flex flex-col rounded-lg border border-slate-200 bg-white px-4 py-3">
      <span className="text-3xl font-semibold text-slate-800 tabular-nums">
        {fmt(res?.value ?? null)}
      </span>
      <span className="mt-0.5 text-[10px] tracking-wide text-slate-400 uppercase">
        {agg?.fn ?? 'count'}
        {agg?.column ? ` · ${agg.column}` : ''}
        {res ? ` · ${res.total} rows` : ''}
      </span>
    </div>
  )
}

// --- AI photo analysis element ---------------------------------------------

function riskTone(risk: string): string {
  return risk === 'high'
    ? 'bg-red-100 text-red-700'
    : risk === 'medium'
      ? 'bg-amber-100 text-amber-700'
      : risk === 'low'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-emerald-100 text-emerald-700'
}
function sevTone(sev: string): string {
  return sev === 'high' ? 'text-red-600' : sev === 'medium' ? 'text-amber-600' : 'text-yellow-600'
}

type PhotoAiValue = {
  attachments?: AttachedFile[]
  analysis?: SafetyVisionAnalysis
  analyzedAt?: string
}

// Photo capture + on-demand AI safety analysis (missing PPE / hazards). Stores a
// compound value { attachments, analysis?, analyzedAt? }. Editing the photos
// clears a stale analysis.
function PhotoAiInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const v = (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ) as PhotoAiValue
  const attachments = Array.isArray(v.attachments) ? v.attachments : []
  const [analyzing, setAnalyzing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const a = v.analysis

  const setFiles = (files: AttachedFile[]) => {
    onChange({
      attachments: files,
      analysis: files.length ? v.analysis : undefined,
      analyzedAt: files.length ? v.analyzedAt : undefined,
    })
  }
  const analyze = () => {
    if (attachments.length === 0 || analyzing) return
    setErr(null)
    setAnalyzing(true)
    analyzePhotos({ attachmentIds: attachments.map((x) => x.attachmentId) })
      .then((res) => {
        if (res.ok)
          onChange({ attachments, analysis: res.analysis, analyzedAt: new Date().toISOString() })
        else setErr(res.error)
      })
      .catch(() => setErr('Analysis failed'))
      .finally(() => setAnalyzing(false))
  }

  return (
    <div className="space-y-2">
      <FileUpload variant="photo" value={attachments} onChange={setFiles} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={attachments.length === 0 || analyzing}
          onClick={analyze}
        >
          <Sparkles size={14} />{' '}
          {analyzing ? 'Analyzing…' : a ? 'Re-analyze' : 'Analyze for hazards'}
        </Button>
        {a ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskTone(a.overallRisk)}`}
          >
            {a.overallRisk === 'none' ? 'No concerns' : `${a.overallRisk} risk`}
          </span>
        ) : null}
      </div>
      {err ? <p className="text-xs text-red-600">{err}</p> : null}
      {a ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
          {a.summary ? <p className="text-slate-700">{a.summary}</p> : null}
          {a.ppe.length > 0 ? (
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                <ShieldCheck size={12} /> PPE
              </div>
              <ul className="space-y-0.5">
                {a.ppe.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={p.status === 'present' ? 'text-emerald-600' : 'text-red-600'}>
                      {p.status === 'present' ? '✓' : '✗'}
                    </span>
                    <span className="text-slate-700">
                      <strong className="capitalize">{p.item}</strong>
                      <span className="text-slate-500">
                        {' '}
                        — {p.status}
                        {p.detail ? `: ${p.detail}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {a.hazards.length > 0 ? (
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                <AlertTriangle size={12} /> Hazards
              </div>
              <ul className="space-y-0.5">
                {a.hazards.map((h, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${sevTone(h.severity)}`} />
                    <span className="text-slate-700">
                      <strong className="capitalize">{h.type}</strong>{' '}
                      <span className={`text-xs uppercase ${sevTone(h.severity)}`}>
                        ({h.severity})
                      </span>
                      <span className="text-slate-500"> — {h.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {a.ppe.length === 0 && a.hazards.length === 0 ? (
            <p className="text-xs text-emerald-700">No PPE issues or hazards detected.</p>
          ) : null}
          <p className="text-[10px] text-slate-400">AI-generated — verify before acting.</p>
        </div>
      ) : null}
    </div>
  )
}

// --- Photo annotation (tap-to-drop hazard markers) -------------------------

type PhotoMarker = { id: string; x: number; y: number; label: string }
type PhotoAnnotatedValue = { attachments?: AttachedFile[]; markers?: PhotoMarker[] }

function PhotoAnnotateInput({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: unknown) => void
}) {
  const v = (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ) as PhotoAnnotatedValue
  const attachments = Array.isArray(v.attachments) ? v.attachments : []
  const markers = Array.isArray(v.markers) ? v.markers : []
  const imgWrapRef = useRef<HTMLDivElement>(null)
  const photo = attachments[0]

  const setFiles = (files: AttachedFile[]) =>
    onChange({ attachments: files, markers: files.length ? markers : [] })
  const newId = () =>
    globalThis.crypto?.randomUUID?.() ??
    `m_${markers.length}_${markers.reduce((a, m) => a + m.x, 0)}`
  const addMarker = (e: React.MouseEvent) => {
    const rect = imgWrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    onChange({ attachments, markers: [...markers, { id: newId(), x, y, label: '' }] })
  }
  const setLabel = (id: string, label: string) =>
    onChange({ attachments, markers: markers.map((m) => (m.id === id ? { ...m, label } : m)) })
  const removeMarker = (id: string) =>
    onChange({ attachments, markers: markers.filter((m) => m.id !== id) })

  if (attachments.length === 0 || !photo) {
    return <FileUpload variant="photo" value={attachments} onChange={setFiles} />
  }

  return (
    <div className="space-y-2">
      <div
        ref={imgWrapRef}
        onClick={addMarker}
        className="relative inline-block max-w-full cursor-crosshair select-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt="Annotate hazards"
          draggable={false}
          className="max-h-80 max-w-full rounded border border-slate-200"
        />
        {markers.map((m, i) => (
          <span
            key={m.id}
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white ring-2 ring-white"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        Tap the photo to drop a numbered marker on a hazard.
      </p>
      {markers.length > 0 ? (
        <ul className="space-y-1">
          {markers.map((m, i) => (
            <li key={m.id} className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <Input
                value={m.label}
                placeholder={`Marker ${i + 1} — note`}
                onChange={(e) => setLabel(m.id, e.target.value)}
                className="h-8 flex-1"
              />
              <button
                type="button"
                onClick={() => removeMarker(m.id)}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                title="Remove marker"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={() => setFiles([])}
        className="text-xs text-slate-500 hover:underline"
      >
        Replace photo
      </button>
    </div>
  )
}

// --- QR / barcode scanner --------------------------------------------------

function QrScannerInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }, [])

  useEffect(() => () => stop(), [stop])

  const start = async () => {
    setErr(null)
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new () => { detect: (s: unknown) => Promise<{ rawValue: string }[]> }
      }
    ).BarcodeDetector
    if (!Detector) {
      setErr('Scanning isn’t supported on this device — type the code instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setScanning(true)
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        await v.play()
        const detector = new Detector()
        intervalRef.current = window.setInterval(async () => {
          if (!streamRef.current || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const first = codes?.[0]
            if (first?.rawValue) {
              onChange(first.rawValue)
              stop()
            }
          } catch {
            /* transient detect errors are fine */
          }
        }, 350)
      }
    } catch {
      setErr('Couldn’t access the camera — type the code instead.')
      setScanning(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={(value as string) ?? ''}
          placeholder="Scan or type a code"
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={scanning ? stop : start}>
          <ScanLine size={14} /> {scanning ? 'Stop' : 'Scan'}
        </Button>
      </div>
      {scanning ? (
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full max-w-xs rounded border border-slate-200"
        />
      ) : null}
      {err ? <p className="text-xs text-amber-600">{err}</p> : null}
    </div>
  )
}

// --- Ranking (reorder options) ---------------------------------------------

function RankingInput({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const opts = field.validation?.options ?? []
  const labelOf = (v: string) => {
    const o = opts.find((x) => x.value === v)
    return o ? (o.label?.en ?? o.value) : v
  }
  const current = Array.isArray(value) ? (value as string[]) : []
  // Start from the saved order, then append any options not yet ranked + drop
  // any stale values whose option was removed.
  const ordered = [
    ...current.filter((v) => opts.some((o) => o.value === v)),
    ...opts.filter((o) => !current.includes(o.value)).map((o) => o.value),
  ]
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= ordered.length) return
    const next = [...ordered]
    const tmp = next[i]!
    next[i] = next[j]!
    next[j] = tmp
    onChange(next)
  }
  if (opts.length === 0)
    return <p className="text-xs text-slate-400">Add options to rank (Element → Options).</p>
  return (
    <ol className="space-y-1">
      {ordered.map((v, i) => (
        <li
          key={v}
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
        >
          <span className="w-5 text-center font-semibold text-slate-400">{i + 1}</span>
          <span className="flex-1 text-slate-700">{labelOf(v)}</span>
          <button
            type="button"
            disabled={i === 0}
            onClick={() => move(i, -1)}
            className="rounded p-1 text-slate-400 enabled:hover:bg-slate-100 enabled:hover:text-slate-700 disabled:opacity-30"
            title="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            disabled={i === ordered.length - 1}
            onClick={() => move(i, 1)}
            className="rounded p-1 text-slate-400 enabled:hover:bg-slate-100 enabled:hover:text-slate-700 disabled:opacity-30"
            title="Move down"
          >
            <ChevronDown size={14} />
          </button>
        </li>
      ))}
    </ol>
  )
}

// --- Rich text (lightweight contentEditable) -------------------------------

function RichTextInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const readOnly = useContext(FillReadOnlyContext)
  const ref = useRef<HTMLDivElement>(null)
  // Seed the editor once on mount; afterwards it's uncontrolled so the caret
  // isn't reset on every keystroke.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = (value as string) ?? ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const exec = (cmd: string, arg?: string) => {
    document.execCommand(cmd, false, arg)
    onChange(ref.current?.innerHTML ?? '')
    ref.current?.focus()
  }
  const btn =
    'flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-800'
  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex gap-0.5 border-b border-slate-200 bg-slate-50 p-1">
        <button type="button" className={btn} title="Bold" onClick={() => exec('bold')}>
          <Bold size={13} />
        </button>
        <button type="button" className={btn} title="Italic" onClick={() => exec('italic')}>
          <Italic size={13} />
        </button>
        <button
          type="button"
          className={btn}
          title="Bulleted list"
          onClick={() => exec('insertUnorderedList')}
        >
          <List size={13} />
        </button>
        <button
          type="button"
          className={btn}
          title="Link"
          onClick={() => {
            const url = window.prompt('Link URL')
            if (url) exec('createLink', url)
          }}
        >
          <LinkIcon size={13} />
        </button>
      </div>
      <div
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={readOnly ? undefined : (e) => onChange((e.target as HTMLDivElement).innerHTML)}
        className="app-scroll prose prose-sm max-h-60 min-h-[80px] max-w-none overflow-auto p-2 text-sm focus:outline-none"
      />
    </div>
  )
}

// --- Address (structured + free OSM autocomplete) --------------------------

type AddressValue = {
  query?: string
  line1?: string
  city?: string
  region?: string
  postal?: string
  country?: string
  lat?: number
  lng?: number
}
type NominatimHit = {
  display_name: string
  lat: string
  lon: string
  address?: Record<string, string>
}

function AddressInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const v = (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  ) as AddressValue
  const [suggestions, setSuggestions] = useState<NominatimHit[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<number | null>(null)
  const set = (patch: Partial<AddressValue>) => onChange({ ...v, ...patch })

  const onQuery = (q: string) => {
    set({ query: q })
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (q.trim().length < 4) {
      setSuggestions([])
      return
    }
    timerRef.current = window.setTimeout(async () => {
      try {
        setSearching(true)
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`,
          { headers: { Accept: 'application/json' } },
        )
        setSuggestions(res.ok ? ((await res.json()) as NominatimHit[]) : [])
      } catch {
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 500)
  }

  const choose = (s: NominatimHit) => {
    const a = s.address ?? {}
    onChange({
      query: s.display_name,
      line1: [a.house_number, a.road].filter(Boolean).join(' ') || s.display_name,
      city: a.city || a.town || a.village || a.hamlet || '',
      region: a.state || a.province || a.county || '',
      postal: a.postcode || '',
      country: a.country || '',
      lat: Number(s.lat),
      lng: Number(s.lon),
    })
    setSuggestions([])
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={v.query ?? ''}
          placeholder="Search an address…"
          onChange={(e) => onQuery(e.target.value)}
        />
        {searching ? (
          <span className="absolute top-2.5 right-2 text-xs text-slate-400">…</span>
        ) : null}
        {suggestions.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {suggestions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => choose(s)}
                  className="block w-full px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-50"
                >
                  {s.display_name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={v.line1 ?? ''}
          placeholder="Address line 1"
          onChange={(e) => set({ line1: e.target.value })}
          className="col-span-2"
        />
        <Input
          value={v.city ?? ''}
          placeholder="City"
          onChange={(e) => set({ city: e.target.value })}
        />
        <Input
          value={v.region ?? ''}
          placeholder="State / region"
          onChange={(e) => set({ region: e.target.value })}
        />
        <Input
          value={v.postal ?? ''}
          placeholder="Postal code"
          onChange={(e) => set({ postal: e.target.value })}
        />
        <Input
          value={v.country ?? ''}
          placeholder="Country"
          onChange={(e) => set({ country: e.target.value })}
        />
      </div>
    </div>
  )
}

function validateOne(field: FormField, value: unknown): string | null {
  // Display-only data block — holds no value, so it's never required/validated.
  if (field.type === 'metric') return null
  // Rich text: an "empty" editor can still hold <br>/<div> markup, so check text.
  if (field.type === 'rich_text') {
    const required = field.required || field.validation?.required
    const text = String(value ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim()
    if (required && text === '') return field.validation?.message ?? 'Required'
    return null
  }
  // Address: require at least line1 when required (compound object).
  if (field.type === 'address') {
    const required = field.required || field.validation?.required
    const a = (value as AddressValue) ?? {}
    if (required && !a.line1 && !a.query) return field.validation?.message ?? 'Required'
    return null
  }
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
    case 'rating':
    case 'slider': {
      const n = Number(value)
      if (Number.isNaN(n)) return v?.message ?? 'Must be a number'
      if (v?.min !== undefined && n < v.min) return v?.message ?? `Must be >= ${v.min}`
      if (v?.max !== undefined && n > v.max) return v?.message ?? `Must be <= ${v.max}`
      return null
    }
    case 'matrix': {
      // Required matrices need at least one row rated (empty object isn't caught
      // by the generic isEmpty check above).
      const obj = (value as Record<string, unknown>) ?? {}
      if (required && Object.keys(obj).length === 0) return v?.message ?? 'Rate at least one row'
      return null
    }
    case 'photo_ai':
    case 'photo_annotated': {
      // Compound { attachments, ... } — require at least one photo.
      const obj = (value as { attachments?: unknown[] }) ?? {}
      if (required && (!Array.isArray(obj.attachments) || obj.attachments.length === 0))
        return v?.message ?? 'Add a photo'
      return null
    }
    case 'sketch': {
      // Compound { attachmentId, url, scene } — require a drawn diagram.
      const obj = (value as { attachmentId?: string }) ?? {}
      if (required && !obj.attachmentId) return v?.message ?? 'Add a diagram'
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
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        return v?.message ?? 'Invalid email'
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
  const readOnly = useContext(FillReadOnlyContext)
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
      <SignaturePad value={stored?.url ?? null} onChange={persist} disabled={readOnly} />
    </div>
  )
}

// --- Sketch / diagram -------------------------------------------------------
//
// Freehand drawing canvas (Excalidraw). Mirrors SignatureField: the rendered
// PNG is uploaded as an attachment so the viewer + PDF can show the diagram,
// while the editable Excalidraw scene is stashed on the value so the drawing
// can be re-opened and amended. Value shape: { attachmentId, url, scene }.

type SketchValue = { attachmentId: string; url: string; scene?: SketchScene }

function SketchField({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: SketchValue | null) => void
}) {
  const readOnly = useContext(FillReadOnlyContext)
  const stored = (value as SketchValue | null) ?? null

  async function persist(dataUrl: string | null, scene: SketchScene) {
    if (!dataUrl) {
      onChange(null)
      return
    }
    const file = dataUrlToFile(dataUrl, `sketch-${Date.now()}.png`)
    const req = await requestUpload({
      kind: 'image',
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    if (!req.ok) {
      console.warn('[sketch] presign failed', req.error)
      return
    }
    const put = await fetch(req.putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!put.ok) return
    const fin = await finalizeUpload({
      kind: 'image',
      key: req.key,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    if (!fin.ok) return
    onChange({ attachmentId: fin.attachmentId, url: req.publicUrl, scene })
  }

  return <SketchPad initialScene={stored?.scene ?? null} onChange={persist} readOnly={readOnly} />
}

// --- Save status indicator -------------------------------------------------
//
// Small chip rendered in the top-right of the wizard header. Mirrors the
// 'idle' | 'pending' | 'saved' | 'error' state machine driven by the
// autosave hook. Clickable in the error state to manually retry the save.

function SaveStatus({
  status,
  lastSavedAt,
  error,
  onRetry,
}: {
  status: 'idle' | 'pending' | 'saved' | 'error'
  lastSavedAt: Date | null
  error: string | null
  onRetry: () => void
}) {
  if (status === 'idle') return null

  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
        <Cloud size={11} className="animate-pulse" />
        Saving…
      </span>
    )
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? 'Save failed'}
        className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
      >
        <CloudOff size={11} />
        Save failed — retry
      </button>
    )
  }

  // 'saved'
  const label = lastSavedAt ? formatSavedAgo(lastSavedAt) : 'Saved'
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
      <Check size={11} />
      {label}
    </span>
  )
}

function formatSavedAgo(at: Date): string {
  const seconds = Math.floor((Date.now() - at.getTime()) / 1000)
  if (seconds < 5) return 'Saved'
  if (seconds < 60) return `Saved ${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `Saved ${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `Saved ${hours}h ago`
}
