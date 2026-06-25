'use client'

// Records-list panel — the "List" left-rail tab in the App designer.
//
// Configures the records LIST table on /apps/templates/[id]/records: which
// columns show (ordered), the default sort, and the default status filter.
// Edits form_templates.recordConfig.list (jsonb) via the updateListConfig
// server action. Authoring only — the records page reads recordConfig.list to
// build the table.
//
// CONTRACT (must match the records page exactly):
//   ListColumnConfig = { key, source: 'builtin' | 'field', label? }
//   ListConfig       = { columns?, defaultSort?, defaultStatus? }
// Empty/absent columns ⇒ the records page falls back to DEFAULT_COLUMNS.

import { useMemo, useState, useTransition } from 'react'
import { Button, Label, Input, Select } from '@beaconhs/ui'
import { ArrowDown, ArrowUp, Check, Plus, X } from 'lucide-react'
import { toast } from '@/lib/toast'
import { updateListConfig, type ListColumnConfig, type ListConfig } from './actions'

// Builtin column keys → label. Kept in lockstep with the records page.
const BUILTIN_LABEL: Record<string, string> = {
  id: 'ID',
  subject: 'Subject',
  site: 'Site',
  status: 'Status',
  created_at: 'Started',
  submitted_at: 'Submitted',
  submittedBy: 'By',
  pdf: 'PDF',
}
const BUILTIN_KEYS = Object.keys(BUILTIN_LABEL)

// The default set the records page uses when no columns are configured.
const DEFAULT_COLUMNS: ListColumnConfig[] = BUILTIN_KEYS.map((key) => ({
  key,
  source: 'builtin' as const,
}))

// Builtins the records page can sort on.
const SORT_OPTIONS: { key: 'submitted_at' | 'created_at' | 'status'; label: string }[] = [
  { key: 'submitted_at', label: 'Submitted' },
  { key: 'created_at', label: 'Started' },
  { key: 'status', label: 'Status' },
]

// Record statuses available for the default filter. '' = None (no filter).
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
]

export type ListPanelField = { id: string; label: string }

function colKeyId(col: ListColumnConfig) {
  return `${col.source}:${col.key}`
}

export function RecordListPanel({
  templateId,
  initial,
  fields,
}: {
  templateId: string
  initial?: ListConfig
  fields: ListPanelField[]
}) {
  // Seed the editable column list from the saved config, or the defaults when
  // none are configured (so the editor always shows the real starting table).
  const [columns, setColumns] = useState<ListColumnConfig[]>(() =>
    initial?.columns && initial.columns.length
      ? initial.columns.map((c) => ({ ...c }))
      : DEFAULT_COLUMNS.map((c) => ({ ...c })),
  )
  // Whether the user has explicitly customised the columns. When false we save
  // `columns: undefined` so the records page keeps falling back to defaults.
  const [customised, setCustomised] = useState<boolean>(
    Boolean(initial?.columns && initial.columns.length),
  )
  const [sortKey, setSortKey] = useState<'submitted_at' | 'created_at' | 'status'>(
    initial?.defaultSort?.key ?? 'submitted_at',
  )
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initial?.defaultSort?.dir ?? 'desc')
  const [defaultStatus, setDefaultStatus] = useState<string>(initial?.defaultStatus ?? '')
  const [addKind, setAddKind] = useState<string>('')
  const [pending, start] = useTransition()

  const present = useMemo(() => new Set(columns.map(colKeyId)), [columns])
  const fieldLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of fields) m.set(f.id, f.label)
    return m
  }, [fields])

  // Builtins / fields not yet in the table — the "Add column" choices.
  const addableBuiltins = BUILTIN_KEYS.filter((k) => !present.has(`builtin:${k}`))
  const addableFields = fields.filter((f) => !present.has(`field:${f.id}`))

  const displayLabel = (col: ListColumnConfig) =>
    col.source === 'builtin'
      ? (BUILTIN_LABEL[col.key] ?? col.key)
      : (fieldLabel.get(col.key) ?? col.key)

  function mutate(next: ListColumnConfig[]) {
    setColumns(next)
    setCustomised(true)
  }

  function move(i: number, delta: -1 | 1) {
    const j = i + delta
    if (j < 0 || j >= columns.length) return
    const next = columns.slice()
    const a = next[i]
    const b = next[j]
    if (!a || !b) return
    next[i] = b
    next[j] = a
    mutate(next)
  }

  function remove(i: number) {
    mutate(columns.filter((_, idx) => idx !== i))
  }

  function setLabelOverride(i: number, value: string) {
    const current = columns[i]
    if (!current) return
    const trimmed = value.trim()
    const next = columns.slice()
    next[i] = { ...current, label: trimmed || undefined }
    mutate(next)
  }

  function add() {
    if (!addKind) return
    const [source, ...rest] = addKind.split(':')
    const key = rest.join(':')
    if (source === 'builtin' && BUILTIN_KEYS.includes(key)) {
      mutate([...columns, { key, source: 'builtin' }])
    } else if (source === 'field' && fieldLabel.has(key)) {
      mutate([...columns, { key, source: 'field' }])
    }
    setAddKind('')
  }

  function resetToDefaults() {
    setColumns(DEFAULT_COLUMNS.map((c) => ({ ...c })))
    setCustomised(false)
    setAddKind('')
  }

  const save = () =>
    start(async () => {
      const list: ListConfig = {
        columns: customised ? columns : undefined,
        defaultSort: { key: sortKey, dir: sortDir },
        defaultStatus,
      }
      const res = await updateListConfig({ templateId, list })
      if (!res.ok) {
        toast.error(res.error ?? 'Could not save')
        return
      }
      toast.success('Records list saved')
    })

  const canAdd = addableBuiltins.length > 0 || addableFields.length > 0

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Shape the records table for this App — the columns shown, their order, the default sort, and
        the default status filter.
      </p>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Columns</Label>
          {customised ? (
            <button
              type="button"
              onClick={resetToDefaults}
              className="text-[11px] font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Reset to defaults
            </button>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Using defaults</span>
          )}
        </div>

        {columns.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
            No columns. Add at least one, or reset to defaults.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {columns.map((col, i) => (
              <li
                key={colKeyId(col)}
                className="rounded-md border border-slate-200 px-2.5 py-2 dark:border-slate-700"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                    {displayLabel(col)}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {col.source === 'builtin' ? 'Built-in' : 'Field'}
                  </span>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === columns.length - 1}
                      aria-label="Move down"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label="Remove column"
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <Input
                  value={col.label ?? ''}
                  onChange={(e) => setLabelOverride(i, e.target.value)}
                  placeholder={`Label (default: ${displayLabel(col)})`}
                  className="mt-1.5 h-7 text-xs"
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <Select
            value={addKind}
            onChange={(e) => setAddKind(e.target.value)}
            disabled={!canAdd}
            className="flex-1"
          >
            <option value="">{canAdd ? 'Add a column…' : 'All columns added'}</option>
            {addableBuiltins.length ? (
              <optgroup label="Built-in">
                {addableBuiltins.map((k) => (
                  <option key={`builtin:${k}`} value={`builtin:${k}`}>
                    {BUILTIN_LABEL[k]}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {addableFields.length ? (
              <optgroup label="Fields">
                {addableFields.map((f) => (
                  <option key={`field:${f.id}`} value={`field:${f.id}`}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={!addKind}
            aria-label="Add column"
          >
            <Plus size={14} />
          </Button>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Field columns are display-only — sorting and filtering on app-field values isn&apos;t
          supported yet.
        </p>
      </section>

      <section className="space-y-2">
        <Label className="text-xs">Default sort</Label>
        <div className="flex items-center gap-2">
          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="flex-1"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <Label className="text-xs">Default status filter</Label>
        <Select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || 'none'} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          The records page opens pre-filtered to this status. Choose None to show every record.
        </p>
      </section>

      <Button onClick={save} disabled={pending} className="w-full">
        {pending ? (
          'Saving…'
        ) : (
          <>
            <Check size={14} /> Save records list
          </>
        )}
      </Button>
    </div>
  )
}
