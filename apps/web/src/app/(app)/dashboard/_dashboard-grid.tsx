'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Dashboard grid powered by react-grid-layout v2.
//
// v2 dropped the WidthProvider HOC — you pass `width` directly. We measure the
// container with a ResizeObserver. Drag/resize config moved into nested
// `dragConfig` / `resizeConfig` objects.
//
// Two modes:
//   • view — locked (no drag/resize). Cards still hover-lift in place.
//   • edit — drag-anywhere, resize from any corner, palette adds new cards,
//            X button removes. Top toolbar offers Save / Reset / Add.

import 'react-grid-layout/css/styles.css'
import './_grid-overrides.css'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2, Plus, RotateCcw, Save, Settings, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import type { Layout, LayoutItem } from 'react-grid-layout'
import type { DashboardLayoutData } from '@beaconhs/db/schema'
import {
  WIDGETS,
  CATEGORY_LABELS,
  widgetsForRole,
  type WidgetCategory,
  type WidgetMeta,
} from './_widget-registry'
import type { RoleTier } from './_role-tier'
import { QuickActions } from './_quick-actions'
import type { SaveQuickActionsAction } from './_quick-actions-shared'
import { resetDashboardLayout, saveDashboardLayout } from './actions'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { isUuid } from '@/lib/list-params'

// react-grid-layout's ResponsiveGridLayout is purely client (DOM-measured).
const Responsive = dynamic(() => import('react-grid-layout').then((m) => m.Responsive), {
  ssr: false,
}) as unknown as React.ComponentType<any>

const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const ROW_HEIGHT = 48
const MARGIN: readonly [number, number] = [16, 16]
const RESIZE_HANDLES = ['se'] as const
type LayoutWidget = DashboardLayoutData['widgets'][number]
type LibraryCard = { id: string; name: string; description: string }
type DashboardGridActionResult = { ok: true } | { ok: false; error?: string }
type SaveDashboardGridAction = (input: {
  widgets: LayoutWidget[]
}) => Promise<DashboardGridActionResult>
type ResetDashboardGridAction = () => Promise<DashboardGridActionResult>

function quickActionsStateKey(actions: DashboardLayoutData['quickActions']): string {
  return actions ? JSON.stringify(actions) : 'default'
}

export function DashboardGrid({
  initialLayout,
  nodes,
  role,
  mode,
  libraryCards = [],
  allowedWidgetIds,
  saveLayoutAction = saveDashboardLayout as SaveDashboardGridAction,
  resetLayoutAction = resetDashboardLayout as ResetDashboardGridAction,
  saveRedirectHref = '/dashboard',
  toolbarLabel = 'Customising your dashboard',
  resetConfirmMessage = 'Reset to the default layout for your role? Your customisations will be lost.',
  saveSuccessMessage = 'Layout saved',
  resetSuccessMessage = 'Layout reset to default',
  quickActionsSaveAction,
  quickActionsSaveSuccessMessage,
}: {
  initialLayout: DashboardLayoutData
  nodes: Record<string, ReactNode>
  role: RoleTier
  mode: 'view' | 'edit'
  libraryCards?: LibraryCard[]
  /** Registry widget ids the viewer is permitted to add (omit = all). */
  allowedWidgetIds?: readonly string[]
  saveLayoutAction?: SaveDashboardGridAction
  resetLayoutAction?: ResetDashboardGridAction
  saveRedirectHref?: string
  toolbarLabel?: string
  resetConfirmMessage?: string
  saveSuccessMessage?: string
  resetSuccessMessage?: string
  quickActionsSaveAction?: SaveQuickActionsAction
  quickActionsSaveSuccessMessage?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const cardNameById = useMemo(
    () => new Map(libraryCards.map((c) => [c.id, c.name])),
    [libraryCards],
  )
  const router = useRouter()
  const [width, setWidth] = useState(1024)
  const [viewport, setViewport] = useState<'phone' | 'tablet' | 'desktop'>('desktop')
  const [layout, setLayout] = useState<LayoutWidget[]>(initialLayout.widgets)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialLayout.widgets))
  const dirty = useMemo(() => JSON.stringify(layout) !== baseline, [baseline, layout])

  // Below lg the saved 12-col desktop geometry maps badly onto the drag
  // grid's smaller column counts (staircase layouts, dead zones, fixed row
  // heights clipping content). Phones get a stacked flow; tablets a 2-col
  // masonry — both in saved reading order with natural heights. The drag
  // grid only ever renders at desktop widths, where the geometry is native.
  useLayoutEffect(() => {
    const phone = window.matchMedia('(max-width: 639px)')
    const tablet = window.matchMedia('(max-width: 1023px)')
    const apply = () => setViewport(phone.matches ? 'phone' : tablet.matches ? 'tablet' : 'desktop')
    apply()
    phone.addEventListener('change', apply)
    tablet.addEventListener('change', apply)
    return () => {
      phone.removeEventListener('change', apply)
      tablet.removeEventListener('change', apply)
    }
  }, [])

  // Measure container width via ResizeObserver — required by RGL v2. A ref
  // CALLBACK (not a mount-once effect): the measured div only exists in the
  // desktop branch, so it mounts/unmounts as the viewport crosses lg — the
  // observer must follow the node or the grid freezes at a stale width when
  // the window grows back to desktop.
  const roRef = useRef<ResizeObserver | null>(null)
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const next = Math.floor(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  // Esc closes the widget palette — standard drawer ergonomics.
  useEffect(() => {
    if (!paletteOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen])

  const rglLayout = useMemo<LayoutItem[]>(
    () =>
      layout.map((w) => {
        const meta = WIDGETS[w.id]
        return {
          i: w.id,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          minW: meta?.minSize.w ?? 2,
          minH: meta?.minSize.h ?? 2,
          maxW: meta?.maxSize?.w,
          maxH: meta?.maxSize?.h,
          isDraggable: mode === 'edit',
          isResizable: mode === 'edit',
        }
      }),
    [layout, mode],
  )

  const presentIds = useMemo(() => new Set(layout.map((w) => w.id)), [layout])

  const handleAdd = useCallback(
    (meta: WidgetMeta) => {
      if (presentIds.has(meta.id)) return
      const maxY = layout.reduce((m, w) => Math.max(m, w.y + w.h), 0)
      setLayout((prev) => [
        ...prev,
        { id: meta.id, x: 0, y: maxY, w: meta.defaultSize.w, h: meta.defaultSize.h },
      ])
    },
    [layout, presentIds],
  )

  const handleAddCard = useCallback(
    (card: { id: string }) => {
      if (presentIds.has(card.id)) return
      const maxY = layout.reduce((m, w) => Math.max(m, w.y + w.h), 0)
      setLayout((prev) => [...prev, { id: card.id, x: 0, y: maxY, w: 4, h: 4 }])
    },
    [layout, presentIds],
  )

  const handleRemove = useCallback((id: string) => {
    setLayout((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await saveLayoutAction({ widgets: layout })
      if (res.ok) {
        setBaseline(JSON.stringify(layout))
        toast.success(tGeneratedValue(saveSuccessMessage))
        router.push(saveRedirectHref)
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_0731204fbd1b17')))
      }
    } finally {
      setSaving(false)
    }
  }, [
    layout,
    router,
    saveLayoutAction,
    saveRedirectHref,
    saveSuccessMessage,
    tGenerated,
    tGeneratedValue,
  ])

  const handleReset = useCallback(async () => {
    if (!(await confirmDialog({ message: resetConfirmMessage, tone: 'danger' }))) return
    setResetting(true)
    try {
      const res = await resetLayoutAction()
      if (res.ok) {
        toast.success(tGeneratedValue(resetSuccessMessage))
        router.refresh()
      } else {
        toast.error(tGeneratedValue(res.error ?? tGenerated('m_04eaf1aebf3fec')))
      }
    } finally {
      setResetting(false)
    }
  }, [
    resetConfirmMessage,
    resetLayoutAction,
    resetSuccessMessage,
    router,
    tGenerated,
    tGeneratedValue,
  ])

  // Persist geometry only from real user gestures — wired to onDragStop /
  // onResizeStop, never a passive onLayoutChange. RGL re-emits positions on any
  // width change (e.g. a window resize crossing a breakpoint); committing those
  // would overwrite the saved full-width geometry with a transient reflow. The
  // widget palette is now an overlay, so opening it no longer narrows the canvas.
  const commitLayout = useCallback(
    (next: Layout) => {
      if (mode !== 'edit') return
      setLayout((prev) => {
        const map = new Map(prev.map((w) => [w.id, w]))
        const updated: LayoutWidget[] = []
        for (const item of next) {
          if (!map.has(item.i)) continue
          updated.push({ id: item.i, x: item.x, y: item.y, w: item.w, h: item.h })
        }
        return updated
      })
    },
    [mode],
  )

  // Phone: single stacked flow. Tablet: 2-col masonry. Natural heights in
  // saved reading order — no fixed rows, no inner scrollbars, no dead space.
  if (mode === 'view' && viewport !== 'desktop') {
    const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    if (viewport === 'phone') {
      return (
        <div className="space-y-4">
          <GeneratedValue
            value={ordered.map((w) => (
              <div key={w.id}>
                <GeneratedValue value={nodes[w.id] ?? null} />
              </div>
            ))}
          />
        </div>
      )
    }
    return (
      <div className="columns-2 gap-4">
        <GeneratedValue
          value={ordered.map((w) => (
            <div key={w.id} className="mb-4 break-inside-avoid">
              <GeneratedValue value={nodes[w.id] ?? null} />
            </div>
          ))}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <GeneratedValue
        value={
          mode === 'edit' ? (
            <EditToolbar
              dirty={dirty}
              saving={saving}
              resetting={resetting}
              label={tGeneratedValue(toolbarLabel)}
              onSave={handleSave}
              onReset={handleReset}
              onTogglePalette={() => setPaletteOpen((v) => !v)}
              paletteOpen={paletteOpen}
            />
          ) : null
        }
      />

      <div className="w-full">
        <div ref={measureRef} className="min-w-0">
          <Responsive
            className="layout"
            width={width}
            layouts={{ lg: rglLayout, md: rglLayout, sm: rglLayout, xs: rglLayout, xxs: rglLayout }}
            cols={COLS}
            breakpoints={BREAKPOINTS}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            containerPadding={[0, 0]}
            // `cancel` must NOT include `a`: KPI tiles render their whole card
            // as a <Link> (<a>), so excluding anchors would make those cards
            // undraggable. Drag is only enabled in edit mode (links never
            // navigate-vs-drag in view mode), and the 3px threshold means a
            // genuine click still follows the link.
            dragConfig={{
              enabled: mode === 'edit',
              bounded: false,
              cancel: '.no-drag,button,input,select,textarea',
              threshold: 3,
            }}
            resizeConfig={{
              enabled: mode === 'edit',
              handles: RESIZE_HANDLES,
            }}
            onDragStop={(next: Layout) => commitLayout(next)}
            onResizeStop={(next: Layout) => commitLayout(next)}
          >
            <GeneratedValue
              value={layout.map((w) => {
                const node =
                  w.id === 'personal-actions' && quickActionsSaveAction ? (
                    <QuickActions
                      key={quickActionsStateKey(initialLayout.quickActions)}
                      actions={initialLayout.quickActions}
                      saveAction={quickActionsSaveAction}
                      saveSuccessMessage={quickActionsSaveSuccessMessage}
                    />
                  ) : (
                    nodes[w.id]
                  )
                return (
                  <div key={w.id} className="group/cell">
                    <div
                      className="relative h-full w-full"
                      // In edit mode, swallow link navigation so finishing a drag
                      // (or a stray click) never follows a card's link. Capture
                      // phase + stopPropagation stops it before the Link's own
                      // onClick. Only anchors are blocked — the remove button and
                      // any in-card buttons keep working.
                      onClickCapture={
                        mode === 'edit'
                          ? (e) => {
                              if (!(e.target as HTMLElement).closest('a')) return
                              e.preventDefault()
                              e.stopPropagation()
                            }
                          : undefined
                      }
                    >
                      <GeneratedValue
                        value={
                          mode === 'edit' ? (
                            <>
                              <div className="ring-dashed pointer-events-none absolute inset-0 z-10 rounded-xl ring-1 ring-teal-300/0 transition group-hover/cell:ring-teal-400/80" />
                              <button
                                type="button"
                                onClick={() => handleRemove(w.id)}
                                aria-label={tGenerated('m_0339832246cf9a')}
                                className="no-drag absolute -top-2 -right-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 opacity-0 shadow-sm transition group-hover/cell:opacity-100 hover:bg-rose-50 dark:border-rose-800/60 dark:bg-slate-900 dark:hover:bg-rose-950/40"
                              >
                                <X size={12} />
                              </button>
                            </>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          node ??
                          (isUuid(w.id) ? (
                            <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-teal-200 bg-teal-50/40 px-3 text-center dark:border-teal-800/50 dark:bg-teal-950/30">
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                                <GeneratedValue
                                  value={
                                    cardNameById.get(w.id) ?? (
                                      <GeneratedText id="m_084ab6a2b3afee" />
                                    )
                                  }
                                />
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                <GeneratedText id="m_04803316679abb" />
                              </span>
                            </div>
                          ) : (
                            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                              <GeneratedText id="m_00c746ebe202ef" />
                              <GeneratedValue value={w.id} />
                              <GeneratedText id="m_11629edbed6269" />
                            </div>
                          ))
                        }
                      />
                    </div>
                  </div>
                )
              })}
            />
          </Responsive>
        </div>

        <GeneratedValue
          value={
            mode === 'edit' && paletteOpen ? (
              <WidgetPalette
                role={role}
                presentIds={presentIds}
                onAdd={handleAdd}
                libraryCards={libraryCards}
                onAddCard={handleAddCard}
                allowedWidgetIds={allowedWidgetIds}
                onClose={() => setPaletteOpen(false)}
              />
            ) : null
          }
        />
      </div>
    </div>
  )
}

// ---- Toolbar ----------------------------------------------------------------

function EditToolbar({
  dirty,
  saving,
  resetting,
  label,
  onSave,
  onReset,
  onTogglePalette,
  paletteOpen,
}: {
  dirty: boolean
  saving: boolean
  resetting: boolean
  label: string
  onSave: () => void
  onReset: () => void
  onTogglePalette: () => void
  paletteOpen: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="sticky top-0 z-40 flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-2.5 backdrop-blur dark:border-teal-800/60 dark:bg-teal-950/50"
    >
      <div className="flex items-center gap-2 text-sm">
        <Settings size={14} className="text-teal-700 dark:text-teal-300" />
        <span className="font-semibold text-teal-900 dark:text-teal-300">
          <GeneratedValue value={label} />
        </span>
        <span className="hidden text-xs text-teal-700/80 sm:inline dark:text-teal-300/80">
          <GeneratedText id="m_0f6492fdec8ee9" />
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onTogglePalette} className="h-8 text-xs">
          <Plus size={13} className="mr-1" />
          <GeneratedValue
            value={
              paletteOpen ? (
                <GeneratedText id="m_1e08c582823b1b" />
              ) : (
                <GeneratedText id="m_14641d51285e88" />
              )
            }
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={resetting}
          className="h-8 text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        >
          <GeneratedValue
            value={
              resetting ? (
                <Loader2 size={13} className="mr-1 animate-spin" />
              ) : (
                <RotateCcw size={13} className="mr-1" />
              )
            }
          />
          <GeneratedText id="m_0a5029e50c13da" />
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || !dirty} className="h-8 text-xs">
          <GeneratedValue
            value={
              saving ? (
                <Loader2 size={13} className="mr-1 animate-spin" />
              ) : (
                <Save size={13} className="mr-1" />
              )
            }
          />
          <GeneratedText id="m_15123a8748a0cf" />
        </Button>
      </div>
    </motion.div>
  )
}

// ---- Palette ----------------------------------------------------------------

function WidgetPalette({
  role,
  presentIds,
  onAdd,
  libraryCards,
  onAddCard,
  allowedWidgetIds,
  onClose,
}: {
  role: RoleTier
  presentIds: Set<string>
  onAdd: (w: WidgetMeta) => void
  libraryCards: LibraryCard[]
  onAddCard: (c: LibraryCard) => void
  allowedWidgetIds?: readonly string[]
  onClose: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const allowed = allowedWidgetIds ? new Set(allowedWidgetIds) : null
  const sourceWidgets = allowed ? Object.values(WIDGETS) : widgetsForRole(role)
  const visible = sourceWidgets.filter((w) => !allowed || allowed.has(w.id))
  const byCategory = new Map<WidgetCategory, WidgetMeta[]>()
  for (const w of visible) {
    const arr = byCategory.get(w.category) ?? []
    arr.push(w)
    byCategory.set(w.category, arr)
  }

  // A floating overlay drawer — NOT a layout column. The canvas underneath keeps
  // its full width, so opening the palette never reflows the grid and what you
  // arrange is exactly what saves.
  const panel = (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
      className="fixed top-28 right-4 z-40 flex max-h-[calc(100dvh-8rem)] w-[320px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_10749590108c69" />
          </h3>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_0f08dd849ead8f" />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] tracking-wider text-slate-400 uppercase dark:text-slate-500">
            <GeneratedValue value={visible.length} />
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={tGenerated('m_106b3f52aadd9f')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="app-scroll flex-1 space-y-3 overflow-y-auto p-3">
        <GeneratedValue
          value={[...byCategory.entries()].map(([cat, widgets]) => (
            <div key={cat}>
              <h4 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                <GeneratedValue value={CATEGORY_LABELS[cat]} />
              </h4>
              <ul className="space-y-1">
                <GeneratedValue
                  value={widgets.map((w) => {
                    const present = presentIds.has(w.id)
                    return (
                      <li key={w.id}>
                        <button
                          type="button"
                          onClick={() => onAdd(w)}
                          disabled={present}
                          className={`flex w-full items-start justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition ${
                            present
                              ? 'cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500'
                              : 'hover:border-teal-200 hover:bg-teal-50/50 dark:hover:border-teal-800/60 dark:hover:bg-teal-950/40'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                              <GeneratedValue value={w.label} />
                            </div>
                            <div className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                              <GeneratedValue value={w.description} />
                            </div>
                          </div>
                          <GeneratedValue
                            value={
                              present ? (
                                <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                                  <GeneratedText id="m_0e52384735efcc" />
                                </span>
                              ) : (
                                <Plus size={13} className="shrink-0 text-teal-600" />
                              )
                            }
                          />
                        </button>
                      </li>
                    )
                  })}
                />
              </ul>
            </div>
          ))}
        />

        <GeneratedValue
          value={
            libraryCards.length > 0 ? (
              <div>
                <h4 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                  <GeneratedText id="m_144e2654d5be31" />
                </h4>
                <ul className="space-y-1">
                  <GeneratedValue
                    value={libraryCards.map((c) => {
                      const present = presentIds.has(c.id)
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => onAddCard(c)}
                            disabled={present}
                            className={`flex w-full items-start justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition ${
                              present
                                ? 'cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500'
                                : 'hover:border-teal-200 hover:bg-teal-50/50 dark:hover:border-teal-800/60 dark:hover:bg-teal-950/40'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                                <GeneratedValue value={c.name} />
                              </div>
                              <GeneratedValue
                                value={
                                  c.description ? (
                                    <div className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                                      <GeneratedValue value={c.description} />
                                    </div>
                                  ) : null
                                }
                              />
                            </div>
                            <GeneratedValue
                              value={
                                present ? (
                                  <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                                    <GeneratedText id="m_0e52384735efcc" />
                                  </span>
                                ) : (
                                  <Plus size={13} className="shrink-0 text-teal-600" />
                                )
                              }
                            />
                          </button>
                        </li>
                      )
                    })}
                  />
                </ul>
              </div>
            ) : null
          }
        />
      </div>
    </motion.aside>
  )

  // Portal to <body> so the drawer anchors to the viewport. The page's
  // FadeInBody wrapper carries a framer-motion transform, which would otherwise
  // become the containing block for position:fixed and pin the drawer to the
  // scrolling content instead of the screen.
  if (typeof document === 'undefined') return null
  return createPortal(panel, document.body)
}
