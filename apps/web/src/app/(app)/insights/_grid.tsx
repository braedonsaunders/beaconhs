'use client'

import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Controlled react-grid-layout grid for an Insights dashboard. The parent
// (workspace) owns layout + edit state; this renders the grid + an "add" palette
// and emits layout changes. Items are generic: a built-in widget OR a saved Card,
// both described by a GridItem (id, sizing, category) so the grid is unaware of
// the difference.

import 'react-grid-layout/css/styles.css'
import '../dashboard/_grid-overrides.css'

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import type { Layout } from 'react-grid-layout'
import type { InsightDashboardLayout } from '@beaconhs/db/schema'

const Responsive = dynamic(() => import('react-grid-layout').then((m) => m.Responsive), {
  ssr: false,
}) as unknown as React.ComponentType<any>

type LW = InsightDashboardLayout['widgets'][number]

export type GridItem = {
  id: string
  label: string
  description: string
  category: string
  minSize: { w: number; h: number }
  defaultSize: { w: number; h: number }
}

const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }

export function InsightsGrid({
  widgets,
  nodes,
  items,
  categoryLabels,
  editing,
  paletteOpen,
  onChange,
}: {
  widgets: LW[]
  nodes: Record<string, ReactNode>
  items: GridItem[]
  categoryLabels: Record<string, string>
  editing: boolean
  paletteOpen: boolean
  onChange: (next: LW[]) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1024)
  const [viewport, setViewport] = useState<'phone' | 'tablet' | 'desktop'>('desktop')
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

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

  // Match the main dashboard's viewport breakpoints (phone ≤639, tablet ≤1023).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
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

  const rgl = useMemo(
    () =>
      widgets.map((w) => {
        const m = itemsById.get(w.id)
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
    [widgets, editing, itemsById],
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

  function add(item: GridItem) {
    if (present.has(item.id)) return
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    onChange([
      ...widgets,
      { id: item.id, x: 0, y: maxY, w: item.defaultSize.w, h: item.defaultSize.h },
    ])
  }
  function remove(id: string) {
    onChange(widgets.filter((w) => w.id !== id))
  }

  // Mobile / tablet VIEW mode: stack into a single column (phone) or a 2-col
  // masonry (tablet) in saved reading order — matching the main dashboard. Edit
  // mode keeps the drag grid so users can still customise on any device. Each
  // card keeps its designed height (grid rows → px) so charts/pivots have room.
  if (!editing && viewport !== 'desktop' && widgets.length > 0) {
    const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x)
    const cellPx = (h: number) => h * 48 + (h - 1) * 16
    if (viewport === 'phone') {
      return (
        <div className="space-y-4">
          <GeneratedValue
            value={ordered.map((w) => (
              <div key={w.id} style={{ height: cellPx(w.h) }}>
                <GeneratedValue value={nodes[w.id] ?? null} />
              </div>
            ))}
          />
        </div>
      )
    }
    return (
      <div className="gap-4 [column-count:2]">
        <GeneratedValue
          value={ordered.map((w) => (
            <div key={w.id} className="mb-4 break-inside-avoid" style={{ height: cellPx(w.h) }}>
              <GeneratedValue value={nodes[w.id] ?? null} />
            </div>
          ))}
        />
      </div>
    )
  }

  return (
    <div className={editing && paletteOpen ? 'grid gap-4 lg:grid-cols-[1fr_320px]' : 'w-full'}>
      <div ref={ref} className="min-w-0">
        <GeneratedValue
          value={
            widgets.length === 0 ? (
              <div className="grid h-64 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900/40">
                <GeneratedValue
                  value={
                    editing ? (
                      <GeneratedText id="m_03f89f231d75c3" />
                    ) : (
                      <GeneratedText id="m_185b2314778af9" />
                    )
                  }
                />
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
                      <GeneratedValue
                        value={
                          editing ? (
                            <button
                              type="button"
                              onClick={() => remove(w.id)}
                              aria-label={tGenerated('m_1a9d8d971b1edb')}
                              className="no-drag absolute -top-2 -right-2 z-20 grid h-6 w-6 place-items-center rounded-full border border-rose-200 bg-white text-rose-600 opacity-0 shadow-sm transition group-hover/cell:opacity-100 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-slate-900"
                            >
                              <X size={12} />
                            </button>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          nodes[w.id] ?? (
                            <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-3 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
                              <GeneratedValue
                                value={
                                  editing ? (
                                    <GeneratedText id="m_1060c4c4bda4ba" />
                                  ) : (
                                    <GeneratedText id="m_08b4b47ddb6430" />
                                  )
                                }
                              />
                            </div>
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
              </Responsive>
            )
          }
        />
      </div>

      <GeneratedValue
        value={
          editing && paletteOpen ? (
            <Palette items={items} categoryLabels={categoryLabels} present={present} onAdd={add} />
          ) : null
        }
      />
    </div>
  )
}

function Palette({
  items,
  categoryLabels,
  present,
  onAdd,
}: {
  items: GridItem[]
  categoryLabels: Record<string, string>
  present: Set<string>
  onAdd: (item: GridItem) => void
}) {
  const byCategory = new Map<string, GridItem[]>()
  for (const it of items) {
    const arr = byCategory.get(it.category) ?? []
    arr.push(it)
    byCategory.set(it.category, arr)
  }
  // Cards first, then the rest.
  const order = ['cards', ...[...byCategory.keys()].filter((c) => c !== 'cards')]

  return (
    <motion.aside
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
      className="app-scroll sticky top-2 max-h-[calc(100vh-160px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <GeneratedText id="m_1f05bf91d0a812" />
      </h3>
      <div className="space-y-3">
        <GeneratedValue
          value={order.map((cat) => {
            const group = byCategory.get(cat)
            if (!group || group.length === 0) return null
            return (
              <div key={cat}>
                <h4 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  <GeneratedValue value={categoryLabels[cat] ?? cat} />
                </h4>
                <ul className="space-y-1">
                  <GeneratedValue
                    value={group.map((w) => {
                      const added = present.has(w.id)
                      return (
                        <li key={w.id}>
                          <button
                            type="button"
                            onClick={() => onAdd(w)}
                            disabled={added}
                            className={`flex w-full items-start justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition ${
                              added
                                ? 'cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-800/50'
                                : 'hover:border-teal-200 hover:bg-teal-50/50 dark:hover:border-teal-500/30 dark:hover:bg-teal-500/5'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                                <GeneratedValue value={w.label} />
                              </div>
                              <div className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                                <GeneratedValue value={w.description} />
                              </div>
                            </div>
                            <GeneratedValue
                              value={
                                added ? (
                                  <span className="shrink-0 text-[10px] text-slate-400">
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
            )
          })}
        />
      </div>
    </motion.aside>
  )
}
