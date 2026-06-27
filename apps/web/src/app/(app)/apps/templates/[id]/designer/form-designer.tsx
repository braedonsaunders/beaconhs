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

import { useCallback, useEffect, useRef, useState, useTransition, useMemo } from 'react'
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
  ClipboardCheck,
  Eye,
  FileText,
  GripVertical,
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
  Table2,
  Trash2,
  Type,
  Upload,
  User,
  Users,
  Video,
} from 'lucide-react'
import { Reorder, useDragControls } from 'framer-motion'
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
  Drawer,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import {
  FIELD_TYPES,
  entityKindForPicker,
  FORM_TEMPLATE_ACTIONS,
  FORM_TEMPLATE_TRIGGERS,
  FORM_STATUS_VALUES,
  type CanvasLayout,
  type DataBinding,
  type FlowSubjectProfile,
  type DefaultValueExpression,
  type FieldType,
  type FormField,
  type FormSchemaV1,
  type FormSection,
  type FormulaExpression,
  type FormWorkflowStep,
  type TableColumn,
  type TableConfig,
} from '@beaconhs/forms-core'
import { toast } from '@/lib/toast'
import { publishNewVersion, updateAppOverview, updateAppPermissions } from './actions'
import { RecordBehaviorPanel, type RecordConfig } from './_record-behavior-panel'
import { RecordActionsPanel } from './_record-actions-panel'
import { RecordListPanel } from './_record-list-panel'
import type { ListConfig } from './actions'
import { LogicBuilder } from './logic-builder'
import { FormulaBuilder } from './formula-builder'
import { CanvasEditor, defaultBox } from './_canvas-editor'
import { FlowsCanvas, type FlowSummary, type RecipientOptions } from '../flows/_flows-canvas'
import { AiAssistant } from '@/components/ai-assistant'
import { runAppBuilderChat } from '../../../_ai-actions'
import { PinFormButton } from '../../../_pin-button'
import {
  BarChart3,
  Bold,
  Briefcase,
  Building2,
  Database,
  Info,
  LayoutGrid,
  ListOrdered,
  Map as MapIcon,
  MapPinned,
  MousePointerClick,
  PanelLeft,
  PenTool,
  RefreshCw,
  ScanLine,
  Send,
  SlidersHorizontal,
  Sparkles,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { listDataSources, type DataSourceSummary } from '../../../_lib/data-sources'

// --- Palette ---------------------------------------------------------------

// Field-type icon registry. Falls back to a generic Type icon for unknowns.
const FIELD_ICONS: Partial<Record<FieldType, React.ComponentType<{ size?: number }>>> = {
  text: Type,
  textarea: AlignLeft,
  long_text: AlignLeft,
  number: Hash,
  slider: Sliders,
  gps: MapPin,
  matrix: LayoutGrid,
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
  customer_picker: Building2,
  project_picker: Briefcase,
  site_picker: MapPin,
  area_picker: MapIcon,
  equipment_picker: Package,
  ppe_picker: Package,
  document_picker: FileText,
  course_picker: ClipboardCheck,
  photo: ImageIcon,
  photo_upload: ImageIcon,
  photo_ai: Sparkles,
  photo_annotated: MapPinned,
  file: Upload,
  video: Video,
  audio: Mic,
  sketch: PenTool,
  signature: Pencil,
  typed_attestation: CheckCircle2,
  formula: Calculator,
  calc: Calculator,
  risk_matrix: Sliders,
  heading: Type,
  paragraph: AlignLeft,
  image: ImageIcon,
  divider: Minus,
  table: Table2,
  lookup: Database,
  data_table: Table2,
  metric: BarChart3,
  qr_scanner: ScanLine,
  ranking: ListOrdered,
  rich_text: Bold,
  address: MapPin,
}

// Categorized palette. The first group of each section gets prominent
// placement at the top; rare ones live in "More" further down.
type PaletteGroup = { label: string; types: FieldType[] }
// One element per concept — no duplicates across groups. `long_text` is the
// canonical multi-line text (legacy `textarea` is omitted) and `formula` is the
// canonical computed value (legacy `calc` is omitted); both legacy types still
// render fine on existing forms — they're just not offered for new fields.
const PALETTE_PRIMARY: PaletteGroup[] = [
  {
    label: 'Common',
    types: [
      'text',
      'long_text',
      'number',
      'slider',
      'date',
      'table',
      'select',
      'checkbox_group',
      'pass_fail_na',
      'signature',
      'photo',
      'file',
      'person_picker',
      'formula',
    ],
  },
]
const PALETTE_MORE: PaletteGroup[] = [
  {
    label: 'Date & contact',
    types: ['datetime', 'time', 'gps', 'address', 'email', 'phone', 'url', 'qr_scanner'],
  },
  { label: 'Choice', types: ['radio', 'multi_select', 'ranking'] },
  { label: 'Scoring', types: ['rating', 'matrix', 'yes_no_comment', 'traffic_light'] },
  {
    label: 'Pickers',
    types: [
      'multi_person_picker',
      'customer_picker',
      'project_picker',
      'site_picker',
      'area_picker',
      'equipment_picker',
      'ppe_picker',
      'document_picker',
      'course_picker',
    ],
  },
  { label: 'Media', types: ['photo_ai', 'photo_annotated', 'sketch', 'video', 'audio'] },
  { label: 'Computed', types: ['risk_matrix', 'typed_attestation'] },
  { label: 'Data', types: ['lookup', 'data_table', 'metric'] },
  { label: 'Display', types: ['heading', 'paragraph', 'rich_text', 'image', 'divider'] },
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

const KIND_META: Record<
  'form' | 'wizard' | 'checklist' | 'register' | 'mini_app',
  { label: string; cls: string }
> = {
  form: { label: 'Form', cls: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300' },
  wizard: {
    label: 'Wizard',
    cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  },
  checklist: {
    label: 'Checklist',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  register: {
    label: 'Register',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  mini_app: {
    label: 'Mini-app',
    cls: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  },
}

export type AppOverview = {
  description: string | null
  category: string | null
  iconKey: string | null
  emailOnSubmit: boolean
  surfaceAsTool: boolean
}

export function FormDesigner({
  templateId,
  templateName,
  templateKind = 'form',
  initialSchema,
  currentVersion,
  initialSurface = 'build',
  overview,
  recordConfig,
  allowedRoles = [],
  roles = [],
  flows = [],
  emailTemplates = [],
  pdfTemplates = [],
  recipientOptions,
  canGenerate = false,
  canPin = false,
  pinned = false,
}: {
  templateId: string
  templateName: string
  templateKind?: 'form' | 'wizard' | 'checklist' | 'register' | 'mini_app'
  initialSchema: FormSchemaV1
  currentVersion: number
  initialSurface?: 'build' | 'flows'
  overview?: AppOverview
  recordConfig?: RecordConfig
  allowedRoles?: string[]
  roles?: { key: string; name: string }[]
  flows?: FlowSummary[]
  emailTemplates?: { id: string; name: string }[]
  pdfTemplates?: { id: string; name: string }[]
  recipientOptions?: RecipientOptions
  canGenerate?: boolean
  canPin?: boolean
  pinned?: boolean
}) {
  const router = useRouter()
  const [schema, setSchema] = useState<FormSchemaV1>(initialSchema)
  const [appName, setAppName] = useState(templateName)
  // Unified editor: left rail tab + right surface.
  const [leftTab, setLeftTab] = useState<
    'overview' | 'build' | 'record' | 'list' | 'actions' | 'assignments' | 'permissions'
  >('build')
  const [surface, setSurface] = useState<'build' | 'flows'>(initialSurface)
  const [designerTab, setDesignerTab] = useState<string>(() => initialSchema.tabs?.[0]?.id ?? '')
  const [showAiAssistant, setShowAiAssistant] = useState(false)
  // The element type currently being dragged from the left palette — read by the
  // canvas on drop. (HTML5 dataTransfer is also set, for the browser's drag UX.)
  const dragElementRef = useRef<FieldType | null>(null)
  const [selection, setSelection] = useState<
    | { kind: 'form' }
    | { kind: 'section'; sectionId: string }
    | { kind: 'field'; sectionId: string; fieldId: string }
    | { kind: 'workflow' }
  >({ kind: 'form' })
  // Which right-hand flyout is open. Preview + properties used to be permanent
  // columns (too cramped); now they slide in on demand.
  const [rightPanel, setRightPanel] = useState<'none' | 'props' | 'preview'>('none')
  const [showPublish, setShowPublish] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [changelog, setChangelog] = useState('')

  // Live field ids power Flow conditions even before publishing.
  const liveFieldIds = useMemo(() => {
    const ids: string[] = []
    for (const sec of schema.sections) for (const f of sec.fields) ids.push(f.id)
    return ids
  }, [schema])

  // Selectable fields for the records-list "List" tab — real answer fields only
  // (content-only display elements carry no data to show in a column).
  const listFields = useMemo(() => {
    const skip = new Set(['heading', 'paragraph', 'divider', 'image', 'metric'])
    const out: { id: string; label: string }[] = []
    for (const sec of schema.sections)
      for (const f of sec.fields) {
        if (skip.has(f.type)) continue
        out.push({ id: f.id, label: f.label?.en?.trim() || f.id })
      }
    return out
  }, [schema])

  // Current records-list config lives under recordConfig.list (the page passes
  // the full recordConfig jsonb; its type omits `list`, but it's there at runtime).
  const listConfig = (recordConfig as { list?: ListConfig } | undefined)?.list

  // The form-template flow subject: the full Builder vocabulary, fields = live ids.
  const flowProfile = useMemo<FlowSubjectProfile>(
    () => ({
      subjectType: 'form_template',
      subjectKey: templateId,
      label: appName,
      triggers: FORM_TEMPLATE_TRIGGERS,
      actions: FORM_TEMPLATE_ACTIONS,
      statusValues: FORM_STATUS_VALUES,
      richPdf: true,
      fields: liveFieldIds.map((id) => ({ key: id, label: id })),
    }),
    [templateId, appName, liveFieldIds],
  )

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

  // Selecting something opens the properties flyout; workflow is edited in the
  // canvas so it just switches the canvas view.
  function selectField(sectionId: string, fieldId: string) {
    setSelection({ kind: 'field', sectionId, fieldId })
    setRightPanel('props')
  }
  function selectSection(sectionId: string) {
    setSelection({ kind: 'section', sectionId })
    setRightPanel('props')
  }
  function openWorkflow() {
    setSelection({ kind: 'workflow' })
    setRightPanel('none')
  }

  function addSection() {
    const id = newId('sec')
    update((draft) => {
      draft.sections.push({
        id,
        title: { en: 'New section' },
        fields: [],
        // New sections land in the active designer tab (if the app uses tabs).
        ...(draft.tabs?.length ? { tabId: designerTab || draft.tabs[0]!.id } : {}),
      })
      return draft
    })
    selectSection(id)
  }

  // --- Tabs (presentational app pages) -------------------------------------

  function addTab() {
    const id = newId('tab')
    update((draft) => {
      const tabs = draft.tabs ?? []
      const title = { en: `Tab ${tabs.length + 1}` }
      if (tabs.length === 0) {
        // First tab: pull every existing section into it so nothing is orphaned.
        draft.tabs = [{ id, title }]
        for (const s of draft.sections) s.tabId = id
      } else {
        draft.tabs = [...tabs, { id, title }]
      }
      return draft
    })
    setDesignerTab(id)
  }

  function renameTab(id: string, en: string) {
    update((draft) => {
      const t = draft.tabs?.find((x) => x.id === id)
      if (t) t.title = { en }
      return draft
    })
  }

  function deleteTab(id: string) {
    update((draft) => {
      const remaining = (draft.tabs ?? []).filter((t) => t.id !== id)
      const fallback = remaining[0]?.id
      for (const s of draft.sections) if (s.tabId === id) s.tabId = fallback
      draft.tabs = remaining.length ? remaining : undefined
      return draft
    })
    setDesignerTab((cur) => (cur === id ? (schema.tabs?.find((t) => t.id !== id)?.id ?? '') : cur))
  }

  function addField(sectionId: string, type: FieldType) {
    const f = emptyField(type)
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      sec.fields.push(f)
      // If the section is in canvas mode, also place the new element on the grid
      // (append below everything) — otherwise a clicked element would be invisible.
      if (sec.canvas) {
        const box = defaultBox(type)
        const bottomY = sec.canvas.items.reduce((m, it) => Math.max(m, it.y + it.h), 0)
        sec.canvas = {
          ...sec.canvas,
          items: [
            ...sec.canvas.items,
            { i: f.id, x: 0, y: bottomY, w: Math.min(box.w * 2, 12), h: box.h },
          ],
        }
      }
      return draft
    })
    selectField(sectionId, f.id)
  }

  function deleteField(sectionId: string, fieldId: string) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      sec.fields = sec.fields.filter((f) => f.id !== fieldId)
      // Keep the canvas layout in sync — drop the deleted field's box.
      if (sec.canvas)
        sec.canvas = { ...sec.canvas, items: sec.canvas.items.filter((it) => it.i !== fieldId) }
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

  // Drag-to-reorder fields within a section (framer-motion Reorder). Replaces
  // the schema's field order with the dragged order; the up/down arrows remain
  // as a keyboard-accessible fallback.
  function reorderFields(sectionId: string, fields: FormField[]) {
    setSchema((s) => ({
      ...s,
      sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, fields } : sec)),
    }))
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

  // --- Canvas (free-form positioned layout) --------------------------------

  function canvasBoxFor(type: FieldType): { w: number; h: number } {
    return defaultBox(type)
  }

  // Free-form CANVAS layout is a GLOBAL, app-level mode (advanced) — not a
  // per-section toggle. Turning it on auto-places every section's fields in a
  // column so nothing is lost; turning it off drops the positioning back to a
  // stacked layout.
  function setAllCanvas(on: boolean) {
    update((draft) => {
      for (const sec of draft.sections) {
        if (on && !sec.canvas) {
          let y = 0
          sec.canvas = {
            cols: 12,
            rowHeight: 40,
            items: sec.fields.map((f) => {
              const box = canvasBoxFor(f.type)
              const item = { i: f.id, x: 0, y, w: Math.min(box.w * 2, 12), h: box.h }
              y += box.h
              return item
            }),
          }
        } else if (!on && sec.canvas) {
          delete sec.canvas
        }
      }
      return draft
    })
  }
  const canvasMode = schema.sections.length > 0 && schema.sections.every((s) => !!s.canvas)
  // When the app uses tabs, the build surface shows one tab's sections at a time.
  const appTabs = schema.tabs ?? []
  const visibleSections = appTabs.length
    ? schema.sections.filter((s) => (s.tabId ?? appTabs[0]!.id) === designerTab)
    : schema.sections

  function setCanvasItems(sectionId: string, items: CanvasLayout['items']) {
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec || !sec.canvas) return draft
      sec.canvas = { ...sec.canvas, items }
      return draft
    })
  }

  function addWidgetToCanvas(
    sectionId: string,
    type: FieldType,
    box: { x: number; y: number; w: number; h: number },
  ) {
    const f = emptyField(type)
    update((draft) => {
      const sec = draft.sections.find((s) => s.id === sectionId)
      if (!sec) return draft
      sec.fields.push(f)
      const canvas = sec.canvas ?? { cols: 12, rowHeight: 40, items: [] }
      sec.canvas = {
        ...canvas,
        items: [...canvas.items, { i: f.id, x: box.x, y: box.y, w: box.w, h: box.h }],
      }
      return draft
    })
    selectField(sectionId, f.id)
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
      router.push(`/apps/templates/${templateId}`)
    })
  }

  // Sections grouped by their workflow step assignment, used for the step
  // chips in the canvas header.
  const stepsCount = schema.workflow.steps.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/apps" className="shrink-0 text-sm text-teal-700 hover:underline">
            ← Builder
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{appName}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${KIND_META[templateKind].cls}`}
              >
                {KIND_META[templateKind].label}
              </span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Draft · published v{currentVersion} · {schema.sections.length} section
              {schema.sections.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canGenerate ? (
            <Button
              size="sm"
              onClick={() => setShowAiAssistant(true)}
              className="bg-violet-600 text-white hover:bg-violet-700"
            >
              <Sparkles size={14} /> AI
            </Button>
          ) : null}
          <Link href={`/apps/templates/${templateId}/records`}>
            <Button variant="outline" size="sm">
              <ClipboardCheck size={14} /> Entries
            </Button>
          </Link>
          <Button
            variant={rightPanel === 'preview' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setRightPanel((p) => (p === 'preview' ? 'none' : 'preview'))}
          >
            <Eye size={14} />
            Preview
          </Button>
          <Button size="sm" onClick={() => setShowPublish(true)} disabled={pending}>
            <Save size={14} />
            Publish v{currentVersion + 1}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT 1/3 — Overview / Build / Assignments / Permissions */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
            <LeftTab
              active={leftTab === 'overview'}
              onClick={() => setLeftTab('overview')}
              icon={<Info size={16} />}
              label="Overview"
            />
            <LeftTab
              active={leftTab === 'build'}
              onClick={() => setLeftTab('build')}
              icon={<PanelLeft size={16} />}
              label="Build"
            />
            <LeftTab
              active={leftTab === 'record'}
              onClick={() => setLeftTab('record')}
              icon={<SlidersHorizontal size={16} />}
              label="Record behaviour"
            />
            <LeftTab
              active={leftTab === 'list'}
              onClick={() => setLeftTab('list')}
              icon={<Table2 size={16} />}
              label="Records list"
            />
            <LeftTab
              active={leftTab === 'actions'}
              onClick={() => setLeftTab('actions')}
              icon={<MousePointerClick size={16} />}
              label="Record actions"
            />
            <LeftTab
              active={leftTab === 'assignments'}
              onClick={() => setLeftTab('assignments')}
              icon={<Send size={16} />}
              label="Assign"
            />
            <LeftTab
              active={leftTab === 'permissions'}
              onClick={() => setLeftTab('permissions')}
              icon={<ShieldCheck size={16} />}
              label="Access"
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {leftTab === 'overview' ? (
              <OverviewPanel
                templateId={templateId}
                name={appName}
                overview={overview}
                onSaved={setAppName}
                canPin={canPin}
                pinned={pinned}
              />
            ) : leftTab === 'record' ? (
              <RecordBehaviorPanel templateId={templateId} initial={recordConfig} roles={roles} />
            ) : leftTab === 'list' ? (
              <RecordListPanel templateId={templateId} initial={listConfig} fields={listFields} />
            ) : leftTab === 'actions' ? (
              <RecordActionsPanel templateId={templateId} flows={flows} />
            ) : leftTab === 'assignments' ? (
              <AssignmentsPanel templateId={templateId} />
            ) : leftTab === 'permissions' ? (
              <PermissionsPanel templateId={templateId} roles={roles} initial={allowedRoles} />
            ) : (
              <>
                <button
                  type="button"
                  onClick={openWorkflow}
                  title="Sequential human stages on this form — different from Flows (automation)"
                  className={`mb-3 block w-full rounded px-2 py-1 text-left text-xs font-semibold ${
                    selection.kind === 'workflow'
                      ? 'bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-200'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  Sign-off steps ({stepsCount})
                </button>

                <h3 className="mb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                  Add an element
                </h3>
                <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">
                  Drag onto the canvas, or click to add to the selected section.
                </p>
                {[...PALETTE_PRIMARY, ...PALETTE_MORE].map((group) => (
                  <FieldPaletteGroup
                    key={group.label}
                    group={group}
                    onDragType={(t) => {
                      dragElementRef.current = t
                    }}
                    onAdd={(t) => {
                      const targetSection =
                        selection.kind === 'section' || selection.kind === 'field'
                          ? selection.sectionId
                          : schema.sections[schema.sections.length - 1]?.id
                      if (targetSection) addField(targetSection, t)
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </aside>

        {/* RIGHT 2/3 — build surface ⟷ flows */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
          <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
            <SurfaceTab
              active={surface === 'build'}
              onClick={() => setSurface('build')}
              icon={<LayoutGrid size={13} />}
              label="Build surface"
            />
            <SurfaceTab
              active={surface === 'flows'}
              onClick={() => setSurface('flows')}
              icon={<WorkflowIcon size={13} />}
              label="Flows"
            />
            {surface === 'build' ? (
              <div className="ml-auto flex items-center gap-2">
                <span
                  className="hidden text-[10px] font-semibold tracking-wider text-slate-400 uppercase sm:block dark:text-slate-500"
                  title="Advanced layout — position widgets freely on a grid (Appsmith / WordPress style)"
                >
                  Advanced layout
                </span>
                <div className="flex items-center rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setAllCanvas(false)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                      !canvasMode
                        ? 'bg-slate-900 text-white dark:bg-slate-700'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    Stacked
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllCanvas(true)}
                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition ${
                      canvasMode
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                  >
                    <LayoutGrid size={12} /> Canvas
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {surface === 'flows' ? (
            <div className="min-h-0 flex-1">
              <FlowsCanvas
                profile={flowProfile}
                emailTemplates={emailTemplates}
                pdfTemplates={pdfTemplates}
                recipientOptions={recipientOptions}
                flows={flows}
                canEdit
                canGenerate={canGenerate}
                embedded
              />
            </div>
          ) : (
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
              <div className="w-full">
                <div className="space-y-3">
                  {selection.kind === 'workflow' ? (
                    <WorkflowEditor
                      schema={schema}
                      onChange={(steps) => setSchema((s) => ({ ...s, workflow: { steps } }))}
                    />
                  ) : null}

                  {/* Tabs — presentational pages for the fill experience. */}
                  <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
                    {appTabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setDesignerTab(t.id)}
                        onDoubleClick={() => {
                          const next = window.prompt('Rename tab', t.title?.en ?? '')
                          if (next != null) renameTab(t.id, next.trim() || 'Tab')
                        }}
                        title="Open · double-click to rename"
                        className={`group flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition ${
                          designerTab === t.id
                            ? 'bg-teal-600 text-white'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                        }`}
                      >
                        {t.title?.en ?? 'Tab'}
                        {appTabs.length > 1 ? (
                          <Trash2
                            size={11}
                            className={
                              designerTab === t.id
                                ? 'text-white/70 hover:text-white'
                                : 'text-slate-300 hover:text-rose-500'
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteTab(t.id)
                            }}
                          />
                        ) : null}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={addTab}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
                      title={appTabs.length === 0 ? 'Split this app into tabs' : 'Add a tab'}
                    >
                      <Plus size={12} /> {appTabs.length === 0 ? 'Add tabs' : 'Tab'}
                    </button>
                  </div>

                  {visibleSections.map((sec, i) => {
                    const active = selection.kind === 'section' && selection.sectionId === sec.id
                    return (
                      <Card
                        key={sec.id}
                        className={`border ${active ? 'border-teal-500 ring-1 ring-teal-500' : 'border-slate-200 dark:border-slate-800'}`}
                      >
                        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                          <button
                            type="button"
                            onClick={() => selectSection(sec.id)}
                            className="flex-1 text-left"
                          >
                            <CardTitle className="text-base">
                              {sec.title?.en ?? 'Untitled section'}{' '}
                              {sec.repeating ? <Badge variant="secondary">repeating</Badge> : null}
                              {sec.showIf ? (
                                <Badge variant="outline" className="text-[10px]">
                                  conditional
                                </Badge>
                              ) : null}
                              {sec.step ? (
                                <Badge variant="outline" className="text-[10px]">
                                  step · {stepLabel(schema, sec.step)}
                                </Badge>
                              ) : null}
                            </CardTitle>
                          </button>
                          <div className="flex items-center gap-1">
                            <IconButton
                              title="Move up"
                              onClick={() => moveSection(sec.id, -1)}
                              disabled={i === 0}
                            >
                              <ArrowUp size={14} />
                            </IconButton>
                            <IconButton
                              title="Move down"
                              onClick={() => moveSection(sec.id, 1)}
                              disabled={i === visibleSections.length - 1}
                            >
                              <ArrowDown size={14} />
                            </IconButton>
                            <IconButton
                              title="Delete section"
                              onClick={() => deleteSection(sec.id)}
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </IconButton>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          {sec.canvas ? (
                            <CanvasEditor
                              section={sec}
                              selectedFieldId={
                                selection.kind === 'field' && selection.sectionId === sec.id
                                  ? selection.fieldId
                                  : null
                              }
                              dragTypeRef={dragElementRef}
                              onLayout={(items) => setCanvasItems(sec.id, items)}
                              onAddWidget={(type, box) => addWidgetToCanvas(sec.id, type, box)}
                              onSelect={(fieldId) => selectField(sec.id, fieldId)}
                              onDelete={(fieldId) => deleteField(sec.id, fieldId)}
                            />
                          ) : sec.fields.length === 0 ? (
                            <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                              No elements. Drag one from the left panel, or select an element to add
                              it here.
                            </div>
                          ) : (
                            <Reorder.Group
                              axis="y"
                              values={sec.fields}
                              onReorder={(fields) => reorderFields(sec.id, fields as FormField[])}
                              as="ul"
                              className="divide-y divide-slate-100 dark:divide-slate-800"
                            >
                              {sec.fields.map((f, j) => (
                                <FieldRow
                                  key={f.id}
                                  field={f}
                                  isSelected={
                                    selection.kind === 'field' && selection.fieldId === f.id
                                  }
                                  typeLabel={FIELD_TYPES[f.type]?.label ?? f.type}
                                  onSelect={() => selectField(sec.id, f.id)}
                                  onMoveUp={() => moveField(sec.id, f.id, -1)}
                                  onMoveDown={() => moveField(sec.id, f.id, 1)}
                                  onDelete={() => deleteField(sec.id, f.id)}
                                  canUp={j > 0}
                                  canDown={j < sec.fields.length - 1}
                                />
                              ))}
                            </Reorder.Group>
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
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Properties flyout — opens on selection / "Form settings". */}
      <Drawer
        open={rightPanel === 'props'}
        onClose={() => setRightPanel('none')}
        title={selection.kind === 'field' ? 'Element properties' : 'Section'}
        size="sm"
      >
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
        ) : null}
      </Drawer>

      {/* Preview flyout — live render of the filler experience. */}
      <Drawer
        open={rightPanel === 'preview'}
        onClose={() => setRightPanel('none')}
        title="Preview"
        description="How the filler will see this form."
        size="lg"
      >
        <Preview schema={schema} />
      </Drawer>

      <Drawer
        open={showPublish}
        onClose={() => setShowPublish(false)}
        title={`Publish v${currentVersion + 1}`}
        description="Snapshot the current schema as a new immutable version."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowPublish(false)}>
              Cancel
            </Button>
            <Button onClick={publish} disabled={pending}>
              <Check size={14} />
              {pending ? 'Publishing…' : 'Publish'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Alert variant="info">
            <AlertTitle>Immutable version</AlertTitle>
            <AlertDescription>
              This snapshots the current schema as v{currentVersion + 1}. Existing responses still
              render against the version they were submitted under.
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
        </div>
      </Drawer>

      {/* AI assistant — build or edit this whole app, with persistent history. */}
      <AiAssistant
        open={showAiAssistant}
        onClose={() => setShowAiAssistant(false)}
        scope="builder.app"
        scopeRefId={templateId}
        title="App builder AI"
        description="Build or edit this app by chatting. Review, then Apply."
        placeholder="e.g. Add a section for PPE checks with yes/no items, or build a daily vehicle inspection"
        applyLabel="Apply to builder"
        suggestions={[
          'Add a photo upload and a signature at the end',
          'Split this into tabs: Details, Hazards, Sign-off',
          'Make a daily pre-start vehicle inspection checklist',
        ]}
        onSend={async (conversationId, prompt) => {
          const r = await runAppBuilderChat({
            conversationId,
            templateId,
            currentSchema: schema,
            prompt,
          })
          return { ok: r.ok, conversationId: r.conversationId, error: r.error }
        }}
        onApply={(data) => {
          const next = data?.schema as FormSchemaV1 | undefined
          if (!next) return
          setSchema(next)
          if (next.tabs?.length) setDesignerTab(next.tabs[0]!.id)
          toast.success('Applied — review and Publish when ready')
        }}
      />
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
  onDragType,
}: {
  group: { label: string; types: FieldType[] }
  onAdd: (t: FieldType) => void
  // Set when a palette item starts dragging, so the canvas drop knows the type.
  onDragType?: (t: FieldType) => void
}) {
  return (
    <div className="mb-3">
      <div className="px-1 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        {group.label}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {group.types.map((t) => {
          const Icon = FIELD_ICONS[t] ?? Type
          return (
            <button
              key={t}
              type="button"
              draggable
              onDragStart={(e) => {
                onDragType?.(t)
                e.dataTransfer.setData('text/plain', t)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => onAdd(t)}
              className="flex cursor-grab items-center gap-2 rounded border border-slate-200 px-2 py-1 text-left text-xs hover:border-teal-500 hover:bg-teal-50 active:cursor-grabbing dark:border-slate-700 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
              title="Drag onto the canvas — or click to add to the selected section"
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
      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {children}
    </button>
  )
}

// One draggable field row in the designer canvas. Drag is handle-only (via
// framer-motion dragControls) so clicking the row still selects the field; the
// up/down arrows remain as a keyboard-accessible fallback.
function FieldRow({
  field,
  isSelected,
  typeLabel,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  canUp,
  canDown,
}: {
  field: FormField
  isSelected: boolean
  typeLabel: string
  onSelect: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  canUp: boolean
  canDown: boolean
}) {
  const controls = useDragControls()
  const Icon = FIELD_ICONS[field.type] ?? Type
  return (
    <Reorder.Item
      value={field}
      dragListener={false}
      dragControls={controls}
      as="li"
      className={`flex items-center justify-between gap-2 rounded px-1 py-2 ${
        isSelected ? 'bg-teal-50 dark:bg-teal-950/40' : 'bg-white dark:bg-slate-900'
      }`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
      >
        <GripVertical size={14} />
      </button>
      <button type="button" onClick={onSelect} className="flex flex-1 items-center gap-2 text-left">
        <Icon size={14} />
        <span className="w-24 truncate text-xs text-slate-400 dark:text-slate-500">
          {typeLabel}
        </span>
        <span className="text-sm font-medium">
          {field.label?.en ?? field.id}
          {field.required || field.validation?.required ? (
            <span className="text-red-600"> *</span>
          ) : null}
        </span>
        {field.showIf ? (
          <Badge variant="secondary" className="text-[10px]">
            conditional
          </Badge>
        ) : null}
        {field.formula ? (
          <Badge variant="secondary" className="text-[10px]">
            calc
          </Badge>
        ) : null}
      </button>
      <div className="flex items-center gap-1">
        <IconButton title="Move up" onClick={onMoveUp} disabled={!canUp}>
          <ArrowUp size={12} />
        </IconButton>
        <IconButton title="Move down" onClick={onMoveDown} disabled={!canDown}>
          <ArrowDown size={12} />
        </IconButton>
        <IconButton title="Delete" onClick={onDelete}>
          <Trash2 size={12} className="text-red-500" />
        </IconButton>
      </div>
    </Reorder.Item>
  )
}

// --- Form-level properties -------------------------------------------------

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
        <CardTitle className="text-base">Sign-off steps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Sequential human stages of this form — e.g. <em>Worker fills</em> →{' '}
          <em>Supervisor signs</em> → <em>Manager reviews</em>. Each step is assigned to a person
          and can require a signature; bind a section to a step in its properties. This is{' '}
          <strong>not</strong> automation — to send notifications, raise CAPAs, or branch on
          answers, use the <strong>Flows</strong> tab.
        </p>
        <ul className="space-y-2">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start gap-2">
                <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
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
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
        Field — {FIELD_TYPES[field.type]?.label ?? field.type}
      </h3>
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`-mb-px border-b-2 px-2 py-1 text-xs ${
                tab === t.value
                  ? 'border-teal-600 font-semibold text-teal-700 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {tab === 'basic' ? <FieldBasicTab field={field} schema={schema} onChange={onChange} /> : null}
      {tab === 'validation' ? <FieldValidationTab field={field} onChange={onChange} /> : null}
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
      {tab === 'default' ? <FieldDefaultTab field={field} onChange={onChange} /> : null}
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
  // Other fields in the app — targets for cascade filters + lookup auto-fill.
  const otherFields = schema.sections
    .flatMap((s) => s.fields)
    .filter((f) => f.id !== field.id)
    .map((f) => ({ id: f.id, label: f.label?.en ?? f.id }))
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Element ID (immutable)</Label>
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
              helpText: e.target.value
                ? { ...(field.helpText ?? {}), en: e.target.value }
                : undefined,
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
      <div className="space-y-1">
        <Label className="text-xs">Width (columns)</Label>
        <Select
          className="h-8 text-xs"
          value={String(field.colSpan ?? '')}
          onChange={(e) =>
            onChange({ colSpan: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">Full width</option>
          <option value="1">1 column</option>
          <option value="2">2 columns</option>
          <option value="3">3 columns</option>
          <option value="4">4 columns</option>
        </Select>
        <p className="text-[10px] text-slate-500">Applies when the section has multiple columns.</p>
      </div>
      {field.type === 'select' ||
      field.type === 'radio' ||
      field.type === 'multi_select' ||
      field.type === 'checkbox_group' ||
      field.type === 'ranking' ? (
        <ChoiceOptionsEditor field={field} onChange={onChange} />
      ) : null}
      {field.type === 'table' ? <TableConfigEditor field={field} onChange={onChange} /> : null}
      {field.type === 'slider' ? <SliderConfigEditor field={field} onChange={onChange} /> : null}
      {field.type === 'matrix' ? <MatrixConfigEditor field={field} onChange={onChange} /> : null}
      {field.type === 'lookup' || field.type === 'data_table' || field.type === 'metric' ? (
        <DataBindingEditor field={field} otherFields={otherFields} onChange={onChange} />
      ) : null}
    </div>
  )
}

function SliderConfigEditor({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const c = (field.config ?? {}) as { min?: number; max?: number; step?: number; unit?: string }
  const set = (patch: Partial<typeof c>) => onChange({ config: { ...field.config, ...patch } })
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Range</div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Min</Label>
          <Input
            type="number"
            value={c.min ?? 0}
            onChange={(e) => set({ min: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max</Label>
          <Input
            type="number"
            value={c.max ?? 10}
            onChange={(e) => set({ max: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Step</Label>
          <Input
            type="number"
            value={c.step ?? 1}
            onChange={(e) => set({ step: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Unit (optional)</Label>
        <Input
          value={c.unit ?? ''}
          placeholder="e.g. %, m, °C"
          onChange={(e) => set({ unit: e.target.value })}
        />
      </div>
    </div>
  )
}

function MatrixConfigEditor({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const c = (field.config ?? {}) as {
    rows?: { key: string; label: string }[]
    scale?: { value: string; label: string }[]
  }
  const rows = c.rows ?? []
  const scale = c.scale ?? []
  const setRows = (next: typeof rows) => onChange({ config: { ...field.config, rows: next } })
  const setScale = (next: typeof scale) => onChange({ config: { ...field.config, scale: next } })
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-2">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Rows
          </span>
          <button
            type="button"
            className="text-xs text-teal-700 hover:underline"
            onClick={() =>
              setRows([...rows, { key: newId('row'), label: `Row ${rows.length + 1}` }])
            }
          >
            + Row
          </button>
        </div>
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-1">
              <Input
                value={r.label}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <IconButton
                title="Remove row"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} className="text-red-500" />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Scale
          </span>
          <button
            type="button"
            className="text-xs text-teal-700 hover:underline"
            onClick={() =>
              setScale([
                ...scale,
                { value: String(scale.length + 1), label: String(scale.length + 1) },
              ])
            }
          >
            + Point
          </button>
        </div>
        <div className="space-y-1">
          {scale.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                className="w-16 font-mono text-xs"
                value={s.value}
                onChange={(e) =>
                  setScale(scale.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
              />
              <Input
                value={s.label}
                onChange={(e) =>
                  setScale(scale.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
              />
              <IconButton
                title="Remove point"
                onClick={() => setScale(scale.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} className="text-red-500" />
              </IconButton>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Data-bound element binding editor -------------------------------------

// Module-cached list of the tenant's data sources, shared by every binding
// editor instance so we hit the server action once per editor session.
let _dataSourcesPromise: Promise<DataSourceSummary[]> | null = null
function useDataSources(): {
  sources: DataSourceSummary[]
  loading: boolean
  refresh: () => void
} {
  const [sources, setSources] = useState<DataSourceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const activeLoadRef = useRef<(() => void) | null>(null)

  const applySourcePromise = useCallback((promise: Promise<DataSourceSummary[]>) => {
    let alive = true
    promise
      .then((s) => {
        if (alive) {
          setSources(s)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!_dataSourcesPromise) _dataSourcesPromise = listDataSources()
    const cleanup = applySourcePromise(_dataSourcesPromise)
    activeLoadRef.current = cleanup
    return cleanup
  }, [applySourcePromise])

  return {
    sources,
    loading,
    refresh: () => {
      activeLoadRef.current?.()
      setLoading(true)
      _dataSourcesPromise = listDataSources()
      activeLoadRef.current = applySourcePromise(_dataSourcesPromise)
    },
  }
}

type DsColumns = DataSourceSummary['columns']

function DataBindingEditor({
  field,
  otherFields,
  onChange,
}: {
  field: FormField
  otherFields: { id: string; label: string }[]
  onChange: (patch: Partial<FormField>) => void
}) {
  const { sources, loading, refresh } = useDataSources()
  const b = field.binding
  const source = sources.find((s) => s.key === b?.sourceKey)
  const cols = source?.columns ?? []

  // Persist a binding patch — but drop the binding entirely if no source is
  // chosen, so the schema never carries an invalid empty sourceKey.
  const patch = (p: Partial<DataBinding>) => {
    const next = { ...(b ?? {}), ...p } as DataBinding
    if (!next.sourceKey) {
      onChange({ binding: undefined })
      return
    }
    onChange({ binding: next })
  }

  return (
    <div className="space-y-2.5 rounded-md border border-violet-200 bg-violet-50/30 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-violet-500 uppercase">
          Data binding
        </span>
        <a
          href="/admin/data-sources"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-violet-700 hover:underline"
        >
          Manage sources ↗
        </a>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 text-[11px] text-violet-700 hover:underline"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Data source</Label>
        <Select
          className="h-8 text-xs"
          value={b?.sourceKey ?? ''}
          onChange={(e) => patch({ sourceKey: e.target.value })}
        >
          <option value="">{loading ? 'Loading…' : '— pick a data source —'}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.key}>
              {s.name}
            </option>
          ))}
        </Select>
        {!loading && sources.length === 0 ? (
          <p className="text-[10px] text-slate-500">
            No data sources. Create one in Admin → Data sources.
          </p>
        ) : null}
      </div>

      {source ? (
        <>
          {field.type === 'lookup' ? (
            <LookupBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />
          ) : null}
          {field.type === 'data_table' ? (
            <DataTableBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />
          ) : null}
          {field.type === 'metric' ? (
            <MetricBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function LookupBindingFields({
  b,
  cols,
  otherFields,
  patch,
}: {
  b: DataBinding | undefined
  cols: DsColumns
  otherFields: { id: string; label: string }[]
  patch: (p: Partial<DataBinding>) => void
}) {
  const autofill = b?.autofill ?? []
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Show (label)</Label>
          <Select
            className="h-8 text-xs"
            value={b?.labelColumn ?? ''}
            onChange={(e) => patch({ labelColumn: e.target.value || undefined })}
          >
            <option value="">First column</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Store (value)</Label>
          <Select
            className="h-8 text-xs"
            value={b?.valueColumn ?? ''}
            onChange={(e) => patch({ valueColumn: e.target.value || undefined })}
          >
            <option value="">Row id</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <CascadeBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />

      <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Auto-fill on select
          </span>
          <button
            type="button"
            className="text-xs text-teal-700 hover:underline"
            onClick={() =>
              patch({
                autofill: [
                  ...autofill,
                  { column: cols[0]?.key ?? '', targetFieldId: otherFields[0]?.id ?? '' },
                ],
              })
            }
          >
            + Mapping
          </button>
        </div>
        {autofill.length === 0 ? (
          <p className="text-[10px] text-slate-500">
            Copy a column from the picked row into another field.
          </p>
        ) : (
          autofill.map((m, i) => (
            <div key={i} className="flex items-center gap-1">
              <Select
                className="h-8 text-xs"
                value={m.column}
                onChange={(e) =>
                  patch({
                    autofill: autofill.map((x, j) =>
                      j === i ? { ...x, column: e.target.value } : x,
                    ),
                  })
                }
              >
                {cols.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <span className="text-slate-400">→</span>
              <Select
                className="h-8 text-xs"
                value={m.targetFieldId}
                onChange={(e) =>
                  patch({
                    autofill: autofill.map((x, j) =>
                      j === i ? { ...x, targetFieldId: e.target.value } : x,
                    ),
                  })
                }
              >
                {otherFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <IconButton
                title="Remove mapping"
                onClick={() => patch({ autofill: autofill.filter((_, j) => j !== i) })}
              >
                <Trash2 size={13} className="text-red-500" />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CascadeBindingFields({
  b,
  cols,
  otherFields,
  patch,
}: {
  b: DataBinding | undefined
  cols: DsColumns
  otherFields: { id: string; label: string }[]
  patch: (p: Partial<DataBinding>) => void
}) {
  return (
    <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">
      <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        Cascade (optional)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Filter by field</Label>
          <Select
            className="h-8 text-xs"
            value={b?.filterByField ?? ''}
            onChange={(e) =>
              patch(
                e.target.value
                  ? { filterByField: e.target.value }
                  : { filterByField: undefined, filterColumn: undefined },
              )
            }
          >
            <option value="">— none —</option>
            {otherFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Matched on column</Label>
          <Select
            className="h-8 text-xs"
            value={b?.filterColumn ?? ''}
            disabled={!b?.filterByField}
            onChange={(e) => patch({ filterColumn: e.target.value || undefined })}
          >
            <option value="">—</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        Only show rows whose column matches the parent field&apos;s value — e.g. Area filtered by
        the chosen Site.
      </p>
    </div>
  )
}

function DataTableBindingFields({
  b,
  cols,
  otherFields,
  patch,
}: {
  b: DataBinding | undefined
  cols: DsColumns
  otherFields: { id: string; label: string }[]
  patch: (p: Partial<DataBinding>) => void
}) {
  const allShown = !b?.columns
  const shown = b?.columns ?? cols.map((c) => c.key)
  const toggle = (key: string) => {
    const base = b?.columns ?? cols.map((c) => c.key)
    const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
    patch({ columns: next })
  }
  return (
    <div className="space-y-2">
      <CascadeBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />
      <div className="space-y-1">
        <Label className="text-xs">Columns shown</Label>
        <div className="flex flex-wrap gap-1.5 rounded border border-slate-200 bg-white p-1.5">
          {cols.map((c) => {
            const on = allShown || shown.includes(c.key)
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  on ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-400 line-through'
                }`}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Selection</Label>
          <Select
            className="h-8 text-xs"
            value={b?.selectable ?? 'none'}
            onChange={(e) => patch({ selectable: e.target.value as DataBinding['selectable'] })}
          >
            <option value="none">Display only</option>
            <option value="single">Pick one row</option>
            <option value="multi">Pick many rows</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max rows</Label>
          <Input
            type="number"
            className="h-8 text-xs"
            value={b?.limit ?? ''}
            placeholder="50"
            onChange={(e) => patch({ limit: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </div>
    </div>
  )
}

function MetricBindingFields({
  b,
  cols,
  otherFields,
  patch,
}: {
  b: DataBinding | undefined
  cols: DsColumns
  otherFields: { id: string; label: string }[]
  patch: (p: Partial<DataBinding>) => void
}) {
  const agg = b?.aggregate ?? { fn: 'count' as const }
  const setAgg = (p: Partial<NonNullable<DataBinding['aggregate']>>) =>
    patch({ aggregate: { ...agg, ...p } })
  const needsColumn = agg.fn !== 'count'
  return (
    <div className="space-y-2">
      <CascadeBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Aggregate</Label>
          <Select
            className="h-8 text-xs"
            value={agg.fn}
            onChange={(e) =>
              setAgg({ fn: e.target.value as NonNullable<DataBinding['aggregate']>['fn'] })
            }
          >
            <option value="count">Count</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Of column</Label>
          <Select
            className="h-8 text-xs"
            value={agg.column ?? ''}
            disabled={!needsColumn}
            onChange={(e) => setAgg({ column: e.target.value || undefined })}
          >
            <option value="">{needsColumn ? '— pick —' : 'n/a'}</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Group by</Label>
          <Select
            className="h-8 text-xs"
            value={agg.groupBy ?? ''}
            onChange={(e) => setAgg({ groupBy: e.target.value || undefined })}
          >
            <option value="">— no grouping —</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Display</Label>
          <Select
            className="h-8 text-xs"
            value={b?.display ?? (agg.groupBy ? 'bar' : 'number')}
            onChange={(e) => patch({ display: e.target.value as DataBinding['display'] })}
          >
            <option value="number">Number</option>
            <option value="bar">Bar chart</option>
            <option value="line">Line chart</option>
            <option value="pie">Pie chart</option>
          </Select>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        Group by a column to render a chart; leave it blank for a single KPI number.
      </p>
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
      if (next[k] === undefined || next[k] === '')
        delete (next as Record<string, unknown>)[k as string]
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
              onChange={(e) =>
                set({ min: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max</Label>
            <Input
              type="number"
              value={v.max ?? ''}
              onChange={(e) =>
                set({ max: e.target.value === '' ? undefined : Number(e.target.value) })
              }
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
              onChange={(e) =>
                set({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max length</Label>
            <Input
              type="number"
              value={v.maxLength ?? ''}
              onChange={(e) =>
                set({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })
              }
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
      <p className="text-xs text-slate-500">Applied on first render when this field is empty.</p>
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
        <p className="text-xs text-slate-500">No options.</p>
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
        onClick={() =>
          update([...options, { value: `opt_${options.length + 1}`, label: { en: 'New option' } }])
        }
      >
        <Plus size={12} />
        Add option
      </Button>
    </div>
  )
}

// --- Table config (column + row editor for `table` fields) ------------------

function TableConfigEditor({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const config = (field.config ?? {}) as Partial<TableConfig>
  const columns = (config.columns ?? []) as TableColumn[]
  const rowMode = config.rowMode === 'fixed' ? 'fixed' : 'addable'
  const fixedRows = config.rows ?? []

  function setConfig(patch: Partial<TableConfig>) {
    onChange({ config: { ...(config as Record<string, unknown>), ...patch } })
  }
  const setColumns = (next: TableColumn[]) => setConfig({ columns: next })
  const setRows = (next: { label: string }[]) => setConfig({ rows: next })

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-2">
      <div className="text-xs font-semibold text-slate-600">Table setup</div>

      <div className="space-y-1">
        <Label className="text-xs">Rows</Label>
        <Select
          className="h-8 text-xs"
          value={rowMode}
          onChange={(e) => setConfig({ rowMode: e.target.value as 'addable' | 'fixed' })}
        >
          <option value="addable">Addable — user adds / removes rows</option>
          <option value="fixed">Predefined — fixed list of rows</option>
        </Select>
      </div>

      {rowMode === 'addable' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Min rows</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={config.minRows ?? ''}
              onChange={(e) =>
                setConfig({ minRows: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max rows</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={config.maxRows ?? ''}
              onChange={(e) =>
                setConfig({ maxRows: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          Columns
        </div>
        {columns.length === 0 ? (
          <p className="text-xs text-slate-500">No columns.</p>
        ) : (
          <ul className="space-y-2">
            {columns.map((c, i) => (
              <li key={i} className="space-y-1 rounded border border-slate-200 bg-white p-2">
                <div className="flex items-center gap-1">
                  <Input
                    className="h-7 flex-1 text-xs"
                    value={c.label}
                    placeholder="Column label"
                    onChange={(e) =>
                      setColumns(
                        columns.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)),
                      )
                    }
                  />
                  <Select
                    className="h-7 w-24 text-xs"
                    value={c.type}
                    onChange={(e) =>
                      setColumns(
                        columns.map((x, idx) =>
                          idx === i ? { ...x, type: e.target.value as TableColumn['type'] } : x,
                        ),
                      )
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="select">Dropdown</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="date">Date</option>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setColumns(columns.filter((_, idx) => idx !== i))}
                    className="rounded p-1 text-slate-400 hover:text-red-500"
                    title="Remove column"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <Input
                  className="h-7 font-mono text-[11px]"
                  value={c.key}
                  placeholder="key"
                  onChange={(e) =>
                    setColumns(
                      columns.map((x, idx) =>
                        idx === i ? { ...x, key: e.target.value.replace(/\s+/g, '_') } : x,
                      ),
                    )
                  }
                />
                {c.type === 'select' ? (
                  <TableColumnOptions
                    options={c.options ?? []}
                    onChange={(opts) =>
                      setColumns(columns.map((x, idx) => (idx === i ? { ...x, options: opts } : x)))
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const n = columns.length + 1
            setColumns([...columns, { key: `col_${n}`, label: `Column ${n}`, type: 'text' }])
          }}
        >
          <Plus size={12} /> Add column
        </Button>
      </div>

      {rowMode === 'fixed' ? (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Predefined rows
          </div>
          {fixedRows.length === 0 ? (
            <p className="text-xs text-slate-500">No rows.</p>
          ) : (
            <ul className="space-y-1">
              {fixedRows.map((r, i) => (
                <li key={i} className="flex items-center gap-1">
                  <Input
                    className="h-7 flex-1 text-xs"
                    value={r.label}
                    placeholder="Row label"
                    onChange={(e) =>
                      setRows(
                        fixedRows.map((x, idx) => (idx === i ? { label: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setRows(fixedRows.filter((_, idx) => idx !== i))}
                    className="rounded p-1 text-slate-400 hover:text-red-500"
                    title="Remove row"
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
            onClick={() => setRows([...fixedRows, { label: `Row ${fixedRows.length + 1}` }])}
          >
            <Plus size={12} /> Add row
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function TableColumnOptions({
  options,
  onChange,
}: {
  options: { value: string; label: string }[]
  onChange: (opts: { value: string; label: string }[]) => void
}) {
  return (
    <div className="space-y-1 rounded border border-slate-100 bg-slate-50 p-1.5">
      <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        Options
      </div>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            className="h-6 flex-1 text-[11px]"
            value={o.label}
            placeholder="Option label"
            onChange={(e) =>
              onChange(
                options.map((x, idx) =>
                  idx === i
                    ? {
                        value: x.value || e.target.value.toLowerCase().replace(/\s+/g, '_'),
                        label: e.target.value,
                      }
                    : x,
                ),
              )
            }
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
            className="rounded p-0.5 text-slate-400 hover:text-red-500"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          onChange([
            ...options,
            { value: `opt_${options.length + 1}`, label: `Option ${options.length + 1}` },
          ])
        }
      >
        <Plus size={11} /> Option
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
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Section</h3>
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
      {schema.tabs?.length ? (
        <div className="space-y-1">
          <Label className="text-xs">Tab</Label>
          <Select
            value={section.tabId ?? schema.tabs[0]!.id}
            onChange={(e) => onChange({ tabId: e.target.value })}
          >
            {schema.tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title?.en ?? t.id}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea
          rows={2}
          value={section.description?.en ?? ''}
          onChange={(e) =>
            onChange({
              description: e.target.value
                ? { ...(section.description ?? {}), en: e.target.value }
                : undefined,
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
      <div className="space-y-1">
        <Label className="text-xs">Columns (layout)</Label>
        <Select
          className="h-8 text-xs"
          value={String(section.layout?.columns ?? 1)}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange({ layout: n > 1 ? { columns: n, gap: section.layout?.gap } : undefined })
          }}
        >
          <option value="1">1 column</option>
          <option value="2">2 columns</option>
          <option value="3">3 columns</option>
          <option value="4">4 columns</option>
        </Select>
        <p className="text-[10px] text-slate-500">
          Elements flow left→right; set each element&apos;s width in its Basic tab.
        </p>
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
              onChange={(e) => onChange({ rowLabelTemplate: e.target.value || undefined })}
            />
            <p className="text-[10px] text-slate-500">
              Supports {`{index}`}, {`{index+1}`}, and {`{<fieldKey>}`} interpolation from the row's
              values.
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
    <Card className="border-2 border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <CardHeader>
        <CardTitle className="text-base">Preview · {schema.title?.en}</CardTitle>
        <p className="text-xs text-slate-500">
          Live render of how the filler will see the form. Conditional logic is shown as chips; live
          filler runtime resolves them dynamically.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {schema.workflow.steps.map((step) => {
          const stepSections = groupedByStep.get(step.key) ?? []
          if (stepSections.length === 0) return null
          return (
            <div
              key={step.key}
              className="rounded-md border border-slate-200 dark:border-slate-800"
            >
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
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

// --- Unified editor: rail tabs + left-pane panels ---------------------------

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function LeftTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex flex-1 items-center justify-center rounded-md px-1.5 py-2 transition ${
        active
          ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {icon}
    </button>
  )
}

function SurfaceTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-slate-900 text-white dark:bg-slate-700'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function OverviewPanel({
  templateId,
  name,
  overview,
  onSaved,
  canPin = false,
  pinned = false,
}: {
  templateId: string
  name: string
  overview?: AppOverview
  onSaved: (name: string) => void
  canPin?: boolean
  pinned?: boolean
}) {
  const [n, setN] = useState(name)
  const [description, setDescription] = useState(overview?.description ?? '')
  const [surfaceAsTool, setSurfaceAsTool] = useState(overview?.surfaceAsTool ?? false)
  const [pending, start] = useTransition()
  const save = () => {
    if (n.trim().length < 2) {
      toast.error('Give your app a name')
      return
    }
    start(async () => {
      const res = await updateAppOverview({
        templateId,
        name: n.trim(),
        description,
        surfaceAsTool,
      })
      if (!res.ok) {
        toast.error(res.error ?? 'Could not save')
        return
      }
      onSaved(n.trim())
      toast.success('Overview saved')
    })
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        The basics shown across the app — its name and what it&apos;s for.
      </p>
      <LabeledField label="App name">
        <Input value={n} onChange={(e) => setN(e.target.value)} />
      </LabeledField>
      <LabeledField label="Description">
        <Textarea
          rows={4}
          value={description}
          placeholder="Purpose and audience"
          onChange={(e) => setDescription(e.target.value)}
        />
      </LabeledField>
      <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
        <input
          type="checkbox"
          checked={surfaceAsTool}
          onChange={(e) => setSurfaceAsTool(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-medium text-slate-800 dark:text-slate-200">
            Show in the Tools catalogue
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Lists this app under <span className="font-mono">/tools</span> as a calculator or
            utility. Takes effect once the app is published.
          </span>
        </span>
      </label>
      <Button onClick={save} disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Save overview'}
      </Button>
      {canPin ? (
        <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Sidebar</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pin this app to the left sidebar for everyone in the workspace. Takes effect once the
            app is published.
          </p>
          <PinFormButton templateId={templateId} pinned={pinned} />
        </div>
      ) : null}
    </div>
  )
}

function AssignmentsPanel({ templateId }: { templateId: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Requiring people to fill this app — who, on what schedule, and tracking completion — is
        handled by the <span className="font-medium text-slate-700">Compliance</span> engine.
      </p>
      <Link
        href={`/compliance/obligations/new?kind=form&formTemplateId=${templateId}`}
        className="block"
      >
        <Button className="w-full">
          <Send size={14} /> Create an assignment
        </Button>
      </Link>
      <Link href="/compliance/obligations" className="block">
        <Button variant="outline" className="w-full">
          View all obligations
        </Button>
      </Link>
      <p className="text-[11px] text-slate-400">
        Anyone with access can also open and fill this app directly from the gallery.
      </p>
    </div>
  )
}

function PermissionsPanel({
  templateId,
  roles,
  initial,
}: {
  templateId: string
  roles: { key: string; name: string }[]
  initial: string[]
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial))
  const [pending, start] = useTransition()
  const toggle = (key: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const save = () =>
    start(async () => {
      const res = await updateAppPermissions({ templateId, allowedRoles: Array.from(sel) })
      if (!res.ok) {
        toast.error(res.error ?? 'Could not save')
        return
      }
      toast.success('Access saved')
    })
  const restricted = sel.size > 0
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Choose which roles can see and fill this app. Leave all unchecked to allow everyone. Admins
        always have access.
      </p>
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          restricted
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}
      >
        {restricted
          ? `Restricted to ${sel.size} role${sel.size === 1 ? '' : 's'}`
          : 'Visible to everyone'}
      </div>
      {roles.length === 0 ? (
        <p className="text-xs text-slate-400">No roles defined for this tenant.</p>
      ) : (
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={sel.has(r.key)} onChange={() => toggle(r.key)} />
                <span className="flex-1">{r.name}</span>
                <span className="text-[10px] text-slate-400">{r.key}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={save} disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Save access'}
      </Button>
    </div>
  )
}
