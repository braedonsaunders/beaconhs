'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  Plus,
  Save,
  Trash2,
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
import { FIELD_TYPES, type FieldType, type FormField, type FormSchemaV1, type FormSection } from '@beaconhs/forms-core'
import { publishNewVersion } from './actions'
import { LogicBuilder, describeRule } from './logic-builder'

type PaletteGroup = { label: string; types: FieldType[] }

const PALETTE: PaletteGroup[] = [
  { label: 'Standard', types: ['text', 'textarea', 'number', 'date', 'datetime', 'time', 'email', 'phone', 'url'] },
  { label: 'Choice', types: ['radio', 'checkbox_group', 'select', 'multi_select'] },
  { label: 'Scoring', types: ['pass_fail_na', 'rating', 'yes_no_comment', 'traffic_light'] },
  { label: 'Pickers', types: ['person_picker', 'site_picker', 'equipment_picker', 'ppe_picker', 'document_picker', 'course_picker'] },
  { label: 'Media', types: ['photo', 'file', 'video', 'audio'] },
  { label: 'Identity', types: ['signature', 'typed_attestation'] },
  { label: 'Computed', types: ['formula', 'risk_matrix'] },
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
  const [selection, setSelection] = useState<{ sectionId?: string; fieldId?: string } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [changelog, setChangelog] = useState('')

  const selectedField = useMemo(() => {
    if (!selection?.fieldId) return null
    for (const sec of schema.sections) {
      const f = sec.fields.find((x) => x.id === selection.fieldId)
      if (f) return { section: sec, field: f }
    }
    return null
  }, [schema, selection])
  const selectedSection = useMemo(() => {
    if (!selection?.sectionId || selection.fieldId) return null
    return schema.sections.find((s) => s.id === selection.sectionId) ?? null
  }, [schema, selection])

  function update(fn: (draft: FormSchemaV1) => FormSchemaV1) {
    setSchema((s) => fn(structuredClone(s)))
  }

  function addSection() {
    update((draft) => {
      draft.sections.push({
        id: newId('sec'),
        title: { en: 'New section' },
        fields: [],
      })
      return draft
    })
  }

  function addField(sectionId: string, type: FieldType) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      const f = emptyField(type)
      sec.fields.push(f)
      setSelection({ sectionId, fieldId: f.id })
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
    if (selection?.fieldId === fieldId) setSelection(null)
  }

  function deleteSection(sectionId: string) {
    update((draft) => {
      draft.sections = draft.sections.filter((s) => s.id !== sectionId)
      return draft
    })
    setSelection(null)
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
        return
      }
      setShowPublish(false)
      router.push(`/forms/templates/${templateId}`)
    })
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href={`/forms/templates/${templateId}`} className="text-sm text-teal-700 hover:underline">
            ← Back
          </Link>
          <div>
            <div className="text-sm font-semibold">{templateName}</div>
            <div className="text-xs text-slate-500">
              Editing draft · current published version v{currentVersion}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowPreview((s) => !s)}>
            <Eye size={14} />
            {showPreview ? 'Hide preview' : 'Preview'}
          </Button>
          <Button onClick={() => setShowPublish(true)} disabled={pending}>
            <Save size={14} />
            Publish v{currentVersion + 1}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Palette */}
        <aside className="app-scroll w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Add a field
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Click a field type to append it to the selected section.
          </p>
          {PALETTE.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </div>
              <div className="grid grid-cols-1 gap-1">
                {group.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      const targetSection =
                        selection?.sectionId ?? schema.sections[schema.sections.length - 1]?.id
                      if (targetSection) addField(targetSection, t)
                    }}
                    className="rounded border border-slate-200 px-2 py-1 text-left text-xs hover:border-teal-500 hover:bg-teal-50"
                  >
                    {FIELD_TYPES[t].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Canvas */}
        <div className="app-scroll flex-1 overflow-y-auto bg-slate-50 p-4">
          <div className="mx-auto max-w-3xl space-y-3">
            {schema.sections.map((sec, i) => {
              const active = selection?.sectionId === sec.id && !selection.fieldId
              return (
                <Card
                  key={sec.id}
                  className={`border ${active ? 'border-teal-500 ring-1 ring-teal-500' : 'border-slate-200'}`}
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                    <button
                      type="button"
                      onClick={() => setSelection({ sectionId: sec.id })}
                      className="flex-1 text-left"
                    >
                      <CardTitle className="text-base">
                        {sec.title?.en ?? 'Untitled section'}{' '}
                        {sec.repeating ? <Badge variant="secondary">repeating</Badge> : null}
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
                          const isSelected = selection?.fieldId === f.id
                          return (
                            <li
                              key={f.id}
                              className={`flex items-center justify-between gap-2 px-2 py-2 ${
                                isSelected ? 'bg-teal-50' : ''
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setSelection({ sectionId: sec.id, fieldId: f.id })}
                                className="flex flex-1 items-center gap-2 text-left"
                              >
                                <span className="text-xs text-slate-400 w-12">{f.type.slice(0, 12)}</span>
                                <span className="text-sm font-medium">
                                  {f.label?.en ?? f.id}
                                  {f.required ? <span className="text-red-600"> *</span> : null}
                                </span>
                                {f.showIf ? (
                                  <Badge variant="secondary" className="text-[10px]">
                                    conditional
                                  </Badge>
                                ) : null}
                              </button>
                              <div className="flex items-center gap-1">
                                <IconButton title="Move up" onClick={() => moveField(sec.id, f.id, -1)} disabled={j === 0}>
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
            {showPreview ? <Preview schema={schema} /> : null}
          </div>
        </div>

        {/* Properties */}
        <aside className="app-scroll w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4">
          {selectedField ? (
            <FieldProperties
              key={selectedField.field.id}
              sectionId={selectedField.section.id}
              field={selectedField.field}
              schema={schema}
              onChange={(patch) => updateField(selectedField.section.id, selectedField.field.id, patch)}
            />
          ) : selectedSection ? (
            <SectionProperties
              key={selectedSection.id}
              section={selectedSection}
              schema={schema}
              onChange={(patch) => updateSection(selectedSection.id, patch)}
            />
          ) : (
            <div className="text-sm text-slate-500">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Form properties</h3>
              <Label className="text-xs">Title</Label>
              <Input
                value={schema.title.en ?? ''}
                onChange={(e) =>
                  setSchema((s) => ({ ...s, title: { ...s.title, en: e.target.value } }))
                }
              />
              <p className="mt-3 text-xs text-slate-500">
                Select a section or field to edit its properties.
              </p>
            </div>
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
  const otherFields = schema.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.id !== field.id)
    .map((f) => ({ id: f.id, label: f.label?.en ?? f.id }))

  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-slate-700">Field — {FIELD_TYPES[field.type].label}</h3>
      <div className="space-y-1">
        <Label className="text-xs">Field ID</Label>
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

      {field.type === 'select' || field.type === 'radio' || field.type === 'multi_select' || field.type === 'checkbox_group' ? (
        <ChoiceOptionsEditor field={field} onChange={onChange} />
      ) : null}

      {field.type === 'number' || field.type === 'rating' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Min</Label>
            <Input
              type="number"
              value={field.validation?.min ?? ''}
              onChange={(e) =>
                onChange({
                  validation: {
                    ...field.validation,
                    min: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max</Label>
            <Input
              type="number"
              value={field.validation?.max ?? ''}
              onChange={(e) =>
                onChange({
                  validation: {
                    ...field.validation,
                    max: e.target.value ? Number(e.target.value) : undefined,
                  },
                })
              }
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-1 pt-2">
        <Label className="text-xs">Visibility (showIf)</Label>
        <LogicBuilder
          rule={field.showIf}
          availableFields={otherFields}
          onChange={(rule) => onChange({ showIf: rule })}
        />
      </div>
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
        <Label className="text-xs">Section ID</Label>
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
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={section.repeating ?? false}
          onChange={(e) => onChange({ repeating: e.target.checked })}
        />
        Repeating section (user adds N rows)
      </label>
      <div className="space-y-1 pt-2">
        <Label className="text-xs">Visibility (showIf)</Label>
        <LogicBuilder
          rule={section.showIf}
          availableFields={allFields}
          onChange={(rule) => onChange({ showIf: rule })}
        />
      </div>
    </div>
  )
}

function Preview({ schema }: { schema: FormSchemaV1 }) {
  return (
    <Card className="mt-6 border-2 border-dashed border-slate-300 bg-white">
      <CardHeader>
        <CardTitle>Preview · {schema.title.en}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {schema.sections.map((sec) => (
          <div key={sec.id}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">{sec.title?.en}</h3>
            <div className="space-y-2">
              {sec.fields.map((f) => (
                <div key={f.id}>
                  <label className="block text-xs font-medium text-slate-600">
                    {f.label?.en} {f.required ? <span className="text-red-600">*</span> : null}
                  </label>
                  <PreviewField type={f.type} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function PreviewField({ type }: { type: FieldType }) {
  switch (type) {
    case 'textarea':
      return <Textarea rows={2} disabled placeholder="Preview" />
    case 'select':
    case 'radio':
      return (
        <Select disabled>
          <option>—</option>
        </Select>
      )
    case 'checkbox_group':
      return <p className="text-xs text-slate-400">[checkbox group preview]</p>
    case 'signature':
      return <div className="h-16 rounded border border-dashed border-slate-300 bg-slate-50" />
    case 'photo':
    case 'file':
      return <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">click to upload</div>
    case 'heading':
      return <h4 className="text-base font-semibold">[heading]</h4>
    case 'paragraph':
      return <p className="text-xs text-slate-500">[paragraph]</p>
    case 'divider':
      return <hr className="border-slate-200" />
    default:
      return <Input disabled placeholder="Preview" />
  }
}
