'use client'

// Controlled react-grid-layout grid for an Insights dashboard. The parent
// (workspace) owns the layout + edit state; this renders the grid + the widget
// palette and emits layout changes. Forked from the personal /dashboard grid so
// /dashboard stays untouched.

import 'react-grid-layout/css/styles.css'
import '../dashboard/_grid-overrides.css'

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import type { Layout } from 'react-grid-layout'
import type { InsightDashboardLayout } from '@beaconhs/db/schema'
import {
  INSIGHT_CATEGORY_LABELS,
  INSIGHT_WIDGETS,
  INSIGHT_WIDGET_MAP,
  type InsightWidgetCategory,
  type InsightWidgetMeta,
} from './_widgets'

const Responsive = dynamic(() => import('react-grid-layout').then((m) => m.Responsive), {
  ssr: false,
}) as unknown as React.ComponentType<any>

type LW = InsightDashboardLayout['widgets'][number]
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }

export function InsightsGrid({
  widgets,
  nodes,
  editing,
  paletteOpen,
  onChange,
}: {
  widgets: LW[]
  nodes: Record<string, ReactNode>
  editing: boolean
  paletteOpen: boolean
  onChange: (next: LW[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1024)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0)
      if (next > 0) setWidth(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rgl = useMemo(
    () =>
      widgets.map((w) => {
        const m = INSIGHT_WIDGET_MAP.get(w.id)
        return {
          i: w.id,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          minW: m?.minSize.w ?? 2,
          minH: m?.minSize.h ?? 2,
          isDraggable: editing,
          isResizable: editing,
        }
      }),
    [widgets, editing],
  )

  const present = useMemo(() => new Set(widgets.map((w) => w.id)), [widgets])

  function commit(next: Layout) {
    if (!editing) return
    const map = new Map(widgets.map((w) => [w.id, w]))
    const updated: LW[] = []
    for (const it of next) {
      if (map.has(it.i)) updated.push({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })
    }
    onChange(updated)
  }

  function add(meta: InsightWidgetMeta) {
    if (present.has(meta.id)) return
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    onChange([
      ...widgets,
      { id: meta.id, x: 0, y: maxY, w: meta.defaultSize.w, h: meta.defaultSize.h },
    ])
  }
  function remove(id: string) {
    onChange(widgets.filter((w) => w.id !== id))
  }

  return (
    <div className={editing && paletteOpen ? 'grid gap-4 lg:grid-cols-[1fr_300px]' : 'w-full'}>
      <div ref={ref} className="min-w-0">
        {widgets.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-center text-sm text-slate-400">
            {editing
              ? 'Add widgets from the library →'
              : 'This dashboard is empty. Select Customise to add widgets.'}
          </div>
        ) : (
          <Responsive
            className="layout"
            width={width}
            layouts={{ lg: rgl, md: rgl, sm: rgl, xs: rgl, xxs: rgl }}
            cols={COLS}
            breakpoints={BREAKPOINTS}
            rowHeight={48}
            margin={[16, 16]}
            containerPadding={[0, 0]}
            dragConfig={{
              enabled: editing,
              bounded: false,
              cancel: '.no-drag,a,button,input,select,textarea',
              threshold: 3,
            }}
            resizeConfig={{ enabled: editing, handles: ['se'] }}
            onDragStop={(n: Layout) => commit(n)}
            onResizeStop={(n: Layout) => commit(n)}
          >
            {widgets.map((w) => (
              <div key={w.id} className="group/cell">
                <div className="relative h-full w-full">
                  {editing ? (
                    <>
                      <div className="ring-dashed pointer-events-none absolute inset-0 z-10 rounded-xl ring-1 ring-teal-300/0 transition group-hover/cell:ring-teal-400/80" />
                      <button
                        type="button"
                        onClick={() => remove(w.id)}
                        aria-label="Remove widget"
                        className="no-drag absolute -top-2 -right-2 z-20 grid h-6 w-6 place-items-center rounded-full border border-rose-200 bg-white text-rose-600 opacity-0 shadow-sm transition group-hover/cell:opacity-100 hover:bg-rose-50"
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : null}
                  {nodes[w.id] ?? (
                    <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-400">
                      Widget “{w.id}”
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Responsive>
        )}
      </div>

      {editing && paletteOpen ? <Palette present={present} onAdd={add} /> : null}
    </div>
  )
}

function Palette({
  present,
  onAdd,
}: {
  present: Set<string>
  onAdd: (w: InsightWidgetMeta) => void
}) {
  const byCategory = new Map<InsightWidgetCategory, InsightWidgetMeta[]>()
  for (const w of INSIGHT_WIDGETS) {
    const arr = byCategory.get(w.category) ?? []
    arr.push(w)
    byCategory.set(w.category, arr)
  }
  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className="app-scroll sticky top-2 max-h-[calc(100vh-160px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Widget library</h3>
      <div className="space-y-3">
        {[...byCategory.entries()].map(([cat, widgets]) => (
          <div key={cat}>
            <h4 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              {INSIGHT_CATEGORY_LABELS[cat]}
            </h4>
            <ul className="space-y-1">
              {widgets.map((w) => {
                const added = present.has(w.id)
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => onAdd(w)}
                      disabled={added}
                      className={`flex w-full items-start justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition ${
                        added
                          ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                          : 'hover:border-teal-200 hover:bg-teal-50/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-800">{w.label}</div>
                        <div className="line-clamp-2 text-[10px] text-slate-500">
                          {w.description}
                        </div>
                      </div>
                      {added ? (
                        <span className="shrink-0 text-[10px] text-slate-400">added</span>
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
