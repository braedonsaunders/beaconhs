'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Vehicle log workspace — the legacy Beacon truck log rebuilt for speed.
// Column layout matches the legacy app exactly, one input per column:
//   Odometer mode:    Date | Odometer start | end | Personal | Total
//   Destination mode: Date | Customer/site | Other destination | Business | Personal | Total
// Everything autosaves on blur/select, Enter jumps to the same field on the
// next day, and an empty odometer Start carries forward from the previous
// day's End. Desktop gets a dense spreadsheet grid; below `md` each day is a
// large-touch-target card so the log is fast to fill on a phone in the truck.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Mail,
  Play,
  Send,
  Settings2,
  Trash2,
  WandSparkles,
  Zap,
} from 'lucide-react'
import { Badge, Button, Popover, Select, cn } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { useReseededState } from '@/lib/use-reseeded-state'
import type {
  ApplyVehicleLogImportInput,
  ApplyVehicleLogImportResult,
  SaveVehicleLogEntryInput,
  VehicleLogEntryDraft,
  VehicleLogMode,
  VehicleLogWorkspace,
} from './_service'

type SaveAction = (
  input: SaveVehicleLogEntryInput,
) => Promise<{ ok: true; entry: VehicleLogEntryDraft } | { ok: false; error: string }>
type ApplyAction = (
  input: ApplyVehicleLogImportInput,
) => Promise<{ ok: true; result: ApplyVehicleLogImportResult } | { ok: false; error: string }>
type DeleteMonthAction = (
  input: ApplyVehicleLogImportInput,
) => Promise<{ ok: true; deleted: number } | { ok: false; error: string }>

/** A manual-trigger Flow surfaced as a toolbar button (authored in /flows). */
export type VehicleLogRecordAction = {
  flowId: string
  buttonId: string
  label: string
  icon?: string
  variant?: 'default' | 'outline' | 'destructive' | 'secondary'
  confirm?: string
  order: number
}

type RunFlowAction = (input: {
  entryId: string
  flowId: string
  buttonId: string
}) => Promise<{ ok: boolean; ran?: string[]; failed?: string[]; error?: string }>

// Small lucide subset authorable on manual flow buttons (mirrors Builder).
const ACTION_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  bell: Bell,
  'file-text': FileText,
  mail: Mail,
  play: Play,
  send: Send,
  zap: Zap,
}

type RowState = 'idle' | 'saving' | 'saved' | 'error'

const MODES: { value: VehicleLogMode; label: string }[] = [
  { value: 'destination', label: 'Destination' },
  { value: 'odometer', label: 'Odometer' },
]

function numberValue(value: number | null | undefined) {
  return value == null ? '' : String(value)
}

function parseKmInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) ? Math.min(Math.trunc(n), 99_999_999) : null
}

function cloneDraft(entry: VehicleLogEntryDraft, mode: VehicleLogMode): VehicleLogEntryDraft {
  return { ...entry, entryMode: mode }
}

function hasMeaningfulDraft(entry: VehicleLogEntryDraft) {
  return Boolean(
    entry.siteOrgUnitId ||
    entry.otherDestination ||
    entry.hoursOnSite ||
    entry.manpowerCount != null ||
    entry.notes ||
    entry.startOdometer != null ||
    entry.endOdometer != null ||
    entry.businessKm != null ||
    entry.personalKm != null,
  )
}

// Only the fields this grid edits — used for the dirty check so tabbing
// through untouched rows never fires a save (and never rewrites entry_mode).
function serializeDraft(entry: VehicleLogEntryDraft) {
  return JSON.stringify([
    entry.startOdometer,
    entry.endOdometer,
    entry.businessKm,
    entry.personalKm,
    entry.siteOrgUnitId ?? null,
    entry.otherDestination?.trim() || null,
  ])
}

type DraftSnapshot = {
  workspace: VehicleLogWorkspace
  scopeKey: string
  drafts: Record<string, VehicleLogEntryDraft>
  saved: Record<string, string>
}

function vehicleLogScopeKey(workspace: VehicleLogWorkspace) {
  return `${workspace.month.key}:${workspace.selectedDriverId}:${workspace.selectedEquipmentId}:${workspace.mode}`
}

function reconcileDrafts(
  previous: DraftSnapshot | null,
  workspace: VehicleLogWorkspace,
): DraftSnapshot {
  const scopeKey = vehicleLogScopeKey(workspace)
  const scopeChanged = previous?.scopeKey !== scopeKey
  const current = scopeChanged ? {} : (previous?.drafts ?? {})
  const saved = scopeChanged ? {} : { ...(previous?.saved ?? {}) }
  const drafts: Record<string, VehicleLogEntryDraft> = {}

  for (const row of workspace.rows) {
    const existing = current[row.date]
    const dirty = existing && serializeDraft(existing) !== saved[row.date]
    if (existing && dirty) {
      drafts[row.date] = existing
    } else {
      drafts[row.date] = cloneDraft(row.entry, workspace.mode)
      saved[row.date] = serializeDraft(row.entry)
    }
  }

  return { workspace, scopeKey, drafts, saved }
}

// A blank odometer Start inherits the previous day's End at save time, so a
// driver only ever types today's ending odometer.
function withCarriedStart(
  draft: VehicleLogEntryDraft,
  mode: VehicleLogMode,
  prevEnd: number | null,
): VehicleLogEntryDraft {
  if (
    mode === 'odometer' &&
    draft.endOdometer != null &&
    draft.startOdometer == null &&
    prevEnd != null
  ) {
    return { ...draft, startOdometer: prevEnd }
  }
  return draft
}

// End odometer below the start it follows (typed or carried) — flag it red.
function endBelowStart(draft: VehicleLogEntryDraft, prevEnd: number | null): boolean {
  if (draft.endOdometer == null) return false
  const start = draft.startOdometer ?? prevEnd
  return start != null && draft.endOdometer < start
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`
}

function formatKm(value: number) {
  return value.toLocaleString()
}

// --- Grid cells -------------------------------------------------------------

const desktopCellClass = cn(
  'h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors',
  'hover:border-slate-200 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20',
  'dark:hover:border-slate-700 dark:focus:border-teal-500 dark:focus:bg-slate-950',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'placeholder:text-slate-300 dark:placeholder:text-slate-600',
)

const mobileCellClass = cn(
  // 16px text — anything smaller makes iOS Safari zoom on focus.
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base shadow-sm outline-none transition-colors',
  'focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25',
  'dark:border-slate-700 dark:bg-slate-900',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'placeholder:text-slate-300 dark:placeholder:text-slate-600',
)

function onCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const el = e.currentTarget
  const grid = el.closest('[data-vlog-grid]')
  const next = grid?.querySelector<HTMLInputElement>(
    `[data-nav="${el.dataset.nav}"][data-idx="${Number(el.dataset.idx) + 1}"]`,
  )
  if (next) {
    next.focus()
    next.select()
  } else {
    el.blur()
  }
}

function KmInput({
  value,
  onValue,
  onSave,
  nav,
  idx,
  disabled,
  placeholder,
  mobile = false,
  invalid = false,
  title,
  className,
}: {
  value: number | null
  onValue: (value: number | null) => void
  onSave: () => void
  nav: string
  idx: number
  disabled: boolean
  placeholder?: string
  mobile?: boolean
  /** Renders the value red — e.g. an End odometer below the Start it follows. */
  invalid?: boolean
  title?: string
  className?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="next"
      value={numberValue(value)}
      placeholder={tGeneratedValue(placeholder)}
      disabled={disabled}
      data-nav={nav}
      data-idx={idx}
      aria-invalid={invalid || undefined}
      title={tGeneratedValue(invalid ? title : undefined)}
      onChange={(e) => onValue(parseKmInput(e.currentTarget.value))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={onSave}
      onKeyDown={onCellKeyDown}
      className={cn(
        mobile ? mobileCellClass : desktopCellClass,
        'text-right tabular-nums',
        invalid &&
          'border-red-300 text-red-600 focus:border-red-500 focus:ring-red-500/20 dark:border-red-900 dark:text-red-400',
        className,
      )}
    />
  )
}

function TextCell({
  value,
  onValue,
  onSave,
  nav,
  idx,
  disabled,
  placeholder,
  mobile = false,
}: {
  value: string
  onValue: (value: string) => void
  onSave: () => void
  nav: string
  idx: number
  disabled: boolean
  placeholder?: string
  mobile?: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <input
      type="text"
      autoComplete="off"
      enterKeyHint="next"
      value={value}
      placeholder={tGeneratedValue(placeholder)}
      disabled={disabled}
      data-nav={nav}
      data-idx={idx}
      onChange={(e) => onValue(e.currentTarget.value)}
      onBlur={onSave}
      onKeyDown={onCellKeyDown}
      className={mobile ? mobileCellClass : cn(desktopCellClass, 'text-left')}
    />
  )
}

function RowStatus({
  state,
  importStatus,
}: {
  state: RowState
  importStatus: VehicleLogEntryDraft['importStatus']
}) {
  const tGenerated = useGeneratedTranslations()
  if (state === 'saving') return <Loader2 size={12} className="animate-spin text-slate-400" />
  if (state === 'saved') return <Check size={13} className="text-teal-600" />
  if (state === 'error') return <AlertTriangle size={13} className="text-red-600" />
  if (importStatus === 'imported')
    return (
      <span
        title={tGenerated('m_085dfb867cb530')}
        className="h-1.5 w-1.5 rounded-full bg-teal-500"
      />
    )
  if (importStatus === 'suggested')
    return (
      <span
        title={tGenerated('m_0b413830a0abe4')}
        className="h-1.5 w-1.5 rounded-full bg-amber-400"
      />
    )
  if (importStatus === 'conflict')
    return (
      <span
        title={tGenerated('m_18b5e974e9f9b8')}
        className="h-1.5 w-1.5 rounded-full bg-red-500"
      />
    )
  return null
}

// --- Workspace ---------------------------------------------------------------

export function VehicleLogWorkspaceClient({
  workspace,
  canManage,
  saveAction,
  applyAction,
  deleteMonthAction,
  recordActions,
  actionEntryId,
  runAction,
}: {
  workspace: VehicleLogWorkspace
  /** equipment.manage — read-tier viewers get a read-only grid. */
  canManage: boolean
  saveAction: SaveAction
  applyAction: ApplyAction
  deleteMonthAction: DeleteMonthAction
  /** Manual-trigger flow buttons for the viewed month (already permission-filtered). */
  recordActions: VehicleLogRecordAction[]
  /** The month's latest saved entry — the anchor record manual flows run on. */
  actionEntryId: string | null
  runAction: RunFlowAction
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const scopeKey = vehicleLogScopeKey(workspace)
  const [draftSnapshot, setDraftSnapshot] = useState(() => reconcileDrafts(null, workspace))
  const currentDraftSnapshot =
    draftSnapshot.workspace === workspace
      ? draftSnapshot
      : reconcileDrafts(draftSnapshot, workspace)
  const drafts = currentDraftSnapshot.drafts
  const [rowStates, setRowStates] = useReseededState<Record<string, RowState>>(scopeKey, {})
  const [rowErrors, setRowErrors] = useReseededState<Record<string, string>>(scopeKey, {})
  const [actionResult, setActionResult] = useReseededState<string | null>(scopeKey, null)
  const [importPickerOpen, setImportPickerOpen] = useReseededState(scopeKey, false)
  const importSources = workspace.importSources.sources
  const importableSources = importSources.filter((source) => source.active)
  const [selectedImportSourceChoice, setSelectedImportSourceId] = useState('')
  const selectedImportSourceId = importSources.some(
    (source) => source.id === selectedImportSourceChoice && source.active,
  )
    ? selectedImportSourceChoice
    : (importableSources[0]?.id ?? importSources[0]?.id ?? '')

  const savedTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  function setDrafts(
    update:
      | Record<string, VehicleLogEntryDraft>
      | ((current: Record<string, VehicleLogEntryDraft>) => Record<string, VehicleLogEntryDraft>),
  ) {
    setDraftSnapshot((current) => {
      const base = current.workspace === workspace ? current : reconcileDrafts(current, workspace)
      return {
        ...base,
        drafts: typeof update === 'function' ? update(base.drafts) : update,
      }
    })
  }

  useEffect(() => {
    const timers = savedTimersRef.current
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer)
    }
  }, [])

  const activeDriver = workspace.drivers.find((d) => d.id === workspace.selectedDriverId)
  const activeVehicle = workspace.vehicles.find((v) => v.id === workspace.selectedEquipmentId)
  const modeOptions = MODES.filter((m) => workspace.modeOptions.includes(m.value))

  const baseParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('month', workspace.month.key)
    if (workspace.selectedDriverId) params.set('driver', workspace.selectedDriverId)
    if (workspace.selectedEquipmentId) params.set('vehicle', workspace.selectedEquipmentId)
    params.set('mode', workspace.mode)
    return params
  }, [workspace])

  function navigate(next: Partial<Record<'month' | 'driver' | 'vehicle' | 'mode', string>>) {
    const params = new URLSearchParams(baseParams)
    // Switching drivers drops the explicit mode so the new driver lands on
    // their own default (per-person override, then the tenant default).
    if (next.driver !== undefined && next.mode === undefined) params.delete('mode')
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/equipment/vehicle-log?${params.toString()}`)
  }

  // Per-row derived values (odometer carry-forward chain) + live month totals
  // that track every keystroke, like the legacy total row did.
  const computed = useMemo(() => {
    const rows: Record<string, { prevEnd: number | null; total: number | null }> = {}
    let lastEnd: number | null = null
    let business = 0
    let personal = 0
    let grand = 0
    let logged = 0
    for (const row of workspace.rows) {
      const draft = drafts[row.date] ?? row.entry
      const prevEnd = lastEnd
      let total: number | null = null
      if (workspace.mode === 'odometer') {
        const start = draft.startOdometer ?? (draft.endOdometer != null ? prevEnd : null)
        if (draft.endOdometer != null && start != null && draft.endOdometer >= start) {
          total = draft.endOdometer - start
        }
      } else if (draft.businessKm != null || draft.personalKm != null) {
        total = (draft.businessKm ?? 0) + (draft.personalKm ?? 0)
      }
      rows[row.date] = { prevEnd, total }
      if (draft.endOdometer != null) lastEnd = draft.endOdometer
      business += draft.businessKm ?? 0
      personal += draft.personalKm ?? 0
      grand += total ?? 0
      if (draft.id || hasMeaningfulDraft(draft)) logged += 1
    }
    return { rows, business, personal, grand, logged }
  }, [drafts, workspace.rows, workspace.mode])

  const canEdit = canManage && Boolean(workspace.selectedDriverId && workspace.selectedEquipmentId)

  function updateDraft(date: string, patch: Partial<VehicleLogEntryDraft>) {
    setDrafts((current) => {
      const base = current[date] ?? workspace.rows.find((r) => r.date === date)?.entry
      if (!base) return current
      return { ...current, [date]: { ...base, ...patch } }
    })
  }

  function markRowState(date: string, state: RowState) {
    setRowStates((s) => ({ ...s, [date]: state }))
    if (savedTimersRef.current[date]) clearTimeout(savedTimersRef.current[date])
    if (state === 'saved') {
      savedTimersRef.current[date] = setTimeout(() => {
        setRowStates((s) => (s[date] === 'saved' ? { ...s, [date]: 'idle' } : s))
      }, 1600)
    }
  }

  async function saveRow(date: string, override?: VehicleLogEntryDraft) {
    if (!canEdit) return
    const base = override ?? drafts[date]
    if (!base) return
    const draft = withCarriedStart(base, workspace.mode, computed.rows[date]?.prevEnd ?? null)
    if (!draft.id && !hasMeaningfulDraft(draft)) return
    if (serializeDraft(draft) === currentDraftSnapshot.saved[date]) return
    markRowState(date, 'saving')
    setRowErrors((s) => ({ ...s, [date]: '' }))
    const res = await saveAction({
      equipmentItemId: workspace.selectedEquipmentId,
      driverPersonId: workspace.selectedDriverId,
      entryDate: date,
      entryMode: workspace.mode,
      startOdometer: draft.startOdometer,
      endOdometer: draft.endOdometer,
      businessKm: draft.businessKm,
      personalKm: draft.personalKm,
      siteOrgUnitId: draft.siteOrgUnitId,
      otherDestination: draft.otherDestination,
      hoursOnSite: draft.hoursOnSite,
      manpowerCount: draft.manpowerCount,
      notes: draft.notes,
    })
    if (res.ok) {
      setDraftSnapshot((current) => {
        const base = current.workspace === workspace ? current : reconcileDrafts(current, workspace)
        return {
          ...base,
          drafts: { ...base.drafts, [date]: cloneDraft(res.entry, workspace.mode) },
          saved: { ...base.saved, [date]: serializeDraft(res.entry) },
        }
      })
      markRowState(date, 'saved')
      router.refresh()
    } else {
      markRowState(date, 'error')
      setRowErrors((s) => ({ ...s, [date]: res.error }))
    }
  }

  // For selects: apply the patch and save in one step so the save never reads
  // a stale draft from state.
  function updateAndSave(date: string, patch: Partial<VehicleLogEntryDraft>) {
    const base = drafts[date] ?? workspace.rows.find((r) => r.date === date)?.entry
    if (!base) return
    const next = { ...base, ...patch }
    setDrafts((current) => ({ ...current, [date]: next }))
    void saveRow(date, next)
  }

  function applyActivity(sourceConnectionId?: string | null) {
    if (!canManage) return
    if (!workspace.selectedDriverId || !workspace.selectedEquipmentId) {
      setActionResult('Choose a driver and vehicle first.')
      return
    }
    const sourceId =
      sourceConnectionId ||
      selectedImportSourceId ||
      (importableSources.length === 1 ? importableSources[0]?.id : null)
    const source = workspace.importSources.sources.find((candidate) => candidate.id === sourceId)
    if (!source || !source.active) {
      setImportPickerOpen(workspace.importSources.sources.length > 1)
      setActionResult(source ? `${source.name} is not ready to import.` : importHint)
      return
    }
    setActionResult(null)
    startTransition(async () => {
      const res = await applyAction({
        equipmentItemId: workspace.selectedEquipmentId,
        driverPersonId: workspace.selectedDriverId,
        month: workspace.month.key,
        sourceConnectionId: source.id,
      })
      if (res.ok) {
        const { created, updated, skipped, pulled, resolved } = res.result
        const changed = created + updated
        setActionResult(
          changed === 0
            ? `${source.name}: pulled ${pulled}, applied 0.`
            : `${source.name}: pulled ${pulled} · resolved ${resolved} · ${created} added · ${updated} refreshed${
                skipped ? ` · ${skipped} skipped` : ''
              }`,
        )
        setImportPickerOpen(false)
        router.refresh()
      } else {
        setActionResult(res.error)
      }
    })
  }

  async function runFlowButton(action: VehicleLogRecordAction) {
    if (!actionEntryId) return
    if (action.confirm && !(await confirmDialog(action.confirm))) return
    setActionResult(null)
    startTransition(async () => {
      const res = await runAction({
        entryId: actionEntryId,
        flowId: action.flowId,
        buttonId: action.buttonId,
      })
      if (res.ok) {
        setActionResult(
          res.failed?.length
            ? `${action.label}: issues ${res.failed.join(', ')}`
            : `${action.label}: done`,
        )
        router.refresh()
      } else {
        setActionResult(res.error ?? 'Action failed')
      }
    })
  }

  async function deleteMonth() {
    if (!canEdit) return
    const label = `${activeDriver?.label ?? 'driver'} / ${activeVehicle?.hint ?? activeVehicle?.label}`
    if (
      !(await confirmDialog({
        message: `Delete ${workspace.month.label} entries for ${label}?`,
        tone: 'danger',
      }))
    )
      return
    setActionResult(null)
    startTransition(async () => {
      const res = await deleteMonthAction({
        equipmentItemId: workspace.selectedEquipmentId,
        driverPersonId: workspace.selectedDriverId,
        month: workspace.month.key,
      })
      if (res.ok) {
        setActionResult(`${res.deleted} deleted`)
        router.refresh()
      } else {
        setActionResult(res.error)
      }
    })
  }

  const selectedImportSource =
    importSources.find((source) => source.id === selectedImportSourceId) ?? importableSources[0]
  const hasActiveSource = workspace.importSources.activeSourceCount > 0
  const matchedImportDays = workspace.totals.importSourceDays
  const importHint = !workspace.selectedDriverId
    ? 'Choose a driver first.'
    : !workspace.selectedEquipmentId
      ? 'Choose a vehicle first.'
      : !hasActiveSource
        ? 'No vehicle log import source is configured.'
        : importableSources.length > 1
          ? 'Choose an import source.'
          : selectedImportSource
            ? `${selectedImportSource.name}: pulls ${workspace.month.label} on demand.`
            : 'No import source is ready.'
  const canImport = canEdit && importableSources.length > 0 && !pending
  const hasSourcePicker = importSources.length > 1
  const canOpenSourcePicker = canEdit && hasSourcePicker && !pending
  const importButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        if (hasSourcePicker) setImportPickerOpen((open) => !open)
        else void applyActivity(importableSources[0]?.id)
      }}
      disabled={hasSourcePicker ? !canOpenSourcePicker : !canImport}
      title={tGeneratedValue(importHint)}
      aria-expanded={hasSourcePicker ? importPickerOpen : undefined}
      aria-haspopup={hasSourcePicker ? 'dialog' : undefined}
    >
      <GeneratedValue
        value={
          pending ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />
        }
      />
      <GeneratedText id="m_0df79ee8347c6b" />
      <GeneratedValue value={hasSourcePicker ? <ChevronDown size={13} /> : null} />
    </Button>
  )
  const emptyMessage =
    workspace.drivers.length === 0 || workspace.vehicles.length === 0
      ? 'Add an active driver and vehicle to start logging.'
      : 'Choose a driver and vehicle to start logging.'

  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const isOdometer = workspace.mode === 'odometer'
  const personalTint = 'bg-slate-100/60 dark:bg-slate-800/30'
  const colCount = isOdometer ? 5 : 6

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_auto_minmax(0,1fr)] dark:border-slate-800">
          <div className="space-y-1">
            <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <GeneratedText id="m_00385063252603" />
            </div>
            <Select
              value={workspace.selectedDriverId}
              onChange={(e) => navigate({ driver: e.currentTarget.value })}
              sheetTitle="Driver"
              searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
            >
              <option value="">{'Choose driver'}</option>
              {workspace.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.label}
                  {driver.hint ? ` · ${driver.hint}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <GeneratedText id="m_1b0bc0895e7f8b" />
            </div>
            <Select
              value={workspace.selectedEquipmentId}
              onChange={(e) => navigate({ vehicle: e.currentTarget.value })}
              sheetTitle="Vehicle"
              searchPlaceholder={tGenerated('m_0bf444b94a202f')}
            >
              <option value="">{'Choose vehicle'}</option>
              {workspace.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.hint ? `${vehicle.hint} · ` : ''}
                  {vehicle.label}
                </option>
              ))}
            </Select>
          </div>
          <GeneratedValue
            value={
              modeOptions.length > 1 ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    <GeneratedText id="m_062c25718595e2" />
                  </div>
                  <div className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
                    <GeneratedValue
                      value={modeOptions.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => navigate({ mode: mode.value })}
                          className={cn(
                            'h-8 rounded-md px-3 text-sm font-medium transition-colors',
                            workspace.mode === mode.value
                              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                          )}
                        >
                          <GeneratedValue value={mode.label} />
                        </button>
                      ))}
                    />
                  </div>
                </div>
              ) : null
            }
          />
          <div className="flex flex-wrap items-end justify-start gap-2 lg:justify-end">
            <GeneratedValue
              value={recordActions.map((action) => {
                const Icon = action.icon ? ACTION_ICONS[action.icon] : undefined
                return (
                  <Button
                    key={`${action.flowId}:${action.buttonId}`}
                    type="button"
                    variant={action.variant ?? 'outline'}
                    size="sm"
                    onClick={() => runFlowButton(action)}
                    disabled={!actionEntryId || pending}
                  >
                    <GeneratedValue value={Icon ? <Icon size={14} /> : <Zap size={14} />} />
                    <GeneratedValue value={action.label} />
                  </Button>
                )
              })}
            />
            <GeneratedValue
              value={
                workspace.selectedDriverId && workspace.selectedEquipmentId ? (
                  <a
                    href={`/equipment/vehicle-log/pdf?${baseParams.toString()}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800/60"
                  >
                    <FileText size={14} />
                    <GeneratedText id="m_1a2b2ed6729166" />
                  </a>
                ) : null
              }
            />
            <GeneratedValue
              value={
                !canManage ? null : hasSourcePicker ? (
                  <Popover
                    open={importPickerOpen}
                    onOpenChange={setImportPickerOpen}
                    align="end"
                    className="w-80"
                    trigger={importButton}
                  >
                    <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        <GeneratedText id="m_125dd9cb476a8d" />
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_1eb189846ecd53" />
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                      <GeneratedValue
                        value={importSources.map((source) => {
                          const disabled = !source.active
                          const selected = selectedImportSource?.id === source.id
                          return (
                            <button
                              key={source.id}
                              type="button"
                              disabled={disabled}
                              onClick={() => setSelectedImportSourceId(source.id)}
                              className={cn(
                                'flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors',
                                selected
                                  ? 'bg-teal-50 text-teal-900 dark:bg-teal-950/30 dark:text-teal-100'
                                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60',
                                disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">
                                  <GeneratedValue value={source.name} />
                                </span>
                                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedValue value={source.connectorLabel} /> ·{' '}
                                  <GeneratedValue value={source.status} />
                                </span>
                                <span className="mt-0.5 block text-[11px] text-slate-400">
                                  <GeneratedValue
                                    value={
                                      source.description || (
                                        <GeneratedText
                                          id="m_02cc521ca76fb8"
                                          values={{ value0: workspace.month.label }}
                                        />
                                      )
                                    }
                                  />
                                </span>
                              </span>
                              <Badge variant="secondary">
                                <GeneratedText id="m_17d18603d1b603" />
                              </Badge>
                            </button>
                          )
                        })}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                      <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            selectedImportSource?.name ?? <GeneratedText id="m_0b247fa46434fc" />
                          }
                        />
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void applyActivity(selectedImportSource?.id)}
                        disabled={!selectedImportSource || !selectedImportSource.active || pending}
                      >
                        <GeneratedText id="m_0df79ee8347c6b" />
                      </Button>
                    </div>
                  </Popover>
                ) : (
                  importButton
                )
              }
            />
            <GeneratedValue
              value={
                canManage && workspace.importSources.canConfigureSources && !hasActiveSource ? (
                  <Link
                    href="/admin/integrations"
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800/60"
                  >
                    <Settings2 size={14} />
                    <GeneratedText id="m_01ffac03eed326" />
                  </Link>
                ) : null
              }
            />
            <GeneratedValue
              value={
                canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={deleteMonth}
                    disabled={!canEdit || pending}
                  >
                    <Trash2 size={14} />
                    <GeneratedText id="m_130de04b13f624" />
                  </Button>
                ) : null
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={tGenerated('m_17404e648473bd')}
              onClick={() => navigate({ month: workspace.month.previousKey })}
            >
              <ChevronLeft size={14} />
            </Button>
            <div className="flex h-8 min-w-40 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              <CalendarDays size={14} />
              <GeneratedValue value={workspace.month.label} />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={tGenerated('m_17ae862fdd8d6e')}
              onClick={() => navigate({ month: workspace.month.nextKey })}
            >
              <ChevronRight size={14} />
            </Button>
            <GeneratedValue
              value={
                workspace.month.key !== currentMonthKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate({ month: currentMonthKey })}
                  >
                    <GeneratedText id="m_11542ea506a7f5" />
                  </Button>
                ) : null
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              <GeneratedValue value={plural(computed.logged, 'day')} />{' '}
              <GeneratedText id="m_07d6406a0fddce" />
            </Badge>
            <Badge variant="outline">
              <GeneratedValue value={formatKm(computed.grand)} />{' '}
              <GeneratedText id="m_052eec8e5ae8ca" />
            </Badge>
            <GeneratedValue
              value={
                matchedImportDays > 0 ? (
                  <Badge variant="secondary">
                    <GeneratedValue value={plural(matchedImportDays, 'imported day')} />
                  </Badge>
                ) : null
              }
            />
            <GeneratedValue
              value={
                actionResult ? (
                  <span className="text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={actionResult} />
                  </span>
                ) : canManage && !canImport ? (
                  <span className="text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={importHint} />
                  </span>
                ) : null
              }
            />
          </div>
        </div>
      </div>

      <GeneratedValue
        value={
          workspace.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <GeneratedValue value={emptyMessage} />
            </div>
          ) : (
            <>
              {/* Desktop: dense spreadsheet grid, legacy column layout. */}
              <div
                data-vlog-grid
                className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block dark:border-slate-800 dark:bg-slate-900"
              >
                <table
                  className={cn(
                    'w-full border-collapse text-sm',
                    isOdometer ? 'min-w-[560px]' : 'min-w-[760px]',
                  )}
                >
                  <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase dark:bg-slate-950 dark:text-slate-400">
                    <GeneratedValue
                      value={
                        isOdometer ? (
                          <>
                            <tr>
                              <th rowSpan={2} className="w-24 px-3 py-2 text-left font-medium">
                                <GeneratedText id="m_0285c38761c540" />
                              </th>
                              <th
                                colSpan={2}
                                className="border-b border-slate-200/70 px-2 pt-2 pb-1 text-center font-semibold dark:border-slate-800"
                              >
                                <GeneratedText id="m_1813babf2bffab" />
                              </th>
                              <th
                                rowSpan={2}
                                className={cn(
                                  'w-32 px-2 py-2 text-right font-medium',
                                  personalTint,
                                )}
                              >
                                <GeneratedText id="m_129f7534dde503" />
                              </th>
                              <th rowSpan={2} className="w-28 px-3 py-2 text-right font-medium">
                                <GeneratedText id="m_037751db52c978" />
                              </th>
                            </tr>
                            <tr>
                              <th className="w-36 px-2 pt-1 pb-2 text-right font-medium">
                                <GeneratedText id="m_144de7fabb13dc" />
                              </th>
                              <th className="w-36 px-2 pt-1 pb-2 text-right font-medium">
                                <GeneratedText id="m_0459a16054e623" />
                              </th>
                            </tr>
                          </>
                        ) : (
                          <>
                            <tr>
                              <th rowSpan={2} className="w-24 px-3 py-2 text-left font-medium">
                                <GeneratedText id="m_0285c38761c540" />
                              </th>
                              <th
                                colSpan={3}
                                className="border-b border-slate-200/70 px-2 pt-2 pb-1 text-center font-semibold dark:border-slate-800"
                              >
                                <GeneratedText id="m_1b346fbac4521e" />
                              </th>
                              <th
                                rowSpan={2}
                                className={cn(
                                  'w-32 px-2 py-2 text-right font-medium',
                                  personalTint,
                                )}
                              >
                                <GeneratedText id="m_129f7534dde503" />
                              </th>
                              <th rowSpan={2} className="w-28 px-3 py-2 text-right font-medium">
                                <GeneratedText id="m_037751db52c978" />
                              </th>
                            </tr>
                            <tr>
                              <th className="px-2 pt-1 pb-2 text-left font-medium">
                                <GeneratedText id="m_09ec32e549824e" />
                              </th>
                              <th className="w-52 px-2 pt-1 pb-2 text-left font-medium">
                                <GeneratedText id="m_1e9064554bf894" />
                              </th>
                              <th className="w-28 px-2 pt-1 pb-2 text-right font-medium">
                                <GeneratedText id="m_0113080e78fdc5" />
                              </th>
                            </tr>
                          </>
                        )
                      }
                    />
                  </thead>
                  <tbody>
                    <GeneratedValue
                      value={workspace.rows.map((row, index) => {
                        const draft = drafts[row.date] ?? cloneDraft(row.entry, workspace.mode)
                        const state = rowStates[row.date] ?? 'idle'
                        const derived = computed.rows[row.date]
                        const total = derived?.total ?? null
                        const error = rowErrors[row.date]
                        return (
                          <VehicleLogTableRow
                            key={row.date}
                            row={row}
                            draft={draft}
                            state={state}
                            error={error}
                            total={total}
                            prevEnd={derived?.prevEnd ?? null}
                            index={index}
                            mode={workspace.mode}
                            sites={workspace.sites}
                            canEdit={canEdit}
                            colCount={colCount}
                            personalTint={personalTint}
                            updateDraft={updateDraft}
                            updateAndSave={updateAndSave}
                            saveRow={saveRow}
                          />
                        )
                      })}
                    />
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold dark:border-slate-800 dark:bg-slate-950">
                    <tr>
                      <GeneratedValue
                        value={
                          isOdometer ? (
                            <td
                              colSpan={3}
                              className="px-3 py-2.5 text-right text-[11px] tracking-wide text-slate-500 uppercase dark:text-slate-400"
                            >
                              <GeneratedText id="m_07f605af5a8c18" />
                            </td>
                          ) : (
                            <>
                              <td
                                colSpan={3}
                                className="px-3 py-2.5 text-right text-[11px] tracking-wide text-slate-500 uppercase dark:text-slate-400"
                              >
                                <GeneratedText id="m_07f605af5a8c18" />
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums">
                                <GeneratedValue value={formatKm(computed.business)} />
                              </td>
                            </>
                          )
                        }
                      />
                      <td className={cn('px-2 py-2.5 text-right tabular-nums', personalTint)}>
                        <GeneratedValue value={formatKm(computed.personal)} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <GeneratedValue value={formatKm(computed.grand)} />{' '}
                        <GeneratedText id="m_052eec8e5ae8ca" />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Mobile: one card per day, large touch targets. */}
              <div data-vlog-grid className="space-y-2 md:hidden">
                <GeneratedValue
                  value={workspace.rows.map((row, index) => {
                    const draft = drafts[row.date] ?? cloneDraft(row.entry, workspace.mode)
                    const state = rowStates[row.date] ?? 'idle'
                    const derived = computed.rows[row.date]
                    const total = derived?.total ?? null
                    const error = rowErrors[row.date]
                    return (
                      <div
                        key={row.date}
                        className={cn(
                          'rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900',
                          row.isWeekend && 'border-slate-200/70 bg-slate-50 dark:bg-slate-950',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                              <GeneratedValue value={row.day} />
                            </span>
                            <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
                              <GeneratedValue value={row.weekday} />
                            </span>
                            <RowStatus state={state} importStatus={draft.importStatus} />
                          </div>
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums',
                              total != null
                                ? 'text-slate-800 dark:text-slate-100'
                                : 'text-slate-300 dark:text-slate-600',
                            )}
                          >
                            <GeneratedValue
                              value={
                                total != null ? (
                                  <GeneratedText
                                    id="m_18b955084b2153"
                                    values={{ value0: formatKm(total) }}
                                  />
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </span>
                        </div>
                        <GeneratedValue
                          value={
                            isOdometer ? (
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <MobileField label={tGenerated('m_144de7fabb13dc')}>
                                  <KmInput
                                    value={draft.startOdometer}
                                    onValue={(v) => updateDraft(row.date, { startOdometer: v })}
                                    onSave={() => void saveRow(row.date)}
                                    nav="start"
                                    idx={index}
                                    disabled={!canEdit}
                                    placeholder={tGeneratedValue(
                                      numberValue(derived?.prevEnd ?? null),
                                    )}
                                    mobile
                                  />
                                </MobileField>
                                <MobileField label={tGenerated('m_0459a16054e623')}>
                                  <KmInput
                                    value={draft.endOdometer}
                                    onValue={(v) => updateDraft(row.date, { endOdometer: v })}
                                    onSave={() => void saveRow(row.date)}
                                    nav="end"
                                    idx={index}
                                    disabled={!canEdit}
                                    invalid={endBelowStart(draft, derived?.prevEnd ?? null)}
                                    title={tGenerated('m_050a89c0ade550')}
                                    mobile
                                  />
                                </MobileField>
                                <MobileField label={tGenerated('m_1b2eb1ab6d7edc')}>
                                  <KmInput
                                    value={draft.personalKm}
                                    onValue={(v) => updateDraft(row.date, { personalKm: v })}
                                    onSave={() => void saveRow(row.date)}
                                    nav="personal"
                                    idx={index}
                                    disabled={!canEdit}
                                    mobile
                                  />
                                </MobileField>
                              </div>
                            ) : (
                              <div className="mt-2 space-y-2">
                                <Select
                                  value={draft.siteOrgUnitId ?? ''}
                                  onChange={(e) =>
                                    updateAndSave(row.date, {
                                      siteOrgUnitId: e.currentTarget.value || null,
                                    })
                                  }
                                  disabled={!canEdit}
                                  sheetTitle="Customer / site"
                                  searchPlaceholder={tGenerated('m_1931aa93098220')}
                                  triggerClassName="h-11 text-base"
                                >
                                  <option value="">{'Customer / site'}</option>
                                  {workspace.sites.map((site) => (
                                    <option key={site.id} value={site.id}>
                                      {site.label}
                                    </option>
                                  ))}
                                </Select>
                                <TextCell
                                  value={draft.otherDestination ?? ''}
                                  onValue={(v) => updateDraft(row.date, { otherDestination: v })}
                                  onSave={() => void saveRow(row.date)}
                                  nav="other"
                                  idx={index}
                                  disabled={!canEdit}
                                  placeholder={tGenerated('m_1e9064554bf894')}
                                  mobile
                                />
                                <div className="grid grid-cols-2 gap-2">
                                  <MobileField label={tGenerated('m_195785a6f3a188')}>
                                    <KmInput
                                      value={draft.businessKm}
                                      onValue={(v) => updateDraft(row.date, { businessKm: v })}
                                      onSave={() => void saveRow(row.date)}
                                      nav="business"
                                      idx={index}
                                      disabled={!canEdit}
                                      mobile
                                    />
                                  </MobileField>
                                  <MobileField label={tGenerated('m_129f7534dde503')}>
                                    <KmInput
                                      value={draft.personalKm}
                                      onValue={(v) => updateDraft(row.date, { personalKm: v })}
                                      onSave={() => void saveRow(row.date)}
                                      nav="personal"
                                      idx={index}
                                      disabled={!canEdit}
                                      mobile
                                    />
                                  </MobileField>
                                </div>
                              </div>
                            )
                          }
                        />
                        <GeneratedValue
                          value={
                            error ? (
                              <p className="mt-1.5 text-xs text-red-600">
                                <GeneratedValue value={error} />
                              </p>
                            ) : null
                          }
                        />
                      </div>
                    )
                  })}
                />
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      <GeneratedText id="m_07f605af5a8c18" />
                    </span>
                    <span className="tabular-nums">
                      <GeneratedValue value={formatKm(computed.grand)} />{' '}
                      <GeneratedText id="m_052eec8e5ae8ca" />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedValue
                      value={
                        isOdometer ? (
                          <span>
                            <GeneratedText id="m_1b2eb1ab6d7edc" />{' '}
                            <GeneratedValue value={formatKm(computed.personal)} />{' '}
                            <GeneratedText id="m_052eec8e5ae8ca" />
                          </span>
                        ) : (
                          <span>
                            <GeneratedText id="m_1b346fbac4521e" />{' '}
                            <GeneratedValue value={formatKm(computed.business)} />{' '}
                            <GeneratedText id="m_16a5f986b41d8a" />
                            <GeneratedValue value={' '} />
                            <GeneratedValue value={formatKm(computed.personal)} />{' '}
                            <GeneratedText id="m_052eec8e5ae8ca" />
                          </span>
                        )
                      }
                    />
                    <span>
                      <GeneratedValue value={plural(computed.logged, 'day')} />{' '}
                      <GeneratedText id="m_07d6406a0fddce" />
                    </span>
                  </div>
                </div>
              </div>
            </>
          )
        }
      />
    </div>
  )
}

function MobileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </span>
      <GeneratedValue value={children} />
    </label>
  )
}

function VehicleLogTableRow({
  row,
  draft,
  state,
  error,
  total,
  prevEnd,
  index,
  mode,
  sites,
  canEdit,
  colCount,
  personalTint,
  updateDraft,
  updateAndSave,
  saveRow,
}: {
  row: VehicleLogWorkspace['rows'][number]
  draft: VehicleLogEntryDraft
  state: RowState
  error: string | undefined
  total: number | null
  prevEnd: number | null
  index: number
  mode: VehicleLogMode
  sites: VehicleLogWorkspace['sites']
  canEdit: boolean
  colCount: number
  personalTint: string
  updateDraft: (date: string, patch: Partial<VehicleLogEntryDraft>) => void
  updateAndSave: (date: string, patch: Partial<VehicleLogEntryDraft>) => void
  saveRow: (date: string) => Promise<void>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const endInvalid = endBelowStart(draft, prevEnd)
  return (
    <>
      <tr
        className={cn(
          'border-t border-slate-100 dark:border-slate-800',
          row.isWeekend && 'bg-slate-50/70 dark:bg-slate-950/40',
        )}
      >
        <td className="px-3 py-1">
          <div className="flex items-center gap-1.5">
            <span className="w-6 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
              <GeneratedValue value={row.day} />
            </span>
            <span className="w-8 text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
              <GeneratedValue value={row.weekday} />
            </span>
            <RowStatus state={state} importStatus={draft.importStatus} />
          </div>
        </td>
        <GeneratedValue
          value={
            mode === 'odometer' ? (
              <>
                <td className="px-1 py-1">
                  <KmInput
                    value={draft.startOdometer}
                    onValue={(v) => updateDraft(row.date, { startOdometer: v })}
                    onSave={() => void saveRow(row.date)}
                    nav="start"
                    idx={index}
                    disabled={!canEdit}
                    placeholder={tGeneratedValue(numberValue(prevEnd))}
                  />
                </td>
                <td className="px-1 py-1">
                  <KmInput
                    value={draft.endOdometer}
                    onValue={(v) => updateDraft(row.date, { endOdometer: v })}
                    onSave={() => void saveRow(row.date)}
                    nav="end"
                    idx={index}
                    disabled={!canEdit}
                    invalid={endInvalid}
                    title={tGenerated('m_050a89c0ade550')}
                  />
                </td>
              </>
            ) : (
              <>
                <td className="px-1 py-1">
                  <Select
                    value={draft.siteOrgUnitId ?? ''}
                    onChange={(e) =>
                      updateAndSave(row.date, { siteOrgUnitId: e.currentTarget.value || null })
                    }
                    disabled={!canEdit}
                    sheetTitle="Customer / site"
                    searchPlaceholder={tGenerated('m_1931aa93098220')}
                    triggerClassName={cn(
                      'h-9 border-transparent bg-transparent text-sm shadow-none dark:border-transparent dark:bg-transparent',
                      'hover:border-slate-200 dark:hover:border-slate-700',
                    )}
                  >
                    <option value="">—</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-1 py-1">
                  <TextCell
                    value={draft.otherDestination ?? ''}
                    onValue={(v) => updateDraft(row.date, { otherDestination: v })}
                    onSave={() => void saveRow(row.date)}
                    nav="other"
                    idx={index}
                    disabled={!canEdit}
                    placeholder="—"
                  />
                </td>
                <td className="px-1 py-1">
                  <KmInput
                    value={draft.businessKm}
                    onValue={(v) => updateDraft(row.date, { businessKm: v })}
                    onSave={() => void saveRow(row.date)}
                    nav="business"
                    idx={index}
                    disabled={!canEdit}
                  />
                </td>
              </>
            )
          }
        />
        <td className={cn('px-1 py-1', personalTint)}>
          <KmInput
            value={draft.personalKm}
            onValue={(v) => updateDraft(row.date, { personalKm: v })}
            onSave={() => void saveRow(row.date)}
            nav="personal"
            idx={index}
            disabled={!canEdit}
          />
        </td>
        <td className="px-3 py-1 text-right">
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              total != null
                ? 'text-slate-800 dark:text-slate-100'
                : 'text-slate-300 dark:text-slate-600',
            )}
          >
            <GeneratedValue value={total != null ? formatKm(total) : '—'} />
          </span>
        </td>
      </tr>
      <GeneratedValue
        value={
          error ? (
            <tr>
              <td colSpan={colCount} className="px-3 pb-1.5 text-xs text-red-600">
                <GeneratedValue value={error} />
              </td>
            </tr>
          ) : null
        }
      />
    </>
  )
}
