'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { Button, Drawer, Input } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { toast } from '@/lib/toast'
import {
  MAX_QUICK_ACTIONS,
  TONE_KEYS,
  TONES,
  toneOf,
  type QuickAction,
  type QuickActionOption,
  type QuickActionOptions,
  type SaveQuickActionsAction,
} from './_quick-actions-shared'
import { FALLBACK_ICON, ICON_PICKER_KEYS, QUICK_ACTION_ICONS } from './_quick-actions-icons'
import { listQuickActionOptions, saveQuickActions } from './actions'

type View = 'list' | 'picker' | 'edit'
type PickerTab = 'common' | 'forms' | 'custom'

function genId(): string {
  return globalThis.crypto.randomUUID()
}

export function QuickActionsEditor({
  open,
  value,
  onClose,
  onSaved,
  saveAction = saveQuickActions,
  saveSuccessMessage = 'Quick actions saved',
}: {
  open: boolean
  value: QuickAction[]
  onClose: () => void
  onSaved: (next: QuickAction[]) => void
  saveAction?: SaveQuickActionsAction
  saveSuccessMessage?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [items, setItems] = useState<QuickAction[]>(value)
  const [view, setView] = useState<View>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [options, setOptions] = useState<QuickActionOptions | null>(null)
  const [optionsFailed, setOptionsFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickerTab, setPickerTab] = useState<PickerTab>('common')
  const [search, setSearch] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customHref, setCustomHref] = useState('')

  function reset(nextItems: QuickAction[]) {
    setItems(nextItems.map((action) => ({ ...action })))
    setView('list')
    setEditingId(null)
    setSearch('')
    setPickerTab('common')
    setCustomLabel('')
    setCustomHref('')
  }

  function close() {
    reset(value)
    onClose()
  }

  // Lazy-load the picker catalogue the first time the drawer opens.
  useEffect(() => {
    if (!open || options || optionsFailed) return
    let cancelled = false
    listQuickActionOptions()
      .then((nextOptions) => {
        if (!cancelled) setOptions(nextOptions)
      })
      .catch(() => {
        if (cancelled) return
        setOptionsFailed(true)
        toast.error(tGenerated('m_0595739716b70d'))
      })
    return () => {
      cancelled = true
    }
  }, [open, options, optionsFailed, tGenerated])

  const loadingOptions = open && !options && !optionsFailed

  const editing = editingId ? items.find((a) => a.id === editingId) : null

  function patch(id: string, changes: Partial<QuickAction>) {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...changes } : a)))
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((a) => a.id !== id))
  }

  function move(id: string, dir: -1 | 1) {
    setItems((prev) => {
      const i = prev.findIndex((a) => a.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
  }

  function addFromOption(opt: QuickActionOption) {
    if (items.length >= MAX_QUICK_ACTIONS) {
      toast.error(tGenerated('m_15d238c6ff7abc', { value0: MAX_QUICK_ACTIONS }))
      return
    }
    setItems((prev) => [
      ...prev,
      { id: genId(), label: opt.label, href: opt.href, iconKey: opt.iconKey, tone: opt.tone },
    ])
    setView('list')
    setSearch('')
  }

  function addCustom() {
    const label = customLabel.trim()
    const href = customHref.trim()
    if (!label || !href) return
    if (!(href.startsWith('/') || /^https?:\/\//i.test(href))) {
      toast.error(tGenerated('m_17339765f976b8'))
      return
    }
    if (items.length >= MAX_QUICK_ACTIONS) {
      toast.error(tGenerated('m_15d238c6ff7abc', { value0: MAX_QUICK_ACTIONS }))
      return
    }
    setItems((prev) => [...prev, { id: genId(), label, href, iconKey: 'link', tone: 'sky' }])
    setCustomLabel('')
    setCustomHref('')
    setView('list')
  }

  async function handleSave() {
    const clean = items
      .map((a) => ({ ...a, label: a.label.trim(), href: a.href.trim() }))
      .filter((a) => a.label && a.href)
    setSaving(true)
    try {
      const res = await saveAction(clean)
      if (res.ok) {
        toast.success(tGeneratedValue(saveSuccessMessage))
        onSaved(clean)
        router.refresh()
        reset(clean)
        onClose()
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0731204fbd1b17')))
      }
    } finally {
      setSaving(false)
    }
  }

  const title =
    view === 'picker'
      ? 'Add an action'
      : view === 'edit'
        ? 'Edit action'
        : 'Customize quick actions'

  return (
    <Drawer
      open={open}
      onClose={close}
      size="md"
      title={tGeneratedValue(title)}
      description={tGeneratedValue(view === 'list' ? tGenerated('m_10ab9c40df8156') : undefined)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={saving}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            <GeneratedValue
              value={saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            />
            <GeneratedText id="m_1ab9025ed1067c" />
          </Button>
        </>
      }
    >
      <GeneratedValue
        value={
          view === 'list' ? (
            <ListView
              items={items}
              onAdd={() => setView('picker')}
              onEdit={(id) => {
                setEditingId(id)
                setView('edit')
              }}
              onRemove={remove}
              onMove={move}
            />
          ) : view === 'picker' ? (
            <PickerView
              tab={pickerTab}
              setTab={setPickerTab}
              search={search}
              setSearch={setSearch}
              options={options}
              loading={loadingOptions}
              customLabel={customLabel}
              customHref={customHref}
              setCustomLabel={setCustomLabel}
              setCustomHref={setCustomHref}
              onAddOption={addFromOption}
              onAddCustom={addCustom}
              onBack={() => setView('list')}
            />
          ) : editing ? (
            <EditView
              action={editing}
              onPatch={(c) => patch(editing.id, c)}
              onBack={() => setView('list')}
            />
          ) : null
        }
      />
    </Drawer>
  )
}

// ---- List ------------------------------------------------------------------

function ListView({
  items,
  onAdd,
  onEdit,
  onRemove,
  onMove,
}: {
  items: QuickAction[]
  onAdd: () => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const atMax = items.length >= MAX_QUICK_ACTIONS
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        <GeneratedValue
          value={items.map((a, i) => {
            const t = toneOf(a.tone)
            const Icon = QUICK_ACTION_ICONS[a.iconKey] ?? FALLBACK_ICON
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900/60"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={tGenerated('m_1ec1460770eaa0')}
                    disabled={i === 0}
                    onClick={() => onMove(a.id, -1)}
                    className="rounded p-0.5 text-slate-400 transition hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                  >
                    <ChevronUp size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={tGenerated('m_14ab8cefda3cf9')}
                    disabled={i === items.length - 1}
                    onClick={() => onMove(a.id, 1)}
                    className="rounded p-0.5 text-slate-400 transition hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                  >
                    <ChevronDown size={15} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(a.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.chip}`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      <GeneratedValue value={a.label || <GeneratedText id="m_01e84c627eb6d2" />} />
                    </span>
                    <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">
                      <GeneratedValue value={a.href} />
                    </span>
                  </span>
                </button>
                <span className={`h-3 w-3 shrink-0 rounded-full ${t.swatch}`} aria-hidden />
                <button
                  type="button"
                  aria-label={tGenerated('m_1a9d8d971b1edb')}
                  onClick={() => onRemove(a.id)}
                  className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            )
          })}
        />
      </ul>

      <button
        type="button"
        onClick={onAdd}
        disabled={atMax}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:border-teal-300 hover:bg-teal-50/50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-800/60 dark:hover:bg-teal-950/30 dark:hover:text-teal-300"
      >
        <Plus size={15} />
        <GeneratedValue
          value={
            atMax ? (
              <GeneratedText id="m_13500aaedfc895" values={{ value0: MAX_QUICK_ACTIONS }} />
            ) : (
              <GeneratedText id="m_0237a25f53c35e" />
            )
          }
        />
      </button>
    </div>
  )
}

// ---- Picker ----------------------------------------------------------------

function PickerView({
  tab,
  setTab,
  search,
  setSearch,
  options,
  loading,
  customLabel,
  customHref,
  setCustomLabel,
  setCustomHref,
  onAddOption,
  onAddCustom,
  onBack,
}: {
  tab: PickerTab
  setTab: (t: PickerTab) => void
  search: string
  setSearch: (s: string) => void
  options: QuickActionOptions | null
  loading: boolean
  customLabel: string
  customHref: string
  setCustomLabel: (s: string) => void
  setCustomHref: (s: string) => void
  onAddOption: (o: QuickActionOption) => void
  onAddCustom: () => void
  onBack: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const tabs: { key: PickerTab; label: string }[] = [
    { key: 'common', label: 'Common' },
    ...(options?.canChooseApps ? ([{ key: 'forms', label: 'Apps' }] as const) : []),
    { key: 'custom', label: 'Custom URL' },
  ]
  const list = tab === 'common' ? (options?.common ?? []) : []
  const q = search.trim().toLowerCase()
  const filtered = q
    ? list.filter((o) => o.label.toLowerCase().includes(q) || o.href.toLowerCase().includes(q))
    : list

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
      >
        <ArrowLeft size={13} />
        <GeneratedText id="m_075bc5226ac06f" />
      </button>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
        <GeneratedValue
          value={tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                tab === tb.key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <GeneratedValue value={tb.label} />
            </button>
          ))}
        />
      </div>

      <GeneratedValue
        value={
          tab === 'custom' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  <GeneratedText id="m_1d088977412efb" />
                </label>
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder={tGenerated('m_1743a8303ed4b1')}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  <GeneratedText id="m_1fd2453bf87023" />
                </label>
                <Input
                  value={customHref}
                  onChange={(e) => setCustomHref(e.target.value)}
                  placeholder={tGenerated('m_0bfc514f49c5c0')}
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  <GeneratedText id="m_134206d2fb162b" />
                </p>
              </div>
              <Button
                type="button"
                onClick={onAddCustom}
                disabled={!customLabel.trim() || !customHref.trim()}
                className="w-full"
              >
                <Plus size={14} className="mr-1.5" />
                <GeneratedText id="m_0237a25f53c35e" />
              </Button>
            </div>
          ) : tab === 'forms' ? (
            <div className="space-y-2">
              <RemoteSearchSelect
                lookup="dashboard-quick-action-forms"
                value=""
                onChange={() => undefined}
                onOptionChange={(option) => {
                  if (!option?.meta || option.meta.kind !== 'dashboard-quick-action') return
                  onAddOption({
                    label: option.label,
                    href: option.meta.href,
                    iconKey: option.meta.iconKey,
                    tone: option.meta.tone,
                    hint: option.hint,
                  })
                }}
                placeholder={tGenerated('m_16cf7827925e7e')}
                searchPlaceholder={tGenerated('m_0d0af639465573')}
                sheetTitle="Choose an app"
                ariaLabel="Choose an app or form"
                clearable={false}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_09d755c6887555" />
              </p>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tGenerated('m_0c0f4b8e077d91')}
                  className="pl-8"
                />
              </div>

              <GeneratedValue
                value={
                  loading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                      <Loader2 size={16} className="animate-spin" />
                      <GeneratedText id="m_0e65697ec32c03" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                      <GeneratedText id="m_0fe8d1d8041993" />
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      <GeneratedValue
                        value={filtered.map((o) => {
                          const t = toneOf(o.tone)
                          const Icon = QUICK_ACTION_ICONS[o.iconKey] ?? FALLBACK_ICON
                          return (
                            <li key={`${o.href}:${o.label}`}>
                              <button
                                type="button"
                                onClick={() => onAddOption(o)}
                                className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition hover:border-teal-200 hover:bg-teal-50/50 dark:hover:border-teal-800/60 dark:hover:bg-teal-950/30"
                              >
                                <span
                                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.chip}`}
                                >
                                  <Icon size={15} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                    <GeneratedValue value={o.label} />
                                  </span>
                                  <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">
                                    <GeneratedValue value={o.href} />
                                  </span>
                                </span>
                                <GeneratedValue
                                  value={
                                    o.hint ? (
                                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                        {o.hint}
                                      </span>
                                    ) : null
                                  }
                                />
                                <Plus
                                  size={15}
                                  className="shrink-0 text-teal-600 dark:text-teal-400"
                                />
                              </button>
                            </li>
                          )
                        })}
                      />
                    </ul>
                  )
                }
              />
            </>
          )
        }
      />
    </div>
  )
}

// ---- Edit a single action --------------------------------------------------

function EditView({
  action,
  onPatch,
  onBack,
}: {
  action: QuickAction
  onPatch: (changes: Partial<QuickAction>) => void
  onBack: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
      >
        <ArrowLeft size={13} />
        <GeneratedText id="m_075bc5226ac06f" />
      </button>

      <ActionPreview action={action} />

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_1d088977412efb" />
        </label>
        <Input
          value={action.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder={tGenerated('m_18b7c648c39e28')}
          maxLength={80}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_1fd2453bf87023" />
        </label>
        <Input
          value={action.href}
          onChange={(e) => onPatch({ href: e.target.value })}
          placeholder={tGenerated('m_07ea6b1ea30ce7')}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_158279b74f9a6e" />
        </label>
        <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
          <GeneratedValue
            value={ICON_PICKER_KEYS.map((key) => {
              const Icon = QUICK_ACTION_ICONS[key]!
              const active = action.iconKey === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={tGeneratedValue(key)}
                  onClick={() => onPatch({ iconKey: key })}
                  className={`flex aspect-square items-center justify-center rounded-lg border transition ${
                    active
                      ? 'border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500 dark:bg-teal-950/50 dark:text-teal-300'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Icon size={16} />
                </button>
              )
            })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_1242677f454516" />
        </label>
        <div className="flex flex-wrap gap-2">
          <GeneratedValue
            value={TONE_KEYS.map((tone) => {
              const active = action.tone === tone
              return (
                <button
                  key={tone}
                  type="button"
                  aria-label={tGeneratedValue(TONES[tone].name)}
                  title={tGeneratedValue(TONES[tone].name)}
                  onClick={() => onPatch({ tone })}
                  className={`h-7 w-7 rounded-full ${TONES[tone].swatch} ring-2 ring-offset-2 transition dark:ring-offset-slate-900 ${
                    active ? 'ring-slate-900 dark:ring-white' : 'ring-transparent'
                  }`}
                />
              )
            })}
          />
        </div>
      </div>
    </div>
  )
}

function ActionPreview({ action }: { action: QuickAction }) {
  const t = toneOf(action.tone)
  const Icon = QUICK_ACTION_ICONS[action.iconKey] ?? FALLBACK_ICON
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
      <p className="mb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        <GeneratedText id="m_11d37007232de5" />
      </p>
      <div
        className={`group flex w-full max-w-[16rem] items-center gap-2.5 rounded-xl border px-3 py-2 shadow-sm ${t.tile}`}
      >
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.chip}`}
        >
          <Icon size={14} />
        </span>
        <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${t.label}`}>
          <GeneratedValue value={action.label || <GeneratedText id="m_18b7c648c39e28" />} />
        </span>
      </div>
    </div>
  )
}
