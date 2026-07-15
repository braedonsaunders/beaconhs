'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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

type ListPanelField = { id: string; label: string }

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0af1983403d12e')))
        return
      }
      toast.success(tGenerated('m_0f6148e9f2ec85'))
    })

  const canAdd = addableBuiltins.length > 0 || addableFields.length > 0

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_069c0e17c0f410" />
      </p>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">
            <GeneratedText id="m_04eacfda3069db" />
          </Label>
          <GeneratedValue
            value={
              customised ? (
                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="text-[11px] font-medium text-teal-600 hover:underline dark:text-teal-400"
                >
                  <GeneratedText id="m_1f67de126c9538" />
                </button>
              ) : (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  <GeneratedText id="m_03c1aa43a38ec7" />
                </span>
              )
            }
          />
        </div>

        <GeneratedValue
          value={
            columns.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                <GeneratedText id="m_01b170d39fc364" />
              </p>
            ) : (
              <ul className="space-y-1.5">
                <GeneratedValue
                  value={columns.map((col, i) => (
                    <li
                      key={colKeyId(col)}
                      className="rounded-md border border-slate-200 px-2.5 py-2 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                          <GeneratedValue value={displayLabel(col)} />
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          <GeneratedValue
                            value={
                              col.source === 'builtin' ? (
                                <GeneratedText id="m_09bfd82959f8d2" />
                              ) : (
                                <GeneratedText id="m_1dfe960eaa6224" />
                              )
                            }
                          />
                        </span>
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            aria-label={tGenerated('m_1ec1460770eaa0')}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(i, 1)}
                            disabled={i === columns.length - 1}
                            aria-label={tGenerated('m_14ab8cefda3cf9')}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(i)}
                            aria-label={tGenerated('m_0605fd789eea1e')}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <Input
                        value={col.label ?? ''}
                        onChange={(e) => setLabelOverride(i, e.target.value)}
                        placeholder={tGenerated('m_0ecbfeb2752049', { value0: displayLabel(col) })}
                        className="mt-1.5 h-7 text-xs"
                      />
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />

        <div className="flex items-center gap-2">
          <Select
            value={addKind}
            onChange={(e) => setAddKind(e.target.value)}
            disabled={!canAdd}
            className="flex-1"
          >
            <option value="">
              <GeneratedValue
                value={
                  canAdd ? (
                    <GeneratedText id="m_10a2cdb9b25b6b" />
                  ) : (
                    <GeneratedText id="m_1643640821919c" />
                  )
                }
              />
            </option>
            <GeneratedValue
              value={
                addableBuiltins.length ? (
                  <optgroup label={tGenerated('m_09bfd82959f8d2')}>
                    <GeneratedValue
                      value={addableBuiltins.map((k) => (
                        <option key={`builtin:${k}`} value={`builtin:${k}`}>
                          <GeneratedValue value={BUILTIN_LABEL[k]} />
                        </option>
                      ))}
                    />
                  </optgroup>
                ) : null
              }
            />
            <GeneratedValue
              value={
                addableFields.length ? (
                  <optgroup label={tGenerated('m_147efea3b670a8')}>
                    <GeneratedValue
                      value={addableFields.map((f) => (
                        <option key={`field:${f.id}`} value={`field:${f.id}`}>
                          <GeneratedValue value={f.label} />
                        </option>
                      ))}
                    />
                  </optgroup>
                ) : null
              }
            />
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={add}
            disabled={!addKind}
            aria-label={tGenerated('m_059cd549852b55')}
          >
            <Plus size={14} />
          </Button>
        </div>

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_07536b1f56f5ac" />
        </p>
      </section>

      <section className="space-y-2">
        <Label className="text-xs">
          <GeneratedText id="m_184e33c0ff4633" />
        </Label>
        <div className="flex items-center gap-2">
          <Select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="flex-1"
          >
            <GeneratedValue
              value={SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  <GeneratedValue value={o.label} />
                </option>
              ))}
            />
          </Select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={tGeneratedValue(
              sortDir === 'asc' ? tGenerated('m_0c8a5fae720673') : tGenerated('m_1bce7fbc0c4e38'),
            )}
          >
            <GeneratedValue
              value={sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            />
            <GeneratedValue
              value={
                sortDir === 'asc' ? (
                  <GeneratedText id="m_0027c5891082cf" />
                ) : (
                  <GeneratedText id="m_14a3ccc633a056" />
                )
              }
            />
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <Label className="text-xs">
          <GeneratedText id="m_1e0e89e45806e4" />
        </Label>
        <Select value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)}>
          <GeneratedValue
            value={STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'none'} value={o.value}>
                <GeneratedValue value={o.label} />
              </option>
            ))}
          />
        </Select>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_1191dfec9eacde" />
        </p>
      </section>

      <Button onClick={save} disabled={pending} className="w-full">
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_106811f2aac664" />
            ) : (
              <>
                <Check size={14} /> <GeneratedText id="m_16defa6a739143" />
              </>
            )
          }
        />
      </Button>
    </div>
  )
}
