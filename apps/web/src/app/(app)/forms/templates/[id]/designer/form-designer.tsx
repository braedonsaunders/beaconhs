'use client'

// Form designer.
//
// Three-pane layout:
//   - Left: field palette (categorized, with icons), section list + workflow step editor
//   - Middle: canvas — sections and fields, drag-free reorder via arrows, click-to-select
//   - Right: properties panel for the current selection (form / section / field) with
//            tabs for Basic / Validation / Logic / Default / Calc
//
// All edits mutate a local copy of FormSchemaV1. Publish writes a new immutable
// version via the `publishNewVersion` server action.

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calculator,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileText,
  Hash,
  Image as ImageIcon,
  ListChecks,
  Mail,
  MapPin,
  Mic,
  Minus,
  Package,
  Pencil,
  Phone,
  Plus,
  Radio,
  Save,
  ShieldCheck,
  Signal,
  Sliders,
  Star,
  ToggleLeft,
  Trash2,
  Type,
  Upload,
  User,
  Users,
  Video,
  X,
} from 'lucide-react'
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
  FIELD_TYPES,
  entityKindForPicker,
  type DefaultValueExpression,
  type FieldType,
  type FormField,
  type FormSchemaV1,
  type FormSection,
  type FormulaExpression,
  type FormWorkflowStep,
} from '@beaconhs/forms-core'
import { toast } from '@/lib/toast'
import { publishNewVersion } from './actions'
import { LogicBuilder } from './logic-builder'
import { FormulaBuilder } from './formula-builder'

// --- Palette ---------------------------------------------------------------

// Field-type icon registry. Falls back to a generic Type icon for unknowns.
const FIELD_ICONS: Partial<Record<FieldType, React.ComponentType<{ size?: number }>>> = {
  text: Type,
  textarea: AlignLeft,
  long_text: AlignLeft,
  number: Hash,
  date: Calendar,
  datetime: Calendar,
  time: Calendar,
  email: Mail,
  phone: Phone,
  url: FileText,
  radio: Radio,
  checkbox_group: CheckSquare,
  select: ChevronDown,
  multi_select: ListChecks,
  pass_fail_na: ShieldCheck,
  rating: Star,
  yes_no_comment: ToggleLeft,
  traffic_light: Signal,
  person_picker: User,
  multi_person_picker: Users,
  site_picker: MapPin,
  equipment_picker: Package,
  ppe_picker: Package,
  document_picker: FileText,
  course_picker: ClipboardCheck,
  photo: ImageIcon,
  photo_upload: ImageIcon,
  file: Upload,
  video: Video,
  audio: Mic,
  signature: Pencil,
  typed_attestation: CheckCircle2,
  formula: Calculator,
  calc: Calculator,
  risk_matrix: Sliders,
  heading: Type,
  paragraph: AlignLeft,
  image: ImageIcon,
  divider: Minus,
}

// Categorized palette. The first group of each section gets prominent
// placement at the top; rare ones live in "More" further down.
type PaletteGroup = { label: string; types: FieldType[] }
const PALETTE_PRIMARY: PaletteGroup[] = [
  { label: 'Common', types: ['text', 'long_text', 'number', 'date', 'select', 'checkbox_group', 'pass_fail_na', 'signature', 'photo', 'file', 'person_picker', 'formula'] },
]
const PALETTE_MORE: PaletteGroup[] = [
  { label: 'Standard', types: ['textarea', 'datetime', 'time', 'email', 'phone', 'url'] },
  { label: 'Choice', types: ['radio', 'multi_select'] },
  { label: 'Scoring', types: ['rating', 'yes_no_comment', 'traffic_light'] },
  { label: 'Pickers', types: ['multi_person_picker', 'site_picker', 'equipment_picker', 'ppe_picker', 'document_picker', 'course_picker'] },
  { label: 'Media', types: ['video', 'audio'] },
  { label: 'Identity', types: ['typed_attestation'] },
  { label: 'Computed', types: ['calc', 'risk_matrix'] },
  { label: 'Display', types: ['heading', 'paragraph', 'image', 'divider'] },
]

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

function emptyField(type: FieldType): FormField {
  return {
    id: newId('f'),
    type,
    label: { en: FIELD_TYPES[type].label },
    required: false,
  }
}

function emptyStep(): FormWorkflowStep {
  return {
    key: newId('step'),
    title: { en: 'New step' },
    assignee: { type: 'expression', expr: '$submitter' },
  }
}

export function FormDesigner({
  templateId,
  templateName,
  initialSchema,
  currentVersion,
}: {
  templateId: string
  templateName: string
  initialSchema: FormSchemaV1
  currentVersion: number
}) {
  const router = useRouter()
  const [schema, setSchema] = useState<FormSchemaV1>(initialSchema)
  const [selection, setSelection] = useState<
    | { kind: 'form' }
    | { kind: 'section'; sectionId: string }
    | { kind: 'field'; sectionId: string; fieldId: string }
    | { kind: 'workflow' }
  >({ kind: 'form' })
  const [showPreview, setShowPreview] = useState(true)
  const [showMorePalette, setShowMorePalette] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [changelog, setChangelog] = useState('')

  const selectedField = useMemo(() => {
    if (selection.kind !== 'field') return null
    for (const sec of schema.sections) {
      const f = sec.fields.find((x) => x.id === selection.fieldId)
      if (f) return { section: sec, field: f }
    }
    return null
  }, [schema, selection])

  const selectedSection = useMemo(() => {
    if (selection.kind !== 'section') return null
    return schema.sections.find((s) => s.id === selection.sectionId) ?? null
  }, [schema, selection])

  function update(fn: (draft: FormSchemaV1) => FormSchemaV1) {
    setSchema((s) => fn(structuredClone(s)))
  }

  function addSection() {
    const id = newId('sec')
    update((draft) => {
      draft.sections.push({
        id,
        title: { en: 'New section' },
        fields: [],
      })
      return draft
    })
    setSelection({ kind: 'section', sectionId: id })
  }

  function addField(sectionId: string, type: FieldType) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      const f = emptyField(type)
      sec.fields.push(f)
      setSelection({ kind: 'field', sectionId, fieldId: f.id })
      return draft
    })
  }

  function deleteField(sectionId: string, fieldId: string) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      sec.fields = sec.fields.filter((f) => f.id !== fieldId)
      return draft
    })
    if (selection.kind === 'field' && selection.fieldId === fieldId) {
      setSelection({ kind: 'section', sectionId })
    }
  }

  function deleteSection(sectionId: string) {
    update((draft) => {
      draft.sections = draft.sections.filter((s) => s.id !== sectionId)
      return draft
    })
    setSelection({ kind: 'form' })
  }

  function moveField(sectionId: string, fieldId: string, delta: -1 | 1) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      const i = sec.fields.findIndex((f) => f.id === fieldId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= sec.fields.length) return draft
      ;[sec.fields[i], sec.fields[j]] = [sec.fields[j]!, sec.fields[i]!]
      return draft
    })
  }

  function moveSection(sectionId: string, delta: -1 | 1) {
    update((draft) => {
      const i = draft.sections.findIndex((s) => s.id === sectionId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= draft.sections.length) return draft
      ;[draft.sections[i], draft.sections[j]] = [draft.sections[j]!, draft.sections[i]!]
      return draft
    })
  }

  function updateField(sectionId: string, fieldId: string, patch: Partial<FormField>) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      const idx = sec.fields.findIndex((f) => f.id === fieldId)
      if (idx < 0) return draft
      sec.fields[idx] = { ...sec.fields[idx]!, ...patch }
      return draft
    })
  }

  function updateSection(sectionId: string, patch: Partial<FormSection>) {
    update((draft) => {
      const i = draft.sections.findIndex((s) => s.id === sectionId)
      if (i < 0) return draft
      draft.sections[i] = { ...draft.sections[i]!, ...patch }
      return draft
    })
  }

  function publish() {
    setError(null)
    start(async () => {
      const result = await publishNewVersion({
        templateId,
        schema,
        changelog: changelog.trim(),
      })
      if (!result.ok) {
        setError(result.error ?? 'Failed to publish')
        toast.error(result.error ?? 'Failed to publish')
        return
      }
      toast.success(`Published v${result.version}`)
      setShowPublish(false)
      router.push(`/forms/templates/${templateId}`)
    })
  }

  // Sections grouped by their workflow step assignment, used for the step
  // chips in the canvas header.
  const stepsCount = schema.workflow.steps.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href={`/forms/templates/${templateId}`} className="text-sm text-teal-700 hover:underline">
            ← Back
          </Link>
          <div>
            <div className="text-sm font-semibold">{templateName}</div>
            <div className="text-xs text-slate-500">
              Editing draft · current published v{currentVersion} · {schema.sections.length} sections · {stepsCount} workflow steps
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>
          <Button onClick={() => setShowPublish(true)} disabled={pending}>
            <Save size={14} />
            Publish v{currentVersion + 1}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: palette + structure */}
        <aside className="app-scroll w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
          <button
            type="button"
            onClick={() => setSelection({ kind: 'form' })}
            className={`mb-2 block w-full rounded px-2 py-1 text-left text-xs font-semibold ${
              selection.kind === 'form'
                ? 'bg-teal-50 text-teal-900'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Form properties
          </button>
          <button
            type="button"
            onClick={() => setSelection({ kind: 'workflow' })}
            className={`mb-3 block w-full rounded px-2 py-1 text-left text-xs font-semibold ${
              selection.kind === 'workflow'
                ? 'bg-teal-50 text-teal-900'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Workflow steps ({stepsCount})
          </button>

          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Add a field
          </h3>
          <p className="mb-2 text-[10px] text-slate-500">
            Click to append to selected section.
          </p>
          {PALETTE_PRIMARY.map((group) => (
            <FieldPaletteGroup
              key={group.label}
              group={group}
              onAdd={(t) => {
                const targetSection =
                  selection.kind === 'section' || selection.kind === 'field'
                    ? selection.sectionId
                    : schema.sections[schema.sections.length - 1]?.id
                if (targetSection) addField(targetSection, t)
              }}
            />
          ))}
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            onClick={() => setShowMorePalette((s) => !s)}
          >
            {showMorePalette ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            More field types
          </button>
          {showMorePalette
            ? PALETTE_MORE.map((group) => (
                <FieldPaletteGroup
                  key={group.label}
                  group={group}
                  onAdd={(t) => {
                    const targetSection =
                      selection.kind === 'section' || selection.kind === 'field'
                        ? selection.sectionId
                        : schema.sections[schema.sections.length - 1]?.id
                    if (targetSection) addField(targetSection, t)
                  }}
                />
              ))
            : null}
        </aside>

        {/* Middle: canvas (+ optional preview) */}
        <div className="app-scroll flex-1 overflow-y-auto bg-slate-50 p-4">
          <div className={`mx-auto grid gap-4 ${showPreview ? 'max-w-6xl grid-cols-2' : 'max-w-3xl grid-cols-1'}`}>
            <div className="space-y-3">
              {selection.kind === 'workflow' ? (
                <WorkflowEditor
                  schema={schema}
                  onChange={(steps) =>
                    setSchema((s) => ({ ...s, workflow: { steps } }))
                  }
                />
              ) : null}

              {schema.sections.map((sec, i) => {
                const active = selection.kind === 'section' && selection.sectionId === sec.id
                return (
                  <Card
                    key={sec.id}
                    className={`border ${active ? 'border-teal-500 ring-1 ring-teal-500' : 'border-slate-200'}`}
                  >
                    <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                      <button
                        type="button"
                        onClick={() => setSelection({ kind: 'section', sectionId: sec.id })}
                        className="flex-1 text-left"
                      >
                        <CardTitle className="text-base">
                          {sec.title?.en ?? 'Untitled section'}{' '}
                          {sec.repeating ? <Badge variant="secondary">repeating</Badge> : null}
                          {sec.showIf ? <Badge variant="outline" className="text-[10px]">conditional</Badge> : null}
                          {sec.step ? (
                            <Badge variant="outline" className="text-[10px]">step · {stepLabel(schema, sec.step)}</Badge>
                          ) : null}
                        </CardTitle>
                      </button>
                      <div className="flex items-center gap-1">
                        <IconButton title="Move up" onClick={() => moveSection(sec.id, -1)} disabled={i === 0}>
                          <ArrowUp size={14} />
                        </IconButton>
                        <IconButton
                          title="Move down"
                          onClick={() => moveSection(sec.id, 1)}
                          disabled={i === schema.sections.length - 1}
                        >
                          <ArrowDown size={14} />
                        </IconButton>
                        <IconButton title="Delete section" onClick={() => deleteSection(sec.id)}>
                          <Trash2 size={14} className="text-red-500" />
                        </IconButton>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {sec.fields.length === 0 ? (
                        <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">
                          No fields. Click a field type in the palette to add one.
                        </div>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {sec.fields.map((f, j) => {
                            const isSelected =
                              selection.kind === 'field' && selection.fieldId === f.id
                            const Icon = FIELD_ICONS[f.type] ?? Type
                            return (
                              <li
                                key={f.id}
                                className={`flex items-center justify-between gap-2 px-2 py-2 ${
                                  isSelected ? 'bg-teal-50' : ''
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelection({ kind: 'field', sectionId: sec.id, fieldId: f.id })
                                  }
                                  className="flex flex-1 items-center gap-2 text-left"
                                >
                                  <Icon size={14} />
                                  <span className="text-xs text-slate-400 w-24 truncate">
                                    {FIELD_TYPES[f.type]?.label ?? f.type}
                                  </span>
                                  <span className="text-sm font-medium">
                                    {f.label?.en ?? f.id}
                                    {f.required || f.validation?.required ? (
                                      <span className="text-red-600"> *</span>
                                    ) : null}
                                  </span>
                                  {f.showIf ? (
                                    <Badge variant="secondary" className="text-[10px]">
                                      conditional
                                    </Badge>
                                  ) : null}
                                  {f.formula ? (
                                    <Badge variant="secondary" className="text-[10px]">
                                      calc
                                    </Badge>
                                  ) : null}
                                </button>
                                <div className="flex items-center gap-1">
                                  <IconButton
                                    title="Move up"
                                    onClick={() => moveField(sec.id, f.id, -1)}
                                    disabled={j === 0}
                                  >
                                    <ArrowUp size={12} />
                                  </IconButton>
                                  <IconButton
                                    title="Move down"
                                    onClick={() => moveField(sec.id, f.id, 1)}
                                    disabled={j === sec.fields.length - 1}
                                  >
                                    <ArrowDown size={12} />
                                  </IconButton>
                                  <IconButton title="Delete" onClick={() => deleteField(sec.id, f.id)}>
                                    <Trash2 size={12} className="text-red-500" />
                                  </IconButton>
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
              <Button variant="outline" onClick={addSection} className="w-full">
                <Plus size={14} />
                Add section
              </Button>
            </div>
            {showPreview ? (
              <div className="sticky top-0 self-start">
                <Preview schema={schema} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Right: properties */}
        <aside className="app-scroll w-96 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {selection.kind === 'field' && selectedField ? (
            <FieldProperties
              key={selectedField.field.id}
              sectionId={selectedField.section.id}
              field={selectedField.field}
              schema={schema}
              onChange={(patch) =>
                updateField(selectedField.section.id, selectedField.field.id, patch)
              }
            />
          ) : selection.kind === 'section' && selectedSection ? (
            <SectionProperties
              key={selectedSection.id}
              section={selectedSection}
              schema={schema}
              onChange={(patch) => updateSection(selectedSection.id, patch)}
            />
          ) : selection.kind === 'workflow' ? (
            <div className="text-sm text-slate-600">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Workflow steps</h3>
              <p className="text-xs">
                Use the editor in the canvas to add / rename / reorder workflow steps. Bind each
                section (and via the section, each field) to a step from the Section properties tab.
              </p>
            </div>
          ) : (
            <FormProperties
              schema={schema}
              onChange={(patch) => setSchema((s) => ({ ...s, ...patch }))}
            />
          )}
        </aside>
      </div>

      {showPublish ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Publish v{currentVersion + 1}</CardTitle>
                <button onClick={() => setShowPublish(false)} aria-label="Close">
                  <X size={18} className="text-slate-400 hover:text-slate-700" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert variant="info">
                <AlertTitle>Immutable version</AlertTitle>
                <AlertDescription>
                  This snapshots the current schema as v{currentVersion + 1}. Existing responses
                  still render against the version they were submitted under.
                </AlertDescription>
              </Alert>
              <div className="space-y-1">
                <Label>Changelog</Label>
                <Textarea
                  rows={3}
                  value={changelog}
                  placeholder="Short description of what changed"
                  onChange={(e) => setChangelog(e.target.value)}
                />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowPublish(false)}>
                  Cancel
                </Button>
                <Button onClick={publish} disabled={pending}>
                  <Check size={14} />
                  {pending ? 'Publishing…' : 'Publish'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function stepLabel(schema: FormSchemaV1, stepKey: string): string {
  const step = schema.workflow.steps.find((s) => s.key === stepKey)
  return step?.title?.en ?? stepKey
}

function FieldPaletteGroup({
  group,
  onAdd,
}: {
  group: { label: string; types: FieldType[] }
  onAdd: (t: FieldType) => void
}) {
  return (
    <div className="mb-3">
      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {group.label}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {group.types.map((t) => {
          const Icon = FIELD_ICONS[t] ?? Type
          return (
            <button
              key={t}
              type="button"
              onClick={() => onAdd(t)}
              className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-left text-xs hover:border-teal-500 hover:bg-teal-50"
            >
              <Icon size={12} />
              {FIELD_TYPES[t].label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

// --- Form-level properties -------------------------------------------------

function FormProperties({
  schema,
  onChange,
}: {
  schema: FormSchemaV1
  onChange: (patch: Partial<FormSchemaV1>) => void
}) {
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-slate-700">Form properties</h3>
      <div className="space-y-1">
        <Label className="text-xs">Title (EN)</Label>
        <Input
          value={schema.title.en ?? ''}
          onChange={(e) => onChange({ title: { ...schema.title, en: e.target.value } })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description (EN)</Label>
        <Textarea
          rows={3}
          value={schema.description?.en ?? ''}
          onChange={(e) =>
            onChange({
              description: e.target.value ? { ...(schema.description ?? {}), en: e.target.value } : undefined,
            })
          }
        />
      </div>
      <p className="text-xs text-slate-500">
        Select a section or field from the canvas to edit its properties.
      </p>
    </div>
  )
}

// --- Workflow editor -------------------------------------------------------

function WorkflowEditor({
  schema,
  onChange,
}: {
  schema: FormSchemaV1
  onChange: (steps: FormWorkflowStep[]) => void
}) {
  const steps = schema.workflow.steps

  function setStep(i: number, patch: Partial<FormWorkflowStep>) {
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  }
  function add() {
    onChange([...steps, emptyStep()])
  }
  function remove(i: number) {
    if (steps.length === 1) return
    onChange(steps.filter((_, j) => j !== i))
  }
  function move(i: number, delta: -1 | 1) {
    const j = i + delta
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }

  return (
    <Card className="border-2 border-teal-500/40">
      <CardHeader>
        <CardTitle className="text-base">Workflow steps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-500">
          A step is one stage of the form (e.g. "Submit", "Supervisor sign", "Manager review").
          Bind each section to a step in the section properties.
        </p>
        <ul className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.key} className="rounded-md border border-slate-200 bg-white p-2">
              <div className="flex items-start gap-2">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">
                  {i + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px]">Title</Label>
                      <Input
                        className="h-7 text-xs"
                        value={s.title?.en ?? ''}
                        onChange={(e) =>
                          setStep(i, { title: { ...(s.title ?? {}), en: e.target.value } })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Key (immutable id)</Label>
                      <Input className="h-7 font-mono text-xs" value={s.key} disabled />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px]">Assignee kind</Label>
                      <Select
                        className="h-7 text-xs"
                        value={s.assignee.type}
                        onChange={(e) => {
                          const t = e.target.value as 'literal' | 'role' | 'expression'
                          const assignee =
                            t === 'literal'
                              ? { type: 'literal' as const, userId: '' }
                              : t === 'role'
                                ? { type: 'role' as const, role: '' }
                                : { type: 'expression' as const, expr: '$submitter' }
                          setStep(i, { assignee })
                        }}
                      >
                        <option value="expression">Expression</option>
                        <option value="role">Role</option>
                        <option value="literal">Specific user</option>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Assignee value</Label>
                      <Input
                        className="h-7 text-xs"
                        value={
                          s.assignee.type === 'literal'
                            ? s.assignee.userId
                            : s.assignee.type === 'role'
                              ? s.assignee.role
                              : s.assignee.expr
                        }
                        onChange={(e) => {
                          const v = e.target.value
                          if (s.assignee.type === 'literal')
                            setStep(i, { assignee: { type: 'literal', userId: v } })
                          else if (s.assignee.type === 'role')
                            setStep(i, { assignee: { type: 'role', role: v } })
                          else setStep(i, { assignee: { type: 'expression', expr: v } })
                        }}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={s.signatureRequired ?? false}
                      onChange={(e) => setStep(i, { signatureRequired: e.target.checked })}
                    />
                    Signature required
                  </label>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <IconButton title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp size={12} />
                  </IconButton>
                  <IconButton
                    title="Move down"
                    onClick={() => move(i, 1)}
                    disabled={i === steps.length - 1}
                  >
                    <ArrowDown size={12} />
                  </IconButton>
                  <IconButton
                    title="Delete (must keep at least one)"
                    onClick={() => remove(i)}
                    disabled={steps.length === 1}
                  >
                    <Trash2 size={12} className="text-red-500" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={add} className="w-full">
          <Plus size={14} /> Add step
        </Button>
      </CardContent>
    </Card>
  )
}

// --- Field properties (Basic / Validation / Logic / Default / Calc) -------

type FieldPropTab = 'basic' | 'validation' | 'logic' | 'default' | 'calc'

function FieldProperties({
  field,
  schema,
  onChange,
}: {
  sectionId: string
  field: FormField
  schema: FormSchemaV1
  onChange: (patch: Partial<FormField>) => void
}) {
  const [tab, setTab] = useState<FieldPropTab>('basic')
  const isCalcField = field.type === 'formula' || field.type === 'calc'
  const otherFields = schema.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.id !== field.id)
    .map((f) => ({ id: f.id, label: f.label?.en ?? f.id }))
  const repeatingSections = schema.sections
    .filter((s) => s.repeating)
    .map((s) => ({
      id: s.id,
      label: s.title?.en ?? s.id,
      fields: s.fields.map((f) => ({ id: f.id, label: f.label?.en ?? f.id })),
    }))
  // Single-entity picker fields the formula builder's entity_attr operator
  // can target. Multi-pickers are excluded because entity_attr resolves one
  // entity per picker, not a list.
  const pickerFields = schema.sections
    .filter((s) => !s.repeating)
    .flatMap((s) => s.fields)
    .filter((f) => entityKindForPicker(f.type) !== null)
    .map((f) => ({
      id: f.id,
      label: f.label?.en ?? f.id,
      kind: entityKindForPicker(f.type)!,
    }))

  const tabs: { value: FieldPropTab; label: string; show: boolean }[] = [
    { value: 'basic', label: 'Basic', show: true },
    { value: 'validation', label: 'Validation', show: true },
    { value: 'logic', label: 'Logic', show: true },
    { value: 'default', label: 'Default', show: true },
    { value: 'calc', label: 'Calc', show: isCalcField },
  ]

  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-slate-700">
        Field — {FIELD_TYPES[field.type]?.label ?? field.type}
      </h3>
      <div className="flex gap-1 border-b border-slate-200">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`-mb-px border-b-2 px-2 py-1 text-xs ${
                tab === t.value
                  ? 'border-teal-600 font-semibold text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === 'basic' ? (
        <FieldBasicTab field={field} schema={schema} onChange={onChange} />
      ) : null}
      {tab === 'validation' ? (
        <FieldValidationTab field={field} onChange={onChange} />
      ) : null}
      {tab === 'logic' ? (
        <div className="space-y-1">
          <Label className="text-xs">Show when (showIf)</Label>
          <p className="text-[10px] text-slate-500">
            Field is rendered only when all/any clauses match.
          </p>
          <LogicBuilder
            rule={field.showIf}
            availableFields={otherFields}
            onChange={(rule) => onChange({ showIf: rule })}
          />
        </div>
      ) : null}
      {tab === 'default' ? (
        <FieldDefaultTab field={field} onChange={onChange} />
      ) : null}
      {tab === 'calc' && isCalcField ? (
        <div className="space-y-1">
          <Label className="text-xs">Formula</Label>
          <p className="text-[10px] text-slate-500">
            Computed read-only value. Recomputes on every dependency change.
          </p>
          <FormulaBuilder
            value={field.formula as FormulaExpression | undefined}
            allFields={otherFields}
            repeatingSections={repeatingSections}
            pickerFields={pickerFields}
            onChange={(next) => onChange({ formula: next })}
          />
        </div>
      ) : null}
    </div>
  )
}

function FieldBasicTab({
  field,
  schema,
  onChange,
}: {
  field: FormField
  schema: FormSchemaV1
  onChange: (patch: Partial<FormField>) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Field ID (immutable)</Label>
        <Input value={field.id} disabled className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Label (EN)</Label>
        <Input
          value={field.label?.en ?? ''}
          onChange={(e) => onChange({ label: { ...field.label, en: e.target.value } })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Help text</Label>
        <Textarea
          rows={2}
          value={field.helpText?.en ?? ''}
          onChange={(e) =>
            onChange({
              helpText: e.target.value ? { ...(field.helpText ?? {}), en: e.target.value } : undefined,
            })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required ?? false}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>
      {field.type === 'select' ||
      field.type === 'radio' ||
      field.type === 'multi_select' ||
      field.type === 'checkbox_group' ? (
        <ChoiceOptionsEditor field={field} onChange={onChange} />
      ) : null}
    </div>
  )
}

function FieldValidationTab({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const v = field.validation ?? {}
  function set(patch: Partial<typeof v>) {
    const next = { ...v, ...patch }
    // Strip undefineds so the JSON stays tight.
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if (next[k] === undefined || next[k] === '') delete (next as Record<string, unknown>)[k as string]
    }
    onChange({ validation: Object.keys(next).length ? next : undefined })
  }
  const isNumeric = field.type === 'number' || field.type === 'rating'
  const isText =
    field.type === 'text' ||
    field.type === 'textarea' ||
    field.type === 'long_text' ||
    field.type === 'email' ||
    field.type === 'phone' ||
    field.type === 'url'
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.required ?? field.required ?? false}
          onChange={(e) => set({ required: e.target.checked })}
        />
        Required (validated)
      </label>
      {isNumeric ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Min</Label>
            <Input
              type="number"
              value={v.min ?? ''}
              onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max</Label>
            <Input
              type="number"
              value={v.max ?? ''}
              onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
        </div>
      ) : null}
      {isText ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Min length</Label>
            <Input
              type="number"
              value={v.minLength ?? ''}
              onChange={(e) => set({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max length</Label>
            <Input
              type="number"
              value={v.maxLength ?? ''}
              onChange={(e) => set({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
        </div>
      ) : null}
      {isText ? (
        <div className="space-y-1">
          <Label className="text-xs">Pattern (regex)</Label>
          <Input
            value={v.pattern ?? ''}
            onChange={(e) => set({ pattern: e.target.value || undefined })}
            placeholder="e.g. ^[A-Z0-9]+$"
          />
        </div>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs">Custom error message</Label>
        <Input
          value={v.message ?? ''}
          onChange={(e) => set({ message: e.target.value || undefined })}
          placeholder="Overrides the default validator message"
        />
      </div>
    </div>
  )
}

function FieldDefaultTab({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const d = field.defaultValue as DefaultValueExpression | undefined
  const kind = d?.kind ?? ''
  function setKind(next: string) {
    if (!next) return onChange({ defaultValue: undefined })
    switch (next) {
      case 'literal':
        onChange({ defaultValue: { kind: 'literal', value: '' } })
        break
      case 'today':
        onChange({ defaultValue: { kind: 'today' } })
        break
      case 'now':
        onChange({ defaultValue: { kind: 'now' } })
        break
      case 'current_user_person_id':
        onChange({ defaultValue: { kind: 'current_user_person_id' } })
        break
      case 'current_user_name':
        onChange({ defaultValue: { kind: 'current_user_name' } })
        break
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Applied on first render when this field is empty.
      </p>
      <Select className="h-8 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">— No default —</option>
        <option value="literal">Literal value</option>
        <option value="today">Today's date</option>
        <option value="now">Right now</option>
        <option value="current_user_person_id">Current user's person id</option>
        <option value="current_user_name">Current user's name</option>
      </Select>
      {d?.kind === 'literal' ? (
        <Input
          value={String(d.value ?? '')}
          onChange={(e) => onChange({ defaultValue: { kind: 'literal', value: e.target.value } })}
          placeholder="Literal default value"
        />
      ) : null}
    </div>
  )
}

function ChoiceOptionsEditor({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const options = field.validation?.options ?? []
  const update = (next: typeof options) =>
    onChange({ validation: { ...field.validation, options: next } })
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-2">
      <div className="text-xs font-semibold text-slate-600">Options</div>
      {options.length === 0 ? (
        <p className="text-xs text-slate-500">No options yet.</p>
      ) : (
        <ul className="space-y-1">
          {options.map((opt, i) => (
            <li key={i} className="flex items-center gap-1">
              <Input
                className="h-8 flex-1 text-xs"
                value={opt.value}
                placeholder="value"
                onChange={(e) => {
                  const next = [...options]
                  next[i] = { ...opt, value: e.target.value }
                  update(next)
                }}
              />
              <Input
                className="h-8 flex-1 text-xs"
                value={opt.label?.en ?? ''}
                placeholder="label"
                onChange={(e) => {
                  const next = [...options]
                  next[i] = { ...opt, label: { ...(opt.label ?? {}), en: e.target.value } }
                  update(next)
                }}
              />
              <button
                onClick={() => update(options.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => update([...options, { value: `opt_${options.length + 1}`, label: { en: 'New option' } }])}
      >
        <Plus size={12} />
        Add option
      </Button>
    </div>
  )
}

// --- Section properties ----------------------------------------------------

function SectionProperties({
  section,
  schema,
  onChange,
}: {
  section: FormSection
  schema: FormSchemaV1
  onChange: (patch: Partial<FormSection>) => void
}) {
  const allFields = schema.sections
    .flatMap((s) => s.fields)
    .map((f) => ({ id: f.id, label: f.label?.en ?? f.id }))
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-slate-700">Section</h3>
      <div className="space-y-1">
        <Label className="text-xs">Section ID (immutable)</Label>
        <Input value={section.id} disabled className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Title (EN)</Label>
        <Input
          value={section.title?.en ?? ''}
          onChange={(e) => onChange({ title: { ...(section.title ?? {}), en: e.target.value } })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea
          rows={2}
          value={section.description?.en ?? ''}
          onChange={(e) =>
            onChange({
              description: e.target.value ? { ...(section.description ?? {}), en: e.target.value } : undefined,
            })
          }
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Workflow step (page)</Label>
        <Select
          className="h-8 text-xs"
          value={section.step ?? ''}
          onChange={(e) => onChange({ step: e.target.value || undefined })}
        >
          <option value="">— first step (default) —</option>
          {schema.workflow.steps.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title?.en ?? s.key}
            </option>
          ))}
        </Select>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={section.repeating ?? false}
          onChange={(e) => onChange({ repeating: e.target.checked })}
        />
        Repeating section (user adds N rows)
      </label>
      {section.repeating ? (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50/50 p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Min rows</Label>
              <Input
                type="number"
                value={section.minRows ?? ''}
                onChange={(e) =>
                  onChange({ minRows: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max rows</Label>
              <Input
                type="number"
                value={section.maxRows ?? ''}
                onChange={(e) =>
                  onChange({ maxRows: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Row label template</Label>
            <Input
              value={section.rowLabelTemplate ?? ''}
              placeholder="e.g. Load #{index+1}"
              onChange={(e) =>
                onChange({ rowLabelTemplate: e.target.value || undefined })
              }
            />
            <p className="text-[10px] text-slate-500">
              Supports {`{index}`}, {`{index+1}`}, and {`{<fieldKey>}`} interpolation from the row's values.
            </p>
          </div>
        </div>
      ) : null}
      <div className="space-y-1 pt-2">
        <Label className="text-xs">Show when (showIf)</Label>
        <LogicBuilder
          rule={section.showIf}
          availableFields={allFields}
          onChange={(rule) => onChange({ showIf: rule })}
        />
      </div>
    </div>
  )
}

// --- Preview pane ----------------------------------------------------------

function Preview({ schema }: { schema: FormSchemaV1 }) {
  const sections = schema.sections
  const groupedByStep = useMemo(() => {
    const out = new Map<string, FormSection[]>()
    const defaultStep = schema.workflow.steps[0]?.key ?? ''
    for (const sec of sections) {
      const k = sec.step ?? defaultStep
      const list = out.get(k) ?? []
      list.push(sec)
      out.set(k, list)
    }
    return out
  }, [sections, schema.workflow.steps])

  return (
    <Card className="border-2 border-dashed border-slate-300 bg-white">
      <CardHeader>
        <CardTitle className="text-base">Preview · {schema.title?.en}</CardTitle>
        <p className="text-xs text-slate-500">
          Live render of how the filler will see the form. Conditional logic is shown as
          chips; live filler runtime resolves them dynamically.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {schema.workflow.steps.map((step) => {
          const stepSections = groupedByStep.get(step.key) ?? []
          if (stepSections.length === 0) return null
          return (
            <div key={step.key} className="rounded-md border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                Step · {step.title?.en ?? step.key}
              </div>
              <div className="space-y-3 p-3">
                {stepSections.map((sec) => (
                  <div key={sec.id}>
                    <h3 className="mb-1 text-sm font-semibold text-slate-700">
                      {sec.title?.en}{' '}
                      {sec.repeating ? (
                        <Badge variant="secondary" className="text-[10px]">
                          repeating
                        </Badge>
                      ) : null}
                    </h3>
                    {sec.description?.en ? (
                      <p className="mb-1 text-xs text-slate-500">{sec.description.en}</p>
                    ) : null}
                    <div className="space-y-2">
                      {sec.fields.map((f) => (
                        <div key={f.id}>
                          <label className="block text-xs font-medium text-slate-600">
                            {f.label?.en}{' '}
                            {f.required || f.validation?.required ? (
                              <span className="text-red-600">*</span>
                            ) : null}
                            {f.showIf ? (
                              <Badge variant="outline" className="ml-1 text-[10px]">
                                conditional
                              </Badge>
                            ) : null}
                          </label>
                          <PreviewField type={f.type} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function PreviewField({ type }: { type: FieldType }) {
  switch (type) {
    case 'textarea':
    case 'long_text':
      return <Textarea rows={2} disabled placeholder="Preview" />
    case 'select':
    case 'radio':
      return (
        <Select disabled>
          <option>—</option>
        </Select>
      )
    case 'checkbox_group':
    case 'multi_select':
      return <p className="text-xs text-slate-400">[options will appear here]</p>
    case 'signature':
      return <div className="h-16 rounded border border-dashed border-slate-300 bg-slate-50" />
    case 'photo':
    case 'photo_upload':
    case 'file':
    case 'video':
    case 'audio':
      return (
        <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
          click to upload
        </div>
      )
    case 'heading':
      return <h4 className="text-base font-semibold">[heading]</h4>
    case 'paragraph':
      return <p className="text-xs text-slate-500">[paragraph]</p>
    case 'divider':
      return <hr className="border-slate-200" />
    case 'formula':
    case 'calc':
      return <Input disabled value="(computed)" />
    case 'pass_fail_na':
      return (
        <div className="flex gap-1">
          {['PASS', 'FAIL', 'N/A'].map((v) => (
            <span key={v} className="rounded border border-slate-200 px-2 py-1 text-[10px]">
              {v}
            </span>
          ))}
        </div>
      )
    case 'traffic_light':
      return (
        <div className="flex gap-1">
          {[
            ['bg-emerald-500', 'Green'],
            ['bg-amber-400', 'Yellow'],
            ['bg-red-500', 'Red'],
          ].map(([tone, label]) => (
            <span
              key={label as string}
              className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px]"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${tone}`} />
              {label}
            </span>
          ))}
        </div>
      )
    default:
      return <Input disabled placeholder="Preview" />
  }
}
