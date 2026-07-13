'use client'

// Dashboard parameters UI:
//   • DashboardFilters — a filter bar above the grid. Each param renders one
//     control; setting a value writes it to the URL (?p_<key>=…), which the
//     force-dynamic page reads and fans out into the mapped cards.
//   • A settings Drawer (owner-only, edit mode) to define params and map each to
//     one or more (card, field) targets — mirroring the report studio's filter
//     rail (field → operator is fixed to equals here; the param value supplies
//     the right-hand side).

import { useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Plus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Drawer, Input, SearchSelect, Select, type SelectOption } from '@beaconhs/ui'
import type { DashboardParam, DashboardParamMap, DashboardParamType } from '@beaconhs/db/schema'
import { paramSearchKey } from './_params'

type ParamCardColumn = {
  key: string
  label: string
  semanticType: string
  enumOptions?: { value: string; label: string }[]
}
/** A card on the dashboard, with its entity's columns — the map targets. */
export type ParamCard = { id: string; name: string; entityKey: string; columns: ParamCardColumn[] }

const PARAM_TYPES: { value: DashboardParamType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'enum', label: 'Choice' },
]

function slug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '')
    .slice(0, 40)
  if (!base) return ''
  return /^[a-z]/.test(base) ? base : `p_${base}`.slice(0, 40)
}

export function DashboardFilters({
  params,
  paramMap,
  editable,
  cards,
  onSaveParams,
}: {
  params: DashboardParam[]
  paramMap: DashboardParamMap
  /** Owner + edit mode → can open the settings drawer. */
  editable: boolean
  cards: ParamCard[]
  onSaveParams: (
    params: DashboardParam[],
    paramMap: DashboardParamMap,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const hasParams = params.length > 0

  function commit(next: URLSearchParams) {
    const qs = next.toString()
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }
  function setValue(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    const sk = paramSearchKey(key)
    if (value) next.set(sk, value)
    else next.delete(sk)
    commit(next)
  }
  function resetAll() {
    const next = new URLSearchParams(sp.toString())
    for (const p of params) next.delete(paramSearchKey(p.key))
    commit(next)
  }

  const anyActive = params.some((p) => sp.get(paramSearchKey(p.key)) !== null)

  function displayValue(p: DashboardParam): string {
    const fromUrl = sp.get(paramSearchKey(p.key))
    if (fromUrl !== null) return fromUrl
    return p.defaultValue == null ? '' : String(p.defaultValue)
  }

  function enumOptions(p: DashboardParam): SelectOption[] {
    for (const t of paramMap[p.key] ?? []) {
      const col = cards.find((c) => c.id === t.cardId)?.columns.find((c) => c.key === t.field)
      if (col?.enumOptions?.length) return col.enumOptions
    }
    return []
  }

  if (!hasParams && !editable) return null

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <SlidersHorizontal size={13} /> Filters
          {pending ? <Loader2 size={12} className="animate-spin text-teal-500" /> : null}
        </div>

        {hasParams ? (
          params.map((p) => {
            const opts = p.type === 'enum' ? enumOptions(p) : []
            return (
              <label key={p.key} className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{p.label}</span>
                {p.type === 'enum' && opts.length ? (
                  <SearchSelect
                    value={displayValue(p)}
                    onChange={(v) => setValue(p.key, v)}
                    options={opts}
                    clearable
                    emptyLabel="Any"
                    placeholder="Any"
                    sheetTitle={p.label}
                    className="h-9 min-w-[11rem]"
                  />
                ) : (
                  <ParamTextControl
                    key={`${p.key}:${displayValue(p)}`}
                    type={p.type}
                    value={displayValue(p)}
                    onCommit={(v) => setValue(p.key, v)}
                  />
                )}
              </label>
            )
          })
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            No filters yet. Add one to scope the cards on this dashboard.
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {anyActive ? (
            <Button type="button" variant="ghost" onClick={resetAll} className="h-8 text-xs">
              <RotateCcw size={13} className="mr-1" /> Reset
            </Button>
          ) : null}
          {editable ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              className="h-8 text-xs"
            >
              <SlidersHorizontal size={13} className="mr-1" />{' '}
              {hasParams ? 'Edit filters' : 'Add filters'}
            </Button>
          ) : null}
        </div>
      </div>

      {editable ? (
        <ParamsSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initialParams={params}
          initialParamMap={paramMap}
          cards={cards}
          onSave={onSaveParams}
        />
      ) : null}
    </>
  )
}

/** Text/number/date input that commits on blur or Enter (not per keystroke, so
 *  each edit is one navigation). Remounted via `key` when the URL value changes. */
function ParamTextControl({
  type,
  value,
  onCommit,
}: {
  type: DashboardParamType
  value: string
  onCommit: (v: string) => void
}) {
  const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'
  return (
    <Input
      type={inputType}
      defaultValue={value}
      placeholder={type === 'date' ? '' : 'Any'}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="h-9 w-44"
    />
  )
}

// --- Settings drawer --------------------------------------------------------

type DraftTarget = { cardId: string; field: string }
type DraftParam = {
  key: string
  label: string
  type: DashboardParamType
  defaultValue: string
  targets: DraftTarget[]
}

function toDraft(params: DashboardParam[], paramMap: DashboardParamMap): DraftParam[] {
  return params.map((p) => ({
    key: p.key,
    label: p.label,
    type: p.type,
    defaultValue: p.defaultValue == null ? '' : String(p.defaultValue),
    targets: (paramMap[p.key] ?? []).map((t) => ({ cardId: t.cardId, field: t.field })),
  }))
}

function ParamsSettingsDrawer({
  open,
  onClose,
  initialParams,
  initialParamMap,
  cards,
  onSave,
}: {
  open: boolean
  onClose: () => void
  initialParams: DashboardParam[]
  initialParamMap: DashboardParamMap
  cards: ParamCard[]
  onSave: (
    params: DashboardParam[],
    paramMap: DashboardParamMap,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  // Re-seed the draft whenever the drawer opens (key on a changing token).
  return open ? (
    <ParamsSettingsBody
      onClose={onClose}
      initial={toDraft(initialParams, initialParamMap)}
      cards={cards}
      onSave={onSave}
    />
  ) : null
}

function ParamsSettingsBody({
  onClose,
  initial,
  cards,
  onSave,
}: {
  onClose: () => void
  initial: DraftParam[]
  cards: ParamCard[]
  onSave: (
    params: DashboardParam[],
    paramMap: DashboardParamMap,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [draft, setDraft] = useState<DraftParam[]>(initial)
  const [saving, setSaving] = useState(false)

  const cardOptions = useMemo(() => cards.map((c) => ({ value: c.id, label: c.name })), [cards])

  function update(i: number, patch: Partial<DraftParam>) {
    setDraft((d) => d.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }
  function addParam() {
    setDraft((d) => [...d, { key: '', label: '', type: 'text', defaultValue: '', targets: [] }])
  }
  function removeParam(i: number) {
    setDraft((d) => d.filter((_, j) => j !== i))
  }
  function updateTarget(pi: number, ti: number, patch: Partial<DraftTarget>) {
    setDraft((d) =>
      d.map((p, j) =>
        j === pi
          ? { ...p, targets: p.targets.map((t, k) => (k === ti ? { ...t, ...patch } : t)) }
          : p,
      ),
    )
  }
  function addTarget(pi: number) {
    const firstCard = cards[0]
    setDraft((d) =>
      d.map((p, j) =>
        j === pi
          ? { ...p, targets: [...p.targets, { cardId: firstCard?.id ?? '', field: '' }] }
          : p,
      ),
    )
  }
  function removeTarget(pi: number, ti: number) {
    setDraft((d) =>
      d.map((p, j) => (j === pi ? { ...p, targets: p.targets.filter((_, k) => k !== ti) } : p)),
    )
  }

  function fieldsFor(cardId: string): SelectOption[] {
    const card = cards.find((c) => c.id === cardId)
    if (!card) return []
    return card.columns
      .filter((c) => c.semanticType !== 'pk')
      .map((c) => ({ value: c.key, label: c.label }))
  }

  async function save() {
    const params: DashboardParam[] = []
    const paramMap: DashboardParamMap = {}
    const seen = new Set<string>()
    for (const d of draft) {
      const label = d.label.trim()
      const key = (d.key.trim() || slug(label)).trim()
      if (!label || !key) {
        toast.error('Every filter needs a name.')
        return
      }
      if (seen.has(key)) {
        toast.error(`Duplicate filter key "${key}".`)
        return
      }
      seen.add(key)
      const dv = d.defaultValue.trim()
      const defaultValue =
        dv === ''
          ? null
          : d.type === 'number'
            ? Number.isFinite(Number(dv))
              ? Number(dv)
              : null
            : dv
      params.push({ key, label, type: d.type, defaultValue })
      const targets = d.targets.filter((t) => t.cardId && t.field)
      if (targets.length) paramMap[key] = targets
    }
    setSaving(true)
    const r = await onSave(params, paramMap)
    setSaving(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success('Filters saved')
    onClose()
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Dashboard filters"
      description="Define a filter, then point it at the cards it should scope."
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving} className="text-xs">
            {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : null} Save filters
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
            Add some cards to this dashboard first — filters map onto card fields.
          </p>
        ) : null}

        {draft.map((p, pi) => (
          <div
            key={pi}
            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start gap-2">
              <div className="grid flex-1 grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Name
                  </label>
                  <Input
                    value={p.label}
                    onChange={(e) =>
                      update(pi, { label: e.target.value, key: p.key || slug(e.target.value) })
                    }
                    placeholder="e.g. Site"
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Key <span className="font-normal text-slate-400">· used in the URL</span>
                  </label>
                  <Input
                    value={p.key}
                    onChange={(e) => update(pi, { key: slug(e.target.value) })}
                    placeholder="site"
                    className="h-9 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Type
                  </label>
                  <Select
                    value={p.type}
                    onChange={(e) => update(pi, { type: e.target.value as DashboardParamType })}
                    className="h-9"
                  >
                    {PARAM_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Default <span className="font-normal text-slate-400">· optional</span>
                  </label>
                  <Input
                    type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                    value={p.defaultValue}
                    onChange={(e) => update(pi, { defaultValue: e.target.value })}
                    placeholder="None"
                    className="h-9"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeParam(pi)}
                aria-label="Remove filter"
                className="mt-6 text-slate-300 hover:text-rose-500"
              >
                <Trash2 size={15} />
              </button>
            </div>

            {/* Targets */}
            <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  Applies to
                </span>
                <button
                  type="button"
                  onClick={() => addTarget(pi)}
                  disabled={cards.length === 0}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700 disabled:opacity-40"
                >
                  <Plus size={13} /> Add card
                </button>
              </div>
              {p.targets.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Not mapped — this filter won&apos;t do anything until you add a card.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {p.targets.map((t, ti) => (
                    <div key={ti} className="flex items-center gap-1.5">
                      <Select
                        value={t.cardId}
                        onChange={(e) =>
                          updateTarget(pi, ti, { cardId: e.target.value, field: '' })
                        }
                        className="flex-1"
                      >
                        <option value="">Pick a card…</option>
                        {cardOptions.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        value={t.field}
                        onChange={(e) => updateTarget(pi, ti, { field: e.target.value })}
                        className="flex-1"
                        disabled={!t.cardId}
                      >
                        <option value="">Pick a field…</option>
                        {fieldsFor(t.cardId).map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                      <button
                        type="button"
                        onClick={() => removeTarget(pi, ti)}
                        aria-label="Remove mapping"
                        className="text-slate-300 hover:text-rose-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" onClick={addParam} className="w-full text-xs">
          <Plus size={14} className="mr-1" /> Add filter
        </Button>
      </div>
    </Drawer>
  )
}
