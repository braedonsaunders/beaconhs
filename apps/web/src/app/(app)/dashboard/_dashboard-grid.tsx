'use client'

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
import { resetDashboardLayout, saveDashboardLayout } from './actions'
import { toast } from '@/lib/toast'

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

export function DashboardGrid({
  initialLayout,
  nodes,
  role,
  mode,
}: {
  initialLayout: DashboardLayoutData
  nodes: Record<string, ReactNode>
  role: RoleTier
  mode: 'view' | 'edit'
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1024)
  const [isPhone, setIsPhone] = useState(false)
  const [layout, setLayout] = useState<LayoutWidget[]>(initialLayout.widgets)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const baselineRef = useRef(JSON.stringify(initialLayout.widgets))
  const dirty = useMemo(() => JSON.stringify(layout) !== baselineRef.current, [layout])

  // Phones get a stacked flow instead of the drag grid (see early return
  // below) — the saved desktop geometry forces fixed row heights that waste
  // space and clip content at a single column.
  useLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const apply = () => setIsPhone(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Measure container width via ResizeObserver — required by RGL v2.
  useLayoutEffect(() => {
    const el = containerRef.current
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
    return () => ro.disconnect()
  }, [])

  // Resync local state when the server-provided layout changes (e.g. after save).
  useEffect(() => {
    const next = JSON.stringify(initialLayout.widgets)
    if (next !== baselineRef.current) {
      baselineRef.current = next
      setLayout(initialLayout.widgets)
    }
  }, [initialLayout])

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

  const handleRemove = useCallback((id: string) => {
    setLayout((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const res = await saveDashboardLayout({ widgets: layout })
      if (res.ok) {
        baselineRef.current = JSON.stringify(layout)
        toast.success('Layout saved')
        router.push('/dashboard')
      } else {
        toast.error(res.error ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }, [layout, router])

  const handleReset = useCallback(async () => {
    if (!confirm('Reset to the default layout for your role? Your customisations will be lost.'))
      return
    setResetting(true)
    try {
      await resetDashboardLayout()
      toast.success('Layout reset to default')
      router.refresh()
    } finally {
      setResetting(false)
    }
  }, [router])

  // Only commit layout changes triggered by user drag/resize — NOT every
  // `onLayoutChange` event. If we commit on every event, opening the palette
  // (which narrows the container, sometimes crossing a breakpoint) makes RGL
  // reflow and emit "new" positions; we'd save those, and on close the grid
  // would stay squished because our saved layout no longer matches the
  // full-width geometry.
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

  // Stacked phone layout: widgets in saved reading order with natural
  // heights — no fixed rows, no inner scrollbars, no dead space.
  if (mode === 'view' && isPhone) {
    const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
    return (
      <div className="space-y-4">
        {ordered.map((w) => (
          <div key={w.id}>{nodes[w.id] ?? null}</div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {mode === 'edit' ? (
        <EditToolbar
          dirty={dirty}
          saving={saving}
          resetting={resetting}
          onSave={handleSave}
          onReset={handleReset}
          onTogglePalette={() => setPaletteOpen((v) => !v)}
          paletteOpen={paletteOpen}
        />
      ) : null}

      <div
        className={
          mode === 'edit' && paletteOpen
            ? 'grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]'
            : 'w-full'
        }
      >
        <div ref={containerRef} className="min-w-0">
          <Responsive
            className="layout"
            width={width}
            layouts={{ lg: rglLayout, md: rglLayout, sm: rglLayout, xs: rglLayout, xxs: rglLayout }}
            cols={COLS}
            breakpoints={BREAKPOINTS}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            containerPadding={[0, 0]}
            dragConfig={{
              enabled: mode === 'edit',
              bounded: false,
              cancel: '.no-drag,a,button,input,select,textarea',
              threshold: 3,
            }}
            resizeConfig={{
              enabled: mode === 'edit',
              handles: RESIZE_HANDLES,
            }}
            onDragStop={(next: Layout) => commitLayout(next)}
            onResizeStop={(next: Layout) => commitLayout(next)}
          >
            {layout.map((w) => {
              const node = nodes[w.id]
              return (
                <div key={w.id} className="group/cell">
                  <div className="relative h-full w-full">
                    {mode === 'edit' ? (
                      <>
                        <div className="ring-dashed pointer-events-none absolute inset-0 z-10 rounded-xl ring-1 ring-teal-300/0 transition group-hover/cell:ring-teal-400/80" />
                        <button
                          type="button"
                          onClick={() => handleRemove(w.id)}
                          aria-label="Remove widget"
                          className="no-drag absolute -top-2 -right-2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 opacity-0 shadow-sm transition group-hover/cell:opacity-100 hover:bg-rose-50 dark:border-rose-800/60 dark:bg-slate-900 dark:hover:bg-rose-950/40"
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : null}
                    {node ?? (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                        Widget "{w.id}" not available
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </Responsive>
        </div>

        {mode === 'edit' && paletteOpen ? (
          <WidgetPalette role={role} presentIds={presentIds} onAdd={handleAdd} />
        ) : null}
      </div>
    </div>
  )
}

// ---- Toolbar ----------------------------------------------------------------

function EditToolbar({
  dirty,
  saving,
  resetting,
  onSave,
  onReset,
  onTogglePalette,
  paletteOpen,
}: {
  dirty: boolean
  saving: boolean
  resetting: boolean
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
          Customising your dashboard
        </span>
        <span className="hidden text-xs text-teal-700/80 sm:inline dark:text-teal-300/80">
          Drag tiles to reorder, drag the bottom-right corner to resize, click ✕ to remove.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onTogglePalette} className="h-8 text-xs">
          <Plus size={13} className="mr-1" />
          {paletteOpen ? 'Hide widgets' : 'Add widget'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={resetting}
          className="h-8 text-xs text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
        >
          {resetting ? (
            <Loader2 size={13} className="mr-1 animate-spin" />
          ) : (
            <RotateCcw size={13} className="mr-1" />
          )}
          Reset to default
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || !dirty} className="h-8 text-xs">
          {saving ? (
            <Loader2 size={13} className="mr-1 animate-spin" />
          ) : (
            <Save size={13} className="mr-1" />
          )}
          Save layout
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
}: {
  role: RoleTier
  presentIds: Set<string>
  onAdd: (w: WidgetMeta) => void
}) {
  const visible = widgetsForRole(role)
  const byCategory = new Map<WidgetCategory, WidgetMeta[]>()
  for (const w of visible) {
    const arr = byCategory.get(w.category) ?? []
    arr.push(w)
    byCategory.set(w.category, arr)
  }

  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className="app-scroll sticky top-16 max-h-[calc(100vh-160px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Widget library</h3>
        <span className="text-[10px] tracking-wider text-slate-400 uppercase dark:text-slate-500">
          {visible.length} available
        </span>
      </div>
      <div className="space-y-3">
        {[...byCategory.entries()].map(([cat, widgets]) => (
          <div key={cat}>
            <h4 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
              {CATEGORY_LABELS[cat]}
            </h4>
            <ul className="space-y-1">
              {widgets.map((w) => {
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
                          {w.label}
                        </div>
                        <div className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                          {w.description}
                        </div>
                      </div>
                      {present ? (
                        <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                          added
                        </span>
                      ) : (
                        <Plus size={13} className="shrink-0 text-teal-600" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </motion.aside>
  )
}
