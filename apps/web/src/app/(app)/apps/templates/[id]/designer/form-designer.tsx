'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Form designer.
//
// Three-pane layout:
//   - Left: field palette (categorized, with icons), section list + workflow step editor
//   - Middle: canvas — sections and fields, palette drops, drag reorder, click-to-select
//   - Right: properties panel for the current selection (form / section / field) with
//            tabs for Basic / Validation / Logic / Default / Calc
//
// All edits mutate a local copy of FormSchemaV1. Publish writes a new immutable
// version via the `publishNewVersion` server action.

import { useCallback, useEffect, useRef, useState, useTransition, useMemo } from 'react'
import { SmartBackLink } from '@/components/smart-back-link'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
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
  Globe2,
  GripVertical,
  Hash,
  Image as ImageIcon,
  ListChecks,
  Mail,
  MapPin,
  Mic,
  Minus,
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
  storesResponseValue,
  type CanvasLayout,
  type DataBinding,
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
import { localizeText, type AppLocale } from '@beaconhs/i18n'
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
import { formFlowProfile } from '@/lib/flows/form-flow-validation'

// --- Palette ---------------------------------------------------------------

// Field-type icon registry. Falls back to a generic Type icon for unknowns.
const FIELD_ICONS: Partial<Record<FieldType, React.ComponentType<{ size?: number }>>> = {
  text: Type,
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
  photo: ImageIcon,
  file: Upload,
  video: Video,
  audio: Mic,
  sketch: PenTool,
  signature: Pencil,
  typed_attestation: CheckCircle2,
  formula: Calculator,
  risk_matrix: Sliders,
  heading: Type,
  paragraph: AlignLeft,
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
// One element per concept — no duplicates across groups.
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
  { label: 'Choice', types: ['radio', 'multi_select', 'ranking', 'matrix'] },
  { label: 'Scoring', types: ['rating', 'yes_no_comment', 'traffic_light'] },
  {
    label: 'Pickers',
    types: [
      'multi_person_picker',
      'customer_picker',
      'project_picker',
      'site_picker',
      'area_picker',
    ],
  },
  { label: 'Media', types: ['sketch', 'video', 'audio'] },
  { label: 'Computed', types: ['risk_matrix', 'typed_attestation'] },
  { label: 'Data', types: ['lookup', 'data_table', 'metric'] },
  { label: 'Display', types: ['heading', 'paragraph', 'rich_text', 'divider'] },
]

function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`
}

function emptyField(type: FieldType): FormField {
  return {
    id: newId('f'),
    type,
    label: { en: FIELD_TYPES[type].label },
    required: false,
    config: type === 'photo' ? { multiple: true } : undefined,
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

type AppOverview = {
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
  targetApps = [],
  recipientOptions,
  canGenerate = false,
  canPin = false,
  pinned = false,
  locale,
  defaultLocale,
  enabledLocales,
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
  targetApps?: { id: string; name: string }[]
  recipientOptions?: RecipientOptions
  canGenerate?: boolean
  canPin?: boolean
  pinned?: boolean
  locale: AppLocale
  defaultLocale: AppLocale
  enabledLocales: readonly AppLocale[]
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const languages = useTranslations('Languages')
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
  const [dropSectionId, setDropSectionId] = useState<string | null>(null)
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
  const [contentLocale, setContentLocale] = useState<AppLocale>(locale)

  // Selectable fields for the records-list "List" tab — real answer fields only
  // (content-only display elements carry no data to show in a column).
  const listFields = useMemo(() => {
    const skip = new Set(['heading', 'paragraph', 'divider', 'metric'])
    const out: { id: string; label: string }[] = []
    for (const sec of schema.sections)
      for (const f of sec.fields) {
        if (skip.has(f.type)) continue
        out.push({
          id: f.id,
          label: localizeText(f.label, contentLocale, f.id, defaultLocale),
        })
      }
    return out
  }, [contentLocale, defaultLocale, schema])

  // Current records-list config lives under recordConfig.list (the page passes
  // the full recordConfig jsonb; its type omits `list`, but it's there at runtime).
  const listConfig = (recordConfig as { list?: ListConfig } | undefined)?.list

  // Keep the canvas vocabulary aligned with the server-side flow validator.
  // Repeating children are not top-level response fields and must not be offered
  // as condition or action targets.
  const flowProfile = useMemo(
    () => formFlowProfile(templateId, appName, schema, contentLocale, defaultLocale),
    [templateId, appName, schema, contentLocale, defaultLocale],
  )

  let selectedField: { section: FormSchemaV1['sections'][number]; field: FormField } | null = null
  if (selection.kind === 'field') {
    for (const sec of schema.sections) {
      const f = sec.fields.find((x) => x.id === selection.fieldId)
      if (f) {
        selectedField = { section: sec, field: f }
        break
      }
    }
  }

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

  function renameTab(id: string, title: string) {
    update((draft) => {
      const t = draft.tabs?.find((x) => x.id === id)
      if (t) t.title = { ...t.title, [contentLocale]: title }
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
    setError(tGeneratedValue(null))
    start(async () => {
      const result = await publishNewVersion({
        templateId,
        schema,
        changelog: changelog.trim(),
      })
      if (!result.ok) {
        setError(tGeneratedValue(result.error ?? tGenerated('m_16c73b6230c543')))
        toast.error(tGeneratedValue(result.error ?? tGenerated('m_16c73b6230c543')))
        return
      }
      toast.success(tGenerated('m_165fbf2bc8254b', { value0: result.version }))
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
          <SmartBackLink
            href="/apps"
            label={tGenerated('m_07f039d1ce81ec')}
            className="shrink-0 text-sm text-teal-700 hover:underline"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                <GeneratedValue value={appName} />
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${KIND_META[templateKind].cls}`}
              >
                <GeneratedValue value={KIND_META[templateKind].label} />
              </span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_1d76a1713fe585" />
              <GeneratedValue value={currentVersion} /> ·{' '}
              <GeneratedValue value={schema.sections.length} />{' '}
              <GeneratedText id="m_02f67a0e8ba5ce" />
              <GeneratedValue
                value={schema.sections.length === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Globe2 size={14} />
            <Select
              value={contentLocale}
              onChange={(event) => setContentLocale(event.target.value as AppLocale)}
              className="h-8 min-w-28 text-xs"
              aria-label={tGenerated('m_104e7b02f49d5e')}
            >
              {enabledLocales.map((enabledLocale) => (
                <option key={enabledLocale} value={enabledLocale}>
                  {languages(enabledLocale)}
                </option>
              ))}
            </Select>
          </label>
          <GeneratedValue
            value={
              canGenerate ? (
                <Button
                  size="sm"
                  onClick={() => setShowAiAssistant(true)}
                  className="bg-violet-600 text-white hover:bg-violet-700"
                >
                  <Sparkles size={14} /> <GeneratedText id="m_1e0a86199c09df" />
                </Button>
              ) : null
            }
          />
          <Link href={`/apps/templates/${templateId}/records`}>
            <Button variant="outline" size="sm">
              <ClipboardCheck size={14} /> <GeneratedText id="m_0d06d42b0344eb" />
            </Button>
          </Link>
          <Button
            variant={rightPanel === 'preview' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setRightPanel((p) => (p === 'preview' ? 'none' : 'preview'))}
          >
            <Eye size={14} />
            <GeneratedText id="m_11d37007232de5" />
          </Button>
          <Button size="sm" onClick={() => setShowPublish(true)} disabled={pending}>
            <Save size={14} />
            <GeneratedText id="m_01b66d9dba6889" />
            <GeneratedValue value={currentVersion + 1} />
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
              label={tGenerated('m_102c6abe56e4d5')}
            />
            <LeftTab
              active={leftTab === 'build'}
              onClick={() => setLeftTab('build')}
              icon={<PanelLeft size={16} />}
              label={tGenerated('m_0adae4a94c7be3')}
            />
            <LeftTab
              active={leftTab === 'record'}
              onClick={() => setLeftTab('record')}
              icon={<SlidersHorizontal size={16} />}
              label={tGenerated('m_1c1250c8c10a42')}
            />
            <LeftTab
              active={leftTab === 'list'}
              onClick={() => setLeftTab('list')}
              icon={<Table2 size={16} />}
              label={tGenerated('m_02ec964c87acae')}
            />
            <LeftTab
              active={leftTab === 'actions'}
              onClick={() => setLeftTab('actions')}
              icon={<MousePointerClick size={16} />}
              label={tGenerated('m_13f79ee70f138d')}
            />
            <LeftTab
              active={leftTab === 'assignments'}
              onClick={() => setLeftTab('assignments')}
              icon={<Send size={16} />}
              label={tGenerated('m_0444d7da46d928')}
            />
            <LeftTab
              active={leftTab === 'permissions'}
              onClick={() => setLeftTab('permissions')}
              icon={<ShieldCheck size={16} />}
              label={tGenerated('m_128e83250b7fc0')}
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <GeneratedValue
              value={
                leftTab === 'overview' ? (
                  <OverviewPanel
                    templateId={templateId}
                    name={appName}
                    overview={overview}
                    onSaved={setAppName}
                    canPin={canPin}
                    pinned={pinned}
                  />
                ) : leftTab === 'record' ? (
                  <RecordBehaviorPanel
                    templateId={templateId}
                    initial={recordConfig}
                    roles={roles}
                  />
                ) : leftTab === 'list' ? (
                  <RecordListPanel
                    templateId={templateId}
                    initial={listConfig}
                    fields={listFields}
                  />
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
                      title={tGenerated('m_037b62ee03b335')}
                      className={`mb-3 block w-full rounded px-2 py-1 text-left text-xs font-semibold ${
                        selection.kind === 'workflow'
                          ? 'bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-200'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <GeneratedText id="m_001f1bfc6e0cd8" />
                      <GeneratedValue value={stepsCount} />)
                    </button>

                    <h3 className="mb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                      <GeneratedText id="m_1a19ebd22b2247" />
                    </h3>
                    <p className="mb-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_02043182fe57f9" />
                    </p>
                    <GeneratedValue
                      value={[...PALETTE_PRIMARY, ...PALETTE_MORE].map((group) => (
                        <FieldPaletteGroup
                          key={group.label}
                          group={group}
                          onDragType={(t) => {
                            dragElementRef.current = t
                          }}
                          onDragEnd={() => {
                            dragElementRef.current = null
                            setDropSectionId(null)
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
                    />
                  </>
                )
              }
            />
          </div>
        </aside>

        {/* RIGHT 2/3 — build surface ⟷ flows */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
          <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
            <SurfaceTab
              active={surface === 'build'}
              onClick={() => setSurface('build')}
              icon={<LayoutGrid size={13} />}
              label={tGenerated('m_0b120bda8434d5')}
            />
            <SurfaceTab
              active={surface === 'flows'}
              onClick={() => setSurface('flows')}
              icon={<WorkflowIcon size={13} />}
              label={tGenerated('m_1a4786daa752b1')}
            />
            <GeneratedValue
              value={
                surface === 'build' ? (
                  <div className="ml-auto flex items-center gap-2">
                    <span
                      className="hidden text-[10px] font-semibold tracking-wider text-slate-400 uppercase sm:block dark:text-slate-500"
                      title={tGenerated('m_0342c212db3a34')}
                    >
                      <GeneratedText id="m_174bcc6db92052" />
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
                        <GeneratedText id="m_1e888eaf9e8eed" />
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
                        <LayoutGrid size={12} /> <GeneratedText id="m_0627e4bbe74939" />
                      </button>
                    </div>
                  </div>
                ) : null
              }
            />
          </div>
          <GeneratedValue
            value={
              surface === 'flows' ? (
                <div className="min-h-0 flex-1">
                  <FlowsCanvas
                    profile={flowProfile}
                    emailTemplates={emailTemplates}
                    pdfTemplates={pdfTemplates}
                    targetApps={targetApps}
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
                      <GeneratedValue
                        value={
                          selection.kind === 'workflow' ? (
                            <WorkflowEditor
                              schema={schema}
                              locale={contentLocale}
                              defaultLocale={defaultLocale}
                              onChange={(steps) =>
                                setSchema((s) => ({ ...s, workflow: { steps } }))
                              }
                            />
                          ) : null
                        }
                      />

                      {/* Tabs — presentational pages for the fill experience. */}
                      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
                        <GeneratedValue
                          value={appTabs.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setDesignerTab(t.id)}
                              onDoubleClick={() => {
                                const next = window.prompt(
                                  'Rename tab',
                                  localizeText(t.title, contentLocale, '', defaultLocale),
                                )
                                if (next != null) renameTab(t.id, next.trim() || 'Tab')
                              }}
                              title={tGenerated('m_0d31ecacb5b2ee')}
                              className={`group flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition ${
                                designerTab === t.id
                                  ? 'bg-teal-600 text-white'
                                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                              }`}
                            >
                              <GeneratedValue
                                value={localizeText(t.title, contentLocale, 'Tab', defaultLocale)}
                              />
                              <GeneratedValue
                                value={
                                  appTabs.length > 1 ? (
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
                                  ) : null
                                }
                              />
                            </button>
                          ))}
                        />
                        <button
                          type="button"
                          onClick={addTab}
                          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/40"
                          title={tGeneratedValue(
                            appTabs.length === 0
                              ? tGenerated('m_1b7cb35c4f57dd')
                              : tGenerated('m_1e7fd6a7c790fe'),
                          )}
                        >
                          <Plus size={12} />{' '}
                          <GeneratedValue
                            value={
                              appTabs.length === 0 ? (
                                <GeneratedText id="m_0cfeced513f8d1" />
                              ) : (
                                <GeneratedText id="m_1457c1cce0b63c" />
                              )
                            }
                          />
                        </button>
                      </div>

                      <GeneratedValue
                        value={visibleSections.map((sec, i) => {
                          const active =
                            selection.kind === 'section' && selection.sectionId === sec.id
                          return (
                            <Card
                              key={sec.id}
                              onDragEnter={
                                sec.canvas
                                  ? undefined
                                  : (event) => {
                                      if (!dragElementRef.current) return
                                      event.preventDefault()
                                      setDropSectionId(sec.id)
                                    }
                              }
                              onDragOver={
                                sec.canvas
                                  ? undefined
                                  : (event) => {
                                      if (!dragElementRef.current) return
                                      event.preventDefault()
                                      event.dataTransfer.dropEffect = 'copy'
                                    }
                              }
                              onDrop={
                                sec.canvas
                                  ? undefined
                                  : (event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      const type = dragElementRef.current
                                      dragElementRef.current = null
                                      setDropSectionId(null)
                                      if (type) addField(sec.id, type)
                                    }
                              }
                              className={`border transition-colors ${
                                dropSectionId === sec.id
                                  ? 'border-teal-500 bg-teal-50/70 ring-2 ring-teal-500/40 dark:bg-teal-950/30'
                                  : active
                                    ? 'border-teal-500 ring-1 ring-teal-500'
                                    : 'border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                                <button
                                  type="button"
                                  onClick={() => selectSection(sec.id)}
                                  className="flex-1 text-left"
                                >
                                  <CardTitle className="text-base">
                                    <GeneratedValue
                                      value={localizeText(
                                        sec.title,
                                        contentLocale,
                                        'Untitled section',
                                        defaultLocale,
                                      )}
                                    />
                                    <GeneratedValue value={' '} />
                                    <GeneratedValue
                                      value={
                                        sec.repeating ? (
                                          <Badge variant="secondary">
                                            <GeneratedText id="m_06e1ca227aca9b" />
                                          </Badge>
                                        ) : null
                                      }
                                    />
                                    <GeneratedValue
                                      value={
                                        sec.showIf ? (
                                          <Badge variant="outline" className="text-[10px]">
                                            <GeneratedText id="m_02529c1532db7a" />
                                          </Badge>
                                        ) : null
                                      }
                                    />
                                    <GeneratedValue
                                      value={
                                        sec.step ? (
                                          <Badge variant="outline" className="text-[10px]">
                                            <GeneratedText id="m_11933adf482cac" />{' '}
                                            <GeneratedValue
                                              value={stepLabel(
                                                schema,
                                                sec.step,
                                                contentLocale,
                                                defaultLocale,
                                              )}
                                            />
                                          </Badge>
                                        ) : null
                                      }
                                    />
                                  </CardTitle>
                                </button>
                                <div className="flex items-center gap-1">
                                  <IconButton
                                    title={tGenerated('m_1ec1460770eaa0')}
                                    onClick={() => moveSection(sec.id, -1)}
                                    disabled={i === 0}
                                  >
                                    <ArrowUp size={14} />
                                  </IconButton>
                                  <IconButton
                                    title={tGenerated('m_14ab8cefda3cf9')}
                                    onClick={() => moveSection(sec.id, 1)}
                                    disabled={i === visibleSections.length - 1}
                                  >
                                    <ArrowDown size={14} />
                                  </IconButton>
                                  <IconButton
                                    title={tGenerated('m_1e97527af4024b')}
                                    onClick={() => deleteSection(sec.id)}
                                  >
                                    <Trash2 size={14} className="text-red-500" />
                                  </IconButton>
                                </div>
                              </CardHeader>
                              <CardContent className="pt-0">
                                <GeneratedValue
                                  value={
                                    sec.canvas ? (
                                      <CanvasEditor
                                        section={sec}
                                        locale={contentLocale}
                                        defaultLocale={defaultLocale}
                                        selectedFieldId={
                                          selection.kind === 'field' &&
                                          selection.sectionId === sec.id
                                            ? selection.fieldId
                                            : null
                                        }
                                        dragTypeRef={dragElementRef}
                                        onLayout={(items) => setCanvasItems(sec.id, items)}
                                        onAddWidget={(type, box) =>
                                          addWidgetToCanvas(sec.id, type, box)
                                        }
                                        onSelect={(fieldId) => selectField(sec.id, fieldId)}
                                        onDelete={(fieldId) => deleteField(sec.id, fieldId)}
                                      />
                                    ) : sec.fields.length === 0 ? (
                                      <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                                        <GeneratedText id="m_0d6735f83b77a3" />
                                      </div>
                                    ) : (
                                      <Reorder.Group
                                        axis="y"
                                        values={sec.fields}
                                        onReorder={(fields) =>
                                          reorderFields(sec.id, fields as FormField[])
                                        }
                                        as="ul"
                                        className="divide-y divide-slate-100 dark:divide-slate-800"
                                      >
                                        <GeneratedValue
                                          value={sec.fields.map((f, j) => (
                                            <FieldRow
                                              key={f.id}
                                              field={f}
                                              locale={contentLocale}
                                              defaultLocale={defaultLocale}
                                              isSelected={
                                                selection.kind === 'field' &&
                                                selection.fieldId === f.id
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
                                        />
                                      </Reorder.Group>
                                    )
                                  }
                                />
                              </CardContent>
                            </Card>
                          )
                        })}
                      />
                      <Button variant="outline" onClick={addSection} className="w-full">
                        <Plus size={14} />
                        <GeneratedText id="m_0cfd5e4e441158" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            }
          />
        </div>
      </div>

      {/* Properties flyout — opens on selection / "Form settings". */}
      <Drawer
        open={rightPanel === 'props'}
        onClose={() => setRightPanel('none')}
        title={tGeneratedValue(
          selection.kind === 'field'
            ? tGenerated('m_0478595ea3a2da')
            : tGenerated('m_0d513924d97753'),
        )}
        size="sm"
      >
        <GeneratedValue
          value={
            selection.kind === 'field' && selectedField ? (
              <FieldProperties
                key={selectedField.field.id}
                sectionId={selectedField.section.id}
                field={selectedField.field}
                schema={schema}
                locale={contentLocale}
                defaultLocale={defaultLocale}
                onChange={(patch) =>
                  updateField(selectedField.section.id, selectedField.field.id, patch)
                }
              />
            ) : selection.kind === 'section' && selectedSection ? (
              <SectionProperties
                key={selectedSection.id}
                section={selectedSection}
                schema={schema}
                locale={contentLocale}
                defaultLocale={defaultLocale}
                onChange={(patch) => updateSection(selectedSection.id, patch)}
              />
            ) : null
          }
        />
      </Drawer>

      {/* Preview flyout — live render of the filler experience. */}
      <Drawer
        open={rightPanel === 'preview'}
        onClose={() => setRightPanel('none')}
        title={tGenerated('m_11d37007232de5')}
        description={tGenerated('m_1e28aaa8e490af')}
        size="lg"
      >
        <Preview schema={schema} locale={contentLocale} defaultLocale={defaultLocale} />
      </Drawer>

      <Drawer
        open={showPublish}
        onClose={() => setShowPublish(false)}
        title={tGenerated('m_04073463647168', { value0: currentVersion + 1 })}
        description={tGenerated('m_0eced645981830')}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowPublish(false)}>
              <GeneratedText id="m_112e2e8ecda428" />
            </Button>
            <Button onClick={publish} disabled={pending}>
              <Check size={14} />
              <GeneratedValue
                value={
                  pending ? (
                    <GeneratedText id="m_12b32266eec3e2" />
                  ) : (
                    <GeneratedText id="m_0c072fb8baf115" />
                  )
                }
              />
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Alert variant="info">
            <AlertTitle>
              <GeneratedText id="m_1c2ad488291a89" />
            </AlertTitle>
            <AlertDescription>
              <GeneratedText id="m_16d04782fa275d" />
              <GeneratedValue value={currentVersion + 1} />
              <GeneratedText id="m_025b2e6dff2c41" />
            </AlertDescription>
          </Alert>
          <div className="space-y-1">
            <Label>
              <GeneratedText id="m_155fd3bdb6e009" />
            </Label>
            <Textarea
              rows={3}
              value={changelog}
              placeholder={tGenerated('m_061739b5f07deb')}
              onChange={(e) => setChangelog(e.target.value)}
            />
          </div>
          <GeneratedValue
            value={
              error ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    <GeneratedValue value={error} />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
        </div>
      </Drawer>

      {/* AI assistant — build or edit this whole app, with persistent history. */}
      <AiAssistant
        open={showAiAssistant}
        onClose={() => setShowAiAssistant(false)}
        scope="builder.app"
        scopeRefId={templateId}
        title={tGenerated('m_0d811bc45a51cf')}
        description={tGenerated('m_12a6f6cc386ad2')}
        placeholder={tGenerated('m_0c27a1a2207a17')}
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
          toast.success(tGenerated('m_180fea01504577'))
        }}
      />
    </div>
  )
}

function stepLabel(
  schema: FormSchemaV1,
  stepKey: string,
  locale: AppLocale,
  defaultLocale: AppLocale,
): string {
  const step = schema.workflow.steps.find((s) => s.key === stepKey)
  return localizeText(step?.title, locale, stepKey, defaultLocale)
}

function FieldPaletteGroup({
  group,
  onAdd,
  onDragType,
  onDragEnd,
}: {
  group: { label: string; types: FieldType[] }
  onAdd: (t: FieldType) => void
  // Set when a palette item starts dragging, so the canvas drop knows the type.
  onDragType?: (t: FieldType) => void
  onDragEnd?: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="mb-3">
      <div className="px-1 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        <GeneratedValue value={group.label} />
      </div>
      <div className="grid grid-cols-1 gap-1">
        <GeneratedValue
          value={group.types.map((t) => {
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
                onDragEnd={onDragEnd}
                onClick={() => onAdd(t)}
                className="flex cursor-grab items-center gap-2 rounded border border-slate-200 px-2 py-1 text-left text-xs hover:border-teal-500 hover:bg-teal-50 active:cursor-grabbing dark:border-slate-700 dark:hover:border-teal-600 dark:hover:bg-teal-950/40"
                title={tGenerated('m_1b1fa20684f949')}
              >
                <Icon size={12} />
                <GeneratedValue value={FIELD_TYPES[t].label} />
              </button>
            )
          })}
        />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      title={tGeneratedValue(title)}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      <GeneratedValue value={children} />
    </button>
  )
}

// One draggable field row in the designer canvas. Drag is handle-only (via
// framer-motion dragControls) so clicking the row still selects the field; the
// up/down arrows remain as a keyboard-accessible fallback.
function FieldRow({
  field,
  locale,
  defaultLocale,
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
  locale: AppLocale
  defaultLocale: AppLocale
  isSelected: boolean
  typeLabel: string
  onSelect: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  canUp: boolean
  canDown: boolean
}) {
  const tGenerated = useGeneratedTranslations()
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
        aria-label={tGenerated('m_0b04b904ce4f9a')}
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
      >
        <GripVertical size={14} />
      </button>
      <button type="button" onClick={onSelect} className="flex flex-1 items-center gap-2 text-left">
        <Icon size={14} />
        <span className="w-24 truncate text-xs text-slate-400 dark:text-slate-500">
          <GeneratedValue value={typeLabel} />
        </span>
        <span className="text-sm font-medium">
          <GeneratedValue value={localizeText(field.label, locale, field.id, defaultLocale)} />
          <GeneratedValue
            value={
              field.required || field.validation?.required ? (
                <span className="text-red-600"> *</span>
              ) : null
            }
          />
        </span>
        <GeneratedValue
          value={
            field.showIf ? (
              <Badge variant="secondary" className="text-[10px]">
                <GeneratedText id="m_02529c1532db7a" />
              </Badge>
            ) : null
          }
        />
        <GeneratedValue
          value={
            field.formula ? (
              <Badge variant="secondary" className="text-[10px]">
                <GeneratedText id="m_194bb13d821775" />
              </Badge>
            ) : null
          }
        />
      </button>
      <div className="flex items-center gap-1">
        <IconButton title={tGenerated('m_1ec1460770eaa0')} onClick={onMoveUp} disabled={!canUp}>
          <ArrowUp size={12} />
        </IconButton>
        <IconButton title={tGenerated('m_14ab8cefda3cf9')} onClick={onMoveDown} disabled={!canDown}>
          <ArrowDown size={12} />
        </IconButton>
        <IconButton title={tGenerated('m_11773f3c3f7558')} onClick={onDelete}>
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
  locale,
  defaultLocale,
  onChange,
}: {
  schema: FormSchemaV1
  locale: AppLocale
  defaultLocale: AppLocale
  onChange: (steps: FormWorkflowStep[]) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        <CardTitle className="text-base">
          <GeneratedText id="m_1c75ba367ef317" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_1a11f78c7d99d8" />{' '}
          <em>
            <GeneratedText id="m_02b0a83932da4a" />
          </em>{' '}
          →<GeneratedValue value={' '} />
          <em>
            <GeneratedText id="m_14efdd0bff7d70" />
          </em>{' '}
          →{' '}
          <em>
            <GeneratedText id="m_1cc0241831296d" />
          </em>
          <GeneratedText id="m_17833f54b99d38" />
          <GeneratedValue value={' '} />
          <strong>
            <GeneratedText id="m_1c8658eb9347b4" />
          </strong>{' '}
          <GeneratedText id="m_0bf548b271dbc1" />{' '}
          <strong>
            <GeneratedText id="m_1a4786daa752b1" />
          </strong>{' '}
          <GeneratedText id="m_003ae75549476b" />
        </p>
        <ul className="space-y-2">
          <GeneratedValue
            value={steps.map((s, i) => (
              <li
                key={s.key}
                className="rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
                    <GeneratedValue value={i + 1} />
                  </span>
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px]">
                          <GeneratedText id="m_0decefd558c355" />
                        </Label>
                        <Input
                          className="h-7 text-xs"
                          value={s.title?.[locale] ?? ''}
                          placeholder={tGeneratedValue(
                            localizeText(s.title, locale, s.key, defaultLocale),
                          )}
                          onChange={(e) =>
                            setStep(i, {
                              title: { ...(s.title ?? {}), [locale]: e.target.value },
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">
                          <GeneratedText id="m_147b61c2aef29b" />
                        </Label>
                        <Input className="h-7 font-mono text-xs" value={s.key} disabled />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px]">
                          <GeneratedText id="m_160787e531bffd" />
                        </Label>
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
                          <option value="expression">{'Expression'}</option>
                          <option value="role">{'Role'}</option>
                          <option value="literal">{'Specific user'}</option>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[10px]">
                          <GeneratedText id="m_078d7e637546f9" />
                        </Label>
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
                      <GeneratedText id="m_02ffe91f500dc8" />
                    </label>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <IconButton
                      title={tGenerated('m_1ec1460770eaa0')}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                    >
                      <ArrowUp size={12} />
                    </IconButton>
                    <IconButton
                      title={tGenerated('m_14ab8cefda3cf9')}
                      onClick={() => move(i, 1)}
                      disabled={i === steps.length - 1}
                    >
                      <ArrowDown size={12} />
                    </IconButton>
                    <IconButton
                      title={tGenerated('m_09aebdb43a47c7')}
                      onClick={() => remove(i)}
                      disabled={steps.length === 1}
                    >
                      <Trash2 size={12} className="text-red-500" />
                    </IconButton>
                  </div>
                </div>
              </li>
            ))}
          />
        </ul>
        <Button variant="outline" onClick={add} className="w-full">
          <Plus size={14} /> <GeneratedText id="m_0ce705b8fa979c" />
        </Button>
      </CardContent>
    </Card>
  )
}

// --- Field properties (Basic / Validation / Logic / Default / Formula) ----

type FieldPropTab = 'basic' | 'validation' | 'logic' | 'default' | 'formula'

function FieldProperties({
  sectionId,
  field,
  schema,
  locale,
  defaultLocale,
  onChange,
}: {
  sectionId: string
  field: FormField
  schema: FormSchemaV1
  locale: AppLocale
  defaultLocale: AppLocale
  onChange: (patch: Partial<FormField>) => void
}) {
  const [tab, setTab] = useState<FieldPropTab>('basic')
  const isCalcField = field.type === 'formula'
  const storesValue = storesResponseValue(field)
  const ownerSection = schema.sections.find((section) => section.id === sectionId)
  const otherFields = schema.sections
    .flatMap((section) => {
      if (section.repeating && section.id !== sectionId) return []
      if (!ownerSection?.repeating && section.repeating) return []
      return section.fields
    })
    .filter((candidate) => candidate.id !== field.id && storesResponseValue(candidate))
    .map((f) => ({ id: f.id, label: localizeText(f.label, locale, f.id, defaultLocale) }))
  const repeatingSections = schema.sections
    .filter((s) => s.repeating)
    .map((s) => ({
      id: s.id,
      label: localizeText(s.title, locale, s.id, defaultLocale),
      fields: s.fields
        .filter(
          (candidate) =>
            storesResponseValue(candidate) ||
            (!ownerSection?.repeating &&
              candidate.type === 'formula' &&
              candidate.formula !== undefined),
        )
        .map((f) => ({
          id: f.id,
          label: localizeText(f.label, locale, f.id, defaultLocale),
        })),
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
      label: localizeText(f.label, locale, f.id, defaultLocale),
      kind: entityKindForPicker(f.type)!,
    }))

  const tabs: { value: FieldPropTab; label: string; show: boolean }[] = [
    { value: 'basic', label: 'Basic', show: true },
    { value: 'validation', label: 'Validation', show: storesValue },
    { value: 'logic', label: 'Logic', show: true },
    { value: 'default', label: 'Default', show: storesValue },
    { value: 'formula', label: 'Formula', show: isCalcField },
  ]

  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
        <GeneratedText id="m_0bff3b64e15427" />{' '}
        <GeneratedValue value={FIELD_TYPES[field.type]?.label ?? field.type} />
      </h3>
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        <GeneratedValue
          value={tabs
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
                <GeneratedValue value={t.label} />
              </button>
            ))}
        />
      </div>

      <GeneratedValue
        value={
          tab === 'basic' ? (
            <FieldBasicTab
              sectionId={sectionId}
              field={field}
              schema={schema}
              locale={locale}
              defaultLocale={defaultLocale}
              onChange={onChange}
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          tab === 'validation' && storesValue ? (
            <FieldValidationTab field={field} onChange={onChange} />
          ) : null
        }
      />
      <GeneratedValue
        value={
          tab === 'logic' ? (
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_024d5ac76425dc" />
              </Label>
              <p className="text-[10px] text-slate-500">
                <GeneratedText id="m_0db2c879ad4429" />
              </p>
              <LogicBuilder
                rule={field.showIf}
                availableFields={otherFields}
                onChange={(rule) => onChange({ showIf: rule })}
              />
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          tab === 'default' && storesValue ? (
            <FieldDefaultTab field={field} onChange={onChange} />
          ) : null
        }
      />
      <GeneratedValue
        value={
          tab === 'formula' && isCalcField ? (
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_1f15a1cd1a64c4" />
              </Label>
              <p className="text-[10px] text-slate-500">
                <GeneratedText id="m_0cd91fbbd3fca0" />
              </p>
              <FormulaBuilder
                value={field.formula as FormulaExpression | undefined}
                allFields={otherFields}
                repeatingSections={repeatingSections}
                pickerFields={pickerFields}
                onChange={(next) => onChange({ formula: next })}
              />
            </div>
          ) : null
        }
      />
    </div>
  )
}

function FieldBasicTab({
  sectionId,
  field,
  schema,
  locale,
  defaultLocale,
  onChange,
}: {
  sectionId: string
  field: FormField
  schema: FormSchemaV1
  locale: AppLocale
  defaultLocale: AppLocale
  onChange: (patch: Partial<FormField>) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  // Other fields in the app — targets for cascade filters + lookup auto-fill.
  const ownerSection = schema.sections.find((section) => section.id === sectionId)
  const otherFields = schema.sections
    .flatMap((section) => {
      if (section.repeating && section.id !== sectionId) return []
      if (!ownerSection?.repeating && section.repeating) return []
      return section.fields
    })
    .filter((candidate) => candidate.id !== field.id && storesResponseValue(candidate))
    .map((f) => ({ id: f.id, label: localizeText(f.label, locale, f.id, defaultLocale) }))
  const autofillFields = (
    ownerSection?.repeating
      ? ownerSection.fields
      : schema.sections.filter((section) => !section.repeating).flatMap((section) => section.fields)
  )
    .filter((candidate) => candidate.id !== field.id && storesResponseValue(candidate))
    .map((candidate) => ({
      id: candidate.id,
      label: localizeText(candidate.label, locale, candidate.id, defaultLocale),
    }))
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_13d7101bd1f531" />
        </Label>
        <Input value={field.id} disabled className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_1d4f77715c6f3d" />
          <GeneratedValue value={locale.toUpperCase()} />)
        </Label>
        <Input
          value={field.label?.[locale] ?? ''}
          placeholder={tGeneratedValue(localizeText(field.label, locale, field.id, defaultLocale))}
          onChange={(e) => onChange({ label: { ...field.label, [locale]: e.target.value } })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_0d04877b1a742b" />
        </Label>
        <Textarea
          rows={2}
          value={field.helpText?.[locale] ?? ''}
          placeholder={tGeneratedValue(localizeText(field.helpText, locale, '', defaultLocale))}
          onChange={(e) => {
            const helpText = { ...(field.helpText ?? {}) }
            if (e.target.value) helpText[locale] = e.target.value
            else delete helpText[locale]
            onChange({ helpText: Object.values(helpText).some(Boolean) ? helpText : undefined })
          }}
        />
      </div>
      <GeneratedValue
        value={
          storesResponseValue(field) ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={field.required ?? false}
                onChange={(e) => onChange({ required: e.target.checked })}
              />
              <GeneratedText id="m_12fe2fe7a9ddad" />
            </label>
          ) : null
        }
      />
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_14ea5fb193bdaf" />
        </Label>
        <Select
          className="h-8 text-xs"
          value={String(field.colSpan ?? '')}
          onChange={(e) =>
            onChange({ colSpan: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">{'Full width'}</option>
          <option value="1">{'1 column'}</option>
          <option value="2">{'2 columns'}</option>
          <option value="3">{'3 columns'}</option>
          <option value="4">{'4 columns'}</option>
        </Select>
        <p className="text-[10px] text-slate-500">
          <GeneratedText id="m_0f334abe43e80f" />
        </p>
      </div>
      <GeneratedValue
        value={
          field.type === 'select' ||
          field.type === 'radio' ||
          field.type === 'multi_select' ||
          field.type === 'checkbox_group' ||
          field.type === 'ranking' ? (
            <ChoiceOptionsEditor field={field} locale={locale} onChange={onChange} />
          ) : null
        }
      />
      <GeneratedValue
        value={
          field.type === 'table' ? <TableConfigEditor field={field} onChange={onChange} /> : null
        }
      />
      <GeneratedValue
        value={
          field.type === 'slider' ? <SliderConfigEditor field={field} onChange={onChange} /> : null
        }
      />
      <GeneratedValue
        value={
          field.type === 'matrix' ? <MatrixConfigEditor field={field} onChange={onChange} /> : null
        }
      />
      <GeneratedValue
        value={
          field.type === 'photo' ? <PhotoConfigEditor field={field} onChange={onChange} /> : null
        }
      />
      <GeneratedValue
        value={
          field.type === 'lookup' || field.type === 'data_table' || field.type === 'metric' ? (
            <DataBindingEditor
              field={field}
              otherFields={otherFields}
              autofillFields={autofillFields}
              onChange={onChange}
            />
          ) : null
        }
      />
    </div>
  )
}

function PhotoConfigEditor({
  field,
  onChange,
}: {
  field: FormField
  onChange: (patch: Partial<FormField>) => void
}) {
  const config = (field.config ?? {}) as {
    multiple?: boolean
    maxFiles?: number
    aiAnalysis?: boolean
  }
  const multiple = config.multiple !== false
  const set = (patch: Partial<typeof config>) => onChange({ config: { ...field.config, ...patch } })

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-800">
      <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        <GeneratedText id="m_0b648a9b0a5a77" />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(event) =>
            set({
              multiple: event.target.checked,
              maxFiles: event.target.checked
                ? config.maxFiles && config.maxFiles > 1
                  ? config.maxFiles
                  : 10
                : 1,
            })
          }
        />
        <GeneratedText id="m_1d2af5c83914b6" />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={config.aiAnalysis === true}
          onChange={(event) => set({ aiAnalysis: event.target.checked })}
        />
        <GeneratedText id="m_01a08eeac5c42c" />
      </label>
      {multiple ? (
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_10d0f58130e0c4" />
          </Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={config.maxFiles ?? 10}
            onChange={(event) =>
              set({ maxFiles: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })
            }
          />
        </div>
      ) : null}
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_1fc2a2e38d88c7" />
      </p>
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
  const tGenerated = useGeneratedTranslations()
  const c = (field.config ?? {}) as { min?: number; max?: number; step?: number; unit?: string }
  const set = (patch: Partial<typeof c>) => onChange({ config: { ...field.config, ...patch } })
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        <GeneratedText id="m_03363edf51ed99" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_100639ca393959" />
          </Label>
          <Input
            type="number"
            value={c.min ?? 0}
            onChange={(e) => set({ min: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_1929e34b445f83" />
          </Label>
          <Input
            type="number"
            value={c.max ?? 10}
            onChange={(e) => set({ max: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_0cff7e37da2b3f" />
          </Label>
          <Input
            type="number"
            value={c.step ?? 1}
            onChange={(e) => set({ step: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_19241615edae92" />
        </Label>
        <Input
          value={c.unit ?? ''}
          placeholder={tGenerated('m_075f330b972a3b')}
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
  const tGenerated = useGeneratedTranslations()
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
            <GeneratedText id="m_03be2202673df4" />
          </span>
          <button
            type="button"
            className="text-xs text-teal-700 hover:underline"
            onClick={() =>
              setRows([...rows, { key: newId('row'), label: `Row ${rows.length + 1}` }])
            }
          >
            <GeneratedText id="m_0d067cf371aad1" />
          </button>
        </div>
        <div className="space-y-1">
          <GeneratedValue
            value={rows.map((r, i) => (
              <div key={r.key} className="flex items-center gap-1">
                <Input
                  value={r.label}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <IconButton
                  title={tGenerated('m_12b310a027b08a')}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 size={13} className="text-red-500" />
                </IconButton>
              </div>
            ))}
          />
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            <GeneratedText id="m_1bd1bb813826dc" />
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
            <GeneratedText id="m_0f92f0f3b0d515" />
          </button>
        </div>
        <div className="space-y-1">
          <GeneratedValue
            value={scale.map((s, i) => (
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
                  title={tGenerated('m_095b70fae90c39')}
                  onClick={() => setScale(scale.filter((_, j) => j !== i))}
                >
                  <Trash2 size={13} className="text-red-500" />
                </IconButton>
              </div>
            ))}
          />
        </div>
      </div>
    </div>
  )
}

// --- Data-bound element binding editor -------------------------------------

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

  // Fetched per mount (NOT module-cached): a module-level promise would keep
  // serving the previous tenant's source list after a tenant switch.
  useEffect(() => {
    const cleanup = applySourcePromise(listDataSources())
    activeLoadRef.current = cleanup
    return cleanup
  }, [applySourcePromise])

  return {
    sources,
    loading,
    refresh: () => {
      activeLoadRef.current?.()
      setLoading(true)
      activeLoadRef.current = applySourcePromise(listDataSources())
    },
  }
}

type DsColumns = DataSourceSummary['columns']

function DataBindingEditor({
  field,
  otherFields,
  autofillFields,
  onChange,
}: {
  field: FormField
  otherFields: { id: string; label: string }[]
  autofillFields: { id: string; label: string }[]
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
    onChange({
      binding: next,
      ...(field.type === 'data_table' && p.selectable === 'none'
        ? { required: undefined, validation: undefined, defaultValue: undefined }
        : {}),
    })
  }

  return (
    <div className="space-y-2.5 rounded-md border border-violet-200 bg-violet-50/30 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-wider text-violet-500 uppercase">
          <GeneratedText id="m_0d523c82eb812b" />
        </span>
        <a
          href="/admin/data-sources"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-violet-700 hover:underline"
        >
          <GeneratedText id="m_1154a02825ffe0" />
        </a>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 text-[11px] text-violet-700 hover:underline"
        >
          <RefreshCw size={11} />
          <GeneratedText id="m_16f11d7bc7b7b4" />
        </button>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_1e51e17fccd721" />
        </Label>
        <Select
          className="h-8 text-xs"
          value={b?.sourceKey ?? ''}
          onChange={(e) =>
            onChange({
              binding: e.target.value ? { sourceKey: e.target.value } : undefined,
              ...(field.type === 'data_table'
                ? { required: undefined, validation: undefined, defaultValue: undefined }
                : {}),
            })
          }
        >
          <option value="">{loading ? 'Loading…' : '— pick a data source —'}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.key}>
              {s.name}
            </option>
          ))}
        </Select>
        <GeneratedValue
          value={
            !loading && sources.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                <GeneratedText id="m_19589d12bcbbf9" />
              </p>
            ) : null
          }
        />
      </div>

      <GeneratedValue
        value={
          source ? (
            <>
              <GeneratedValue
                value={
                  field.type === 'lookup' ? (
                    <LookupBindingFields
                      b={b}
                      cols={cols}
                      otherFields={otherFields}
                      autofillFields={autofillFields}
                      patch={patch}
                    />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  field.type === 'data_table' ? (
                    <DataTableBindingFields
                      b={b}
                      cols={cols}
                      otherFields={otherFields}
                      patch={patch}
                    />
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  field.type === 'metric' ? (
                    <MetricBindingFields
                      b={b}
                      cols={cols}
                      otherFields={otherFields}
                      patch={patch}
                    />
                  ) : null
                }
              />
            </>
          ) : null
        }
      />
    </div>
  )
}

function LookupBindingFields({
  b,
  cols,
  otherFields,
  autofillFields,
  patch,
}: {
  b: DataBinding | undefined
  cols: DsColumns
  otherFields: { id: string; label: string }[]
  autofillFields: { id: string; label: string }[]
  patch: (p: Partial<DataBinding>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const autofill = b?.autofill ?? []
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_16ba74a70fdc2f" />
          </Label>
          <Select
            className="h-8 text-xs"
            value={b?.labelColumn ?? ''}
            onChange={(e) => patch({ labelColumn: e.target.value || undefined })}
          >
            <option value="">{'First column'}</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_01c681f83ca98e" />
          </Label>
          <Select
            className="h-8 text-xs"
            value={b?.valueColumn ?? ''}
            onChange={(e) => patch({ valueColumn: e.target.value || undefined })}
          >
            <option value="">{'Row id'}</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <CascadeBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />

      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_0d55cb5819a8ab" />
        </Label>
        <Input
          type="number"
          min={1}
          max={1000}
          className="h-8 text-xs"
          value={b?.limit ?? ''}
          placeholder="50"
          onChange={(e) => patch({ limit: e.target.value ? Number(e.target.value) : undefined })}
        />
        <p className="text-[10px] text-slate-500">
          <GeneratedText id="m_1c39dfb38ad051" />
        </p>
      </div>

      <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            <GeneratedText id="m_1aa941e2f78dc5" />
          </span>
          <button
            type="button"
            className="text-xs text-teal-700 hover:underline"
            onClick={() =>
              patch({
                autofill: [
                  ...autofill,
                  { column: cols[0]?.key ?? '', targetFieldId: autofillFields[0]?.id ?? '' },
                ],
              })
            }
          >
            <GeneratedText id="m_0e2a97913eb84b" />
          </button>
        </div>
        <GeneratedValue
          value={
            autofill.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                <GeneratedText id="m_125586069a681f" />
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
                    {autofillFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <IconButton
                    title={tGenerated('m_1d82f43c88df4c')}
                    onClick={() => patch({ autofill: autofill.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={13} className="text-red-500" />
                  </IconButton>
                </div>
              ))
            )
          }
        />
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
        <GeneratedText id="m_171519729cccb4" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_0bb347c23433ea" />
          </Label>
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
            <option value="">{'— none —'}</option>
            {otherFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_0fdf1d8380c89b" />
          </Label>
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
        <GeneratedText id="m_03f068cc4e9384" />
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
        <Label className="text-xs">
          <GeneratedText id="m_16f13907f8a65a" />
        </Label>
        <div className="flex flex-wrap gap-1.5 rounded border border-slate-200 bg-white p-1.5">
          <GeneratedValue
            value={cols.map((c) => {
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
                  <GeneratedValue value={c.label} />
                </button>
              )
            })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_14b18c80af7bd4" />
          </Label>
          <Select
            className="h-8 text-xs"
            value={b?.selectable ?? 'none'}
            onChange={(e) => patch({ selectable: e.target.value as DataBinding['selectable'] })}
          >
            <option value="none">{'Display only'}</option>
            <option value="single">{'Pick one row'}</option>
            <option value="multi">{'Pick many rows'}</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_1ab6807a4e8f9e" />
          </Label>
          <Input
            type="number"
            min={1}
            max={1000}
            className="h-8 text-xs"
            value={b?.limit ?? ''}
            placeholder="25"
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const agg = b?.aggregate ?? { fn: 'count' as const }
  const setAgg = (p: Partial<NonNullable<DataBinding['aggregate']>>) =>
    patch({ aggregate: { ...agg, ...p } })
  const needsColumn = agg.fn !== 'count'
  return (
    <div className="space-y-2">
      <CascadeBindingFields b={b} cols={cols} otherFields={otherFields} patch={patch} />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_102bef82722058" />
          </Label>
          <Select
            className="h-8 text-xs"
            value={agg.fn}
            onChange={(e) => {
              const fn = e.target.value as NonNullable<DataBinding['aggregate']>['fn']
              setAgg(fn === 'count' ? { fn, column: undefined } : { fn })
            }}
          >
            <option value="count">{'Count'}</option>
            <option value="sum">{'Sum'}</option>
            <option value="avg">{'Average'}</option>
            <option value="min">{'Min'}</option>
            <option value="max">{'Max'}</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_166da8c01a8107" />
          </Label>
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
          <Label className="text-xs">
            <GeneratedText id="m_175ee59112fb66" />
          </Label>
          <Select
            className="h-8 text-xs"
            value={agg.groupBy ?? ''}
            onChange={(e) => {
              const groupBy = e.target.value || undefined
              patch({
                aggregate: { ...agg, groupBy },
                display: groupBy ? (b?.display === 'pie' ? 'pie' : 'bar') : 'number',
              })
            }}
          >
            <option value="">{'— no grouping —'}</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            <GeneratedText id="m_06b9949f5fa1bc" />
          </Label>
          <Select
            className="h-8 text-xs"
            value={b?.display ?? (agg.groupBy ? 'bar' : 'number')}
            onChange={(e) => patch({ display: e.target.value as DataBinding['display'] })}
          >
            {agg.groupBy ? (
              <>
                <option value="bar">{'Bar chart'}</option>
                <option value="pie">{'Pie chart'}</option>
              </>
            ) : (
              <option value="number">{'Number'}</option>
            )}
          </Select>
        </div>
      </div>
      <p className="text-[10px] text-slate-500">
        <GeneratedText id="m_067480a82419f2" />
      </p>
      <GeneratedValue
        value={
          agg.groupBy ? (
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_147c46b5f494d3" />
              </Label>
              <Input
                type="number"
                min={1}
                max={1000}
                className="h-8 text-xs"
                value={b?.limit ?? ''}
                placeholder={tGeneratedValue(b?.display === 'pie' ? '8' : '12')}
                onChange={(e) =>
                  patch({ limit: e.target.value ? Number(e.target.value) : undefined })
                }
              />
              <p className="text-[10px] text-slate-500">
                <GeneratedText id="m_018f962bfee661" />
              </p>
            </div>
          ) : null
        }
      />
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
  const tGenerated = useGeneratedTranslations()
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
        <GeneratedText id="m_0316664a18ded7" />
      </label>
      <GeneratedValue
        value={
          isNumeric ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_100639ca393959" />
                </Label>
                <Input
                  type="number"
                  value={v.min ?? ''}
                  onChange={(e) =>
                    set({ min: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_1929e34b445f83" />
                </Label>
                <Input
                  type="number"
                  value={v.max ?? ''}
                  onChange={(e) =>
                    set({ max: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          isText ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_141aeed76d15ff" />
                </Label>
                <Input
                  type="number"
                  value={v.minLength ?? ''}
                  onChange={(e) =>
                    set({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_0806911c39f2f6" />
                </Label>
                <Input
                  type="number"
                  value={v.maxLength ?? ''}
                  onChange={(e) =>
                    set({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </div>
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          isText ? (
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_1357113b889d93" />
              </Label>
              <Input
                value={v.pattern ?? ''}
                onChange={(e) => set({ pattern: e.target.value || undefined })}
                placeholder={tGenerated('m_16907e8a555a15')}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_1653ad0a199171" />{' '}
                <GeneratedValue value={<GeneratedText id="m_1a3262f89c2c42" />} />{' '}
                <GeneratedText id="m_00b3d8649525da" />
              </p>
            </div>
          ) : null
        }
      />
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_1a014cc338576c" />
        </Label>
        <Input
          value={v.message ?? ''}
          onChange={(e) => set({ message: e.target.value || undefined })}
          placeholder={tGenerated('m_1737e921e5c6c6')}
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
  const tGenerated = useGeneratedTranslations()
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
        <GeneratedText id="m_0de21bd4fd99e9" />
      </p>
      <Select className="h-8 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">{'— No default —'}</option>
        <option value="literal">{'Literal value'}</option>
        <option value="today">{"Today's date"}</option>
        <option value="now">{'Right now'}</option>
        <option value="current_user_person_id">{"Current user's person id"}</option>
        <option value="current_user_name">{"Current user's name"}</option>
      </Select>
      <GeneratedValue
        value={
          d?.kind === 'literal' ? (
            <Input
              value={String(d.value ?? '')}
              onChange={(e) =>
                onChange({ defaultValue: { kind: 'literal', value: e.target.value } })
              }
              placeholder={tGenerated('m_0776e7f56fd55a')}
            />
          ) : null
        }
      />
    </div>
  )
}

function ChoiceOptionsEditor({
  field,
  locale,
  onChange,
}: {
  field: FormField
  locale: AppLocale
  onChange: (patch: Partial<FormField>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const options = field.validation?.options ?? []
  const update = (next: typeof options) =>
    onChange({ validation: { ...field.validation, options: next } })
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-2">
      <div className="text-xs font-semibold text-slate-600">
        <GeneratedText id="m_0e69ebb67d27c2" />
      </div>
      <GeneratedValue
        value={
          options.length === 0 ? (
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_06a6b6820d522d" />
            </p>
          ) : (
            <ul className="space-y-1">
              <GeneratedValue
                value={options.map((opt, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <Input
                      className="h-8 flex-1 text-xs"
                      value={opt.value}
                      placeholder={tGenerated('m_1ed2cc27e05841')}
                      onChange={(e) => {
                        const next = [...options]
                        next[i] = { ...opt, value: e.target.value }
                        update(next)
                      }}
                    />
                    <Input
                      className="h-8 flex-1 text-xs"
                      value={opt.label?.[locale] ?? ''}
                      placeholder={tGenerated('m_02a6c587f3d3fb')}
                      onChange={(e) => {
                        const next = [...options]
                        next[i] = {
                          ...opt,
                          label: { ...(opt.label ?? {}), [locale]: e.target.value },
                        }
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
              />
            </ul>
          )
        }
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          update([
            ...options,
            {
              value: `opt_${options.length + 1}`,
              label: { [locale]: 'New option' },
            },
          ])
        }
      >
        <Plus size={12} />
        <GeneratedText id="m_157bc1fc2157b9" />
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
  const tGenerated = useGeneratedTranslations()
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
      <div className="text-xs font-semibold text-slate-600">
        <GeneratedText id="m_0d25e53152dc0a" />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_03be2202673df4" />
        </Label>
        <Select
          className="h-8 text-xs"
          value={rowMode}
          onChange={(e) => {
            const nextMode = e.target.value as 'addable' | 'fixed'
            setConfig(
              nextMode === 'fixed'
                ? { rowMode: nextMode, minRows: undefined, maxRows: undefined }
                : { rowMode: nextMode, rows: undefined },
            )
          }}
        >
          <option value="addable">{'Addable — user adds / removes rows'}</option>
          <option value="fixed">{'Predefined — fixed list of rows'}</option>
        </Select>
      </div>

      <GeneratedValue
        value={
          rowMode === 'addable' ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_00c5b5a40a72f6" />
                </Label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={config.minRows ?? ''}
                  onChange={(e) =>
                    setConfig({
                      minRows: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_199de632ae64e0" />
                </Label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={config.maxRows ?? ''}
                  onChange={(e) =>
                    setConfig({
                      maxRows: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          ) : null
        }
      />

      <div className="space-y-2">
        <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          <GeneratedText id="m_04eacfda3069db" />
        </div>
        <GeneratedValue
          value={
            columns.length === 0 ? (
              <p className="text-xs text-slate-500">
                <GeneratedText id="m_09750de58b1490" />
              </p>
            ) : (
              <ul className="space-y-2">
                <GeneratedValue
                  value={columns.map((c, i) => (
                    <li key={i} className="space-y-1 rounded border border-slate-200 bg-white p-2">
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-7 flex-1 text-xs"
                          value={c.label}
                          placeholder={tGenerated('m_1e2be77312c5b8')}
                          onChange={(e) =>
                            setColumns(
                              columns.map((x, idx) =>
                                idx === i ? { ...x, label: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        <Select
                          className="h-7 w-24 text-xs"
                          value={c.type}
                          onChange={(e) => {
                            const type = e.target.value as TableColumn['type']
                            setColumns(
                              columns.map((x, idx) =>
                                idx === i
                                  ? {
                                      ...x,
                                      type,
                                      options: type === 'select' ? (x.options ?? []) : undefined,
                                    }
                                  : x,
                              ),
                            )
                          }}
                        >
                          <option value="text">{'Text'}</option>
                          <option value="number">{'Number'}</option>
                          <option value="select">{'Dropdown'}</option>
                          <option value="checkbox">{'Checkbox'}</option>
                          <option value="date">{'Date'}</option>
                        </Select>
                        <button
                          type="button"
                          onClick={() => setColumns(columns.filter((_, idx) => idx !== i))}
                          className="rounded p-1 text-slate-400 hover:text-red-500"
                          title={tGenerated('m_0605fd789eea1e')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <Input
                        className="h-7 font-mono text-[11px]"
                        value={c.key}
                        placeholder={tGenerated('m_1d19a02fd2872f')}
                        onChange={(e) =>
                          setColumns(
                            columns.map((x, idx) =>
                              idx === i ? { ...x, key: e.target.value.replace(/\s+/g, '_') } : x,
                            ),
                          )
                        }
                      />
                      <GeneratedValue
                        value={
                          c.type === 'select' ? (
                            <TableColumnOptions
                              options={c.options ?? []}
                              onChange={(opts) =>
                                setColumns(
                                  columns.map((x, idx) =>
                                    idx === i ? { ...x, options: opts } : x,
                                  ),
                                )
                              }
                            />
                          ) : null
                        }
                      />
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const n = columns.length + 1
            setColumns([...columns, { key: `col_${n}`, label: `Column ${n}`, type: 'text' }])
          }}
        >
          <Plus size={12} /> <GeneratedText id="m_059cd549852b55" />
        </Button>
      </div>

      <GeneratedValue
        value={
          rowMode === 'fixed' ? (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                <GeneratedText id="m_159e1e93b7e19d" />
              </div>
              <GeneratedValue
                value={
                  fixedRows.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      <GeneratedText id="m_126f736e7419f7" />
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      <GeneratedValue
                        value={fixedRows.map((r, i) => (
                          <li key={i} className="flex items-center gap-1">
                            <Input
                              className="h-7 flex-1 text-xs"
                              value={r.label}
                              placeholder={tGenerated('m_0f24da1a05270a')}
                              onChange={(e) =>
                                setRows(
                                  fixedRows.map((x, idx) =>
                                    idx === i ? { label: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                            <button
                              type="button"
                              onClick={() => setRows(fixedRows.filter((_, idx) => idx !== i))}
                              className="rounded p-1 text-slate-400 hover:text-red-500"
                              title={tGenerated('m_12b310a027b08a')}
                            >
                              <Trash2 size={12} />
                            </button>
                          </li>
                        ))}
                      />
                    </ul>
                  )
                }
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRows([...fixedRows, { label: `Row ${fixedRows.length + 1}` }])}
              >
                <Plus size={12} /> <GeneratedText id="m_1eabd71bbc0199" />
              </Button>
            </div>
          ) : null
        }
      />
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
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-1 rounded border border-slate-100 bg-slate-50 p-1.5">
      <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
        <GeneratedText id="m_0e69ebb67d27c2" />
      </div>
      <GeneratedValue
        value={options.map((o, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input
              className="h-6 flex-1 text-[11px]"
              value={o.label}
              placeholder={tGenerated('m_044a5abd7d3ad4')}
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
      />
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
        <Plus size={11} /> <GeneratedText id="m_00f78a864ff266" />
      </Button>
    </div>
  )
}

// --- Section properties ----------------------------------------------------

function SectionProperties({
  section,
  schema,
  locale,
  defaultLocale,
  onChange,
}: {
  section: FormSection
  schema: FormSchemaV1
  locale: AppLocale
  defaultLocale: AppLocale
  onChange: (patch: Partial<FormSection>) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const allFields = schema.sections
    .filter((candidate) => !candidate.repeating)
    .flatMap((candidate) => candidate.fields)
    .filter(storesResponseValue)
    .map((field) => ({
      id: field.id,
      label: localizeText(field.label, locale, field.id, defaultLocale),
    }))
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
        <GeneratedText id="m_0d513924d97753" />
      </h3>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_089e71eb771aca" />
        </Label>
        <Input value={section.id} disabled className="font-mono text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_1ea646f0dcd3d5" />
          <GeneratedValue value={locale.toUpperCase()} />)
        </Label>
        <Input
          value={section.title?.[locale] ?? ''}
          placeholder={tGeneratedValue(
            localizeText(section.title, locale, section.id, defaultLocale),
          )}
          onChange={(e) =>
            onChange({ title: { ...(section.title ?? {}), [locale]: e.target.value } })
          }
        />
      </div>
      <GeneratedValue
        value={
          schema.tabs?.length ? (
            <div className="space-y-1">
              <Label className="text-xs">
                <GeneratedText id="m_1457c1cce0b63c" />
              </Label>
              <Select
                value={section.tabId ?? schema.tabs[0]!.id}
                onChange={(e) => onChange({ tabId: e.target.value })}
              >
                {schema.tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {localizeText(t.title, locale, t.id, defaultLocale)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null
        }
      />
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_14d923495cf14c" />
        </Label>
        <Textarea
          rows={2}
          value={section.description?.[locale] ?? ''}
          placeholder={tGeneratedValue(
            localizeText(section.description, locale, '', defaultLocale),
          )}
          onChange={(e) => {
            const description = { ...(section.description ?? {}) }
            if (e.target.value) description[locale] = e.target.value
            else delete description[locale]
            onChange({
              description: Object.values(description).some(Boolean) ? description : undefined,
            })
          }}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_0664f38791aed8" />
        </Label>
        <Select
          className="h-8 text-xs"
          value={section.step ?? ''}
          onChange={(e) => onChange({ step: e.target.value || undefined })}
        >
          <option value="">{'— first step (default) —'}</option>
          {schema.workflow.steps.map((s) => (
            <option key={s.key} value={s.key}>
              {localizeText(s.title, locale, s.key, defaultLocale)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          <GeneratedText id="m_1ee65e14915cf1" />
        </Label>
        <Select
          className="h-8 text-xs"
          value={String(section.layout?.columns ?? 1)}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange({ layout: n > 1 ? { columns: n, gap: section.layout?.gap } : undefined })
          }}
        >
          <option value="1">{'1 column'}</option>
          <option value="2">{'2 columns'}</option>
          <option value="3">{'3 columns'}</option>
          <option value="4">{'4 columns'}</option>
        </Select>
        <p className="text-[10px] text-slate-500">
          <GeneratedText id="m_1e0a540071af99" />
        </p>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={section.repeating ?? false}
          onChange={(e) => onChange({ repeating: e.target.checked })}
        />
        <GeneratedText id="m_10a741ad57253f" />
      </label>
      <GeneratedValue
        value={
          section.repeating ? (
            <div className="space-y-2 rounded border border-slate-200 bg-slate-50/50 p-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_00c5b5a40a72f6" />
                  </Label>
                  <Input
                    type="number"
                    value={section.minRows ?? ''}
                    onChange={(e) =>
                      onChange({
                        minRows: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_199de632ae64e0" />
                  </Label>
                  <Input
                    type="number"
                    value={section.maxRows ?? ''}
                    onChange={(e) =>
                      onChange({
                        maxRows: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  <GeneratedText id="m_1c4a359175c7fa" />
                </Label>
                <Input
                  value={section.rowLabelTemplate ?? ''}
                  placeholder={tGenerated('m_02890419bf69c5')}
                  onChange={(e) => onChange({ rowLabelTemplate: e.target.value || undefined })}
                />
                <p className="text-[10px] text-slate-500">
                  <GeneratedText id="m_0ea6ba70f4dcd9" />{' '}
                  <GeneratedValue value={<GeneratedText id="m_126c7eab8ac9fd" />} />,{' '}
                  <GeneratedValue value={<GeneratedText id="m_1ed8de977a458a" />} />
                  <GeneratedText id="m_1e018b65c95ffd" />{' '}
                  <GeneratedValue value={<GeneratedText id="m_1fad56c24b22ed" />} />{' '}
                  <GeneratedText id="m_02193054995990" />
                </p>
              </div>
            </div>
          ) : null
        }
      />
      <div className="space-y-1 pt-2">
        <Label className="text-xs">
          <GeneratedText id="m_024d5ac76425dc" />
        </Label>
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

function Preview({
  schema,
  locale,
  defaultLocale,
}: {
  schema: FormSchemaV1
  locale: AppLocale
  defaultLocale: AppLocale
}) {
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
        <CardTitle className="text-base">
          <GeneratedText id="m_07c67e89962d16" />{' '}
          <GeneratedValue value={localizeText(schema.title, locale, 'Form', defaultLocale)} />
        </CardTitle>
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_045d47c21e1cdf" />
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <GeneratedValue
          value={schema.workflow.steps.map((step) => {
            const stepSections = groupedByStep.get(step.key) ?? []
            if (stepSections.length === 0) return null
            return (
              <div
                key={step.key}
                className="rounded-md border border-slate-200 dark:border-slate-800"
              >
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                  <GeneratedText id="m_1acffe9b7aa3dd" />{' '}
                  <GeneratedValue
                    value={localizeText(step.title, locale, step.key, defaultLocale)}
                  />
                </div>
                <div className="space-y-3 p-3">
                  <GeneratedValue
                    value={stepSections.map((sec) => (
                      <div key={sec.id}>
                        <h3 className="mb-1 text-sm font-semibold text-slate-700">
                          <GeneratedValue
                            value={localizeText(sec.title, locale, sec.id, defaultLocale)}
                          />
                          <GeneratedValue value={' '} />
                          <GeneratedValue
                            value={
                              sec.repeating ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  <GeneratedText id="m_06e1ca227aca9b" />
                                </Badge>
                              ) : null
                            }
                          />
                        </h3>
                        <GeneratedValue
                          value={
                            localizeText(sec.description, locale, '', defaultLocale) ? (
                              <p className="mb-1 text-xs text-slate-500">
                                <GeneratedValue
                                  value={localizeText(sec.description, locale, '', defaultLocale)}
                                />
                              </p>
                            ) : null
                          }
                        />
                        <div className="space-y-2">
                          <GeneratedValue
                            value={sec.fields.map((f) => (
                              <div key={f.id}>
                                <label className="block text-xs font-medium text-slate-600">
                                  <GeneratedValue
                                    value={localizeText(f.label, locale, f.id, defaultLocale)}
                                  />
                                  <GeneratedValue value={' '} />
                                  <GeneratedValue
                                    value={
                                      f.required || f.validation?.required ? (
                                        <span className="text-red-600">*</span>
                                      ) : null
                                    }
                                  />
                                  <GeneratedValue
                                    value={
                                      f.showIf ? (
                                        <Badge variant="outline" className="ml-1 text-[10px]">
                                          <GeneratedText id="m_02529c1532db7a" />
                                        </Badge>
                                      ) : null
                                    }
                                  />
                                </label>
                                <PreviewField type={f.type} />
                              </div>
                            ))}
                          />
                        </div>
                      </div>
                    ))}
                  />
                </div>
              </div>
            )
          })}
        />
      </CardContent>
    </Card>
  )
}

function PreviewField({ type }: { type: FieldType }) {
  const tGenerated = useGeneratedTranslations()
  switch (type) {
    case 'long_text':
      return <Textarea rows={2} disabled placeholder={tGenerated('m_11d37007232de5')} />
    case 'select':
    case 'radio':
      return (
        <Select disabled>
          <option>—</option>
        </Select>
      )
    case 'checkbox_group':
    case 'multi_select':
      return (
        <p className="text-xs text-slate-400">
          <GeneratedText id="m_0a31fefe8144a2" />
        </p>
      )
    case 'signature':
      return <div className="h-16 rounded border border-dashed border-slate-300 bg-slate-50" />
    case 'photo':
    case 'file':
    case 'video':
    case 'audio':
      return (
        <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
          <GeneratedText id="m_1411910c3561c0" />
        </div>
      )
    case 'heading':
      return (
        <h4 className="text-base font-semibold">
          <GeneratedText id="m_0f8b37ea44adb6" />
        </h4>
      )
    case 'paragraph':
      return (
        <p className="text-xs text-slate-500">
          <GeneratedText id="m_0131c1cfaf2d5c" />
        </p>
      )
    case 'divider':
      return <hr className="border-slate-200" />
    case 'formula':
      return <Input disabled value="(computed)" />
    case 'pass_fail_na':
      return (
        <div className="flex gap-1">
          <GeneratedValue
            value={['PASS', 'FAIL', 'N/A'].map((v) => (
              <span key={v} className="rounded border border-slate-200 px-2 py-1 text-[10px]">
                <GeneratedValue value={v} />
              </span>
            ))}
          />
        </div>
      )
    case 'traffic_light':
      return (
        <div className="flex gap-1">
          <GeneratedValue
            value={[
              ['bg-emerald-500', 'Green'],
              ['bg-amber-400', 'Yellow'],
              ['bg-red-500', 'Red'],
            ].map(([tone, label]) => (
              <span
                key={label as string}
                className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px]"
              >
                <span className={`inline-block h-2 w-2 rounded-full ${tone}`} />
                <GeneratedValue value={label} />
              </span>
            ))}
          />
        </div>
      )
    default:
      return <Input disabled placeholder={tGenerated('m_11d37007232de5')} />
  }
}

// --- Unified editor: rail tabs + left-pane panels ---------------------------

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        <GeneratedValue value={label} />
      </Label>
      <GeneratedValue value={children} />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      onClick={onClick}
      title={tGeneratedValue(label)}
      aria-label={tGeneratedValue(label)}
      className={`flex flex-1 items-center justify-center rounded-md px-1.5 py-2 transition ${
        active
          ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
      }`}
    >
      <GeneratedValue value={icon} />
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
      <GeneratedValue value={icon} /> <GeneratedValue value={label} />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [n, setN] = useState(name)
  const [description, setDescription] = useState(overview?.description ?? '')
  const [surfaceAsTool, setSurfaceAsTool] = useState(overview?.surfaceAsTool ?? false)
  const [pending, start] = useTransition()
  const save = () => {
    if (n.trim().length < 2) {
      toast.error(tGenerated('m_0aa48682b14c95'))
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
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0af1983403d12e')))
        return
      }
      onSaved(n.trim())
      toast.success(tGenerated('m_0964f6e2cc4375'))
    })
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        <GeneratedText id="m_08114bb9803f7d" />
      </p>
      <LabeledField label={tGenerated('m_18a30dc84d2a64')}>
        <Input value={n} onChange={(e) => setN(e.target.value)} />
      </LabeledField>
      <LabeledField label={tGenerated('m_14d923495cf14c')}>
        <Textarea
          rows={4}
          value={description}
          placeholder={tGenerated('m_074251897a5932')}
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
            <GeneratedText id="m_1f008c56f09179" />
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_160f2c28b65229" />{' '}
            <span className="font-mono">
              <GeneratedText id="m_1ddad1532de2e3" />
            </span>{' '}
            <GeneratedText id="m_186d665b9052f3" />
          </span>
        </span>
      </label>
      <Button onClick={save} disabled={pending} className="w-full">
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_106811f2aac664" />
            ) : (
              <GeneratedText id="m_16f4ae27da8dbb" />
            )
          }
        />
      </Button>
      <GeneratedValue
        value={
          canPin ? (
            <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                <GeneratedText id="m_0cc4443595b87e" />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_1dadff0d2c2898" />
              </p>
              <PinFormButton templateId={templateId} pinned={pinned} />
            </div>
          ) : null
        }
      />
    </div>
  )
}

function AssignmentsPanel({ templateId }: { templateId: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        <GeneratedText id="m_0976c514f311fb" />{' '}
        <span className="font-medium text-slate-700">
          <GeneratedText id="m_096d47f60747b3" />
        </span>{' '}
        <GeneratedText id="m_1bac81ba078d96" />
      </p>
      <Link
        href={`/compliance/obligations?drawer=new&kind=form&formTemplateId=${templateId}`}
        className="block"
      >
        <Button className="w-full">
          <Send size={14} /> <GeneratedText id="m_0b60657b166b0e" />
        </Button>
      </Link>
      <Link href="/compliance/obligations" className="block">
        <Button variant="outline" className="w-full">
          <GeneratedText id="m_0c528a939be441" />
        </Button>
      </Link>
      <p className="text-[11px] text-slate-400">
        <GeneratedText id="m_0ad38d3d51d13e" />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0af1983403d12e')))
        return
      }
      toast.success(tGenerated('m_1e42ea374d7063'))
    })
  const restricted = sel.size > 0
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        <GeneratedText id="m_14c557ff352d60" />
      </p>
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          restricted
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}
      >
        <GeneratedValue
          value={
            restricted ? (
              <GeneratedText
                id="m_1f688129a274f7"
                values={{ value0: sel.size, value1: sel.size === 1 ? '' : 's' }}
              />
            ) : (
              <GeneratedText id="m_1452f24ba8370a" />
            )
          }
        />
      </div>
      <GeneratedValue
        value={
          roles.length === 0 ? (
            <p className="text-xs text-slate-400">
              <GeneratedText id="m_008f5a3d7812ab" />
            </p>
          ) : (
            <ul className="space-y-1">
              <GeneratedValue
                value={roles.map((r) => (
                  <li key={r.key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={sel.has(r.key)}
                        onChange={() => toggle(r.key)}
                      />
                      <span className="flex-1">
                        <GeneratedValue value={r.name} />
                      </span>
                      <span className="text-[10px] text-slate-400">
                        <GeneratedValue value={r.key} />
                      </span>
                    </label>
                  </li>
                ))}
              />
            </ul>
          )
        }
      />
      <Button onClick={save} disabled={pending} className="w-full">
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_106811f2aac664" />
            ) : (
              <GeneratedText id="m_044b4d57bb99ce" />
            )
          }
        />
      </Button>
    </div>
  )
}
