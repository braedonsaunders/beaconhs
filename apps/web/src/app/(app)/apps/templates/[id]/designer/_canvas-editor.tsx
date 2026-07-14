'use client'

// The Appsmith / WordPress-style visual canvas for ONE section. Drag widgets
// from the palette onto a grid, move + resize them, click to select (the normal
// Field properties drawer opens), delete. Desktop-only authoring — the END
// PRODUCT renders mobile-first (see _lib/canvas.ts). Uses react-grid-layout v2,
// which needs an explicit width, so we self-measure with a ResizeObserver.

import { useMemo, useRef, type RefObject } from 'react'
// react-grid-layout v2 (current API): config-object props + the
// useContainerWidth hook (the modern WidthProvider replacement).
import {
  GridLayout,
  noCompactor,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'

// Free-form placement: no auto-compaction (elements stay exactly where you drop
// them), but collisions are BLOCKED rather than pushing neighbours away or
// allowing overlap. `noCompactor` alone leaves `preventCollision` off, so RGL
// shoves items far on collision (and can leave overlaps) — preventCollision
// turns "push neighbour away" into "snap back", fixing both.
const FREE_COMPACTOR = { ...noCompactor, preventCollision: true }
import { GripVertical, Trash2 } from 'lucide-react'
import {
  FIELD_TYPES,
  type CanvasItem,
  type FieldType,
  type FormSection,
} from '@beaconhs/forms-core'
import type { AppLocale } from '@beaconhs/i18n'
import { ElementPreview } from './_element-preview'

// Curated widget palette with sensible default boxes (in grid units, 12 cols).
const PALETTE: { type: FieldType; w: number; h: number }[] = [
  { type: 'heading', w: 12, h: 1 },
  { type: 'paragraph', w: 12, h: 2 },
  { type: 'divider', w: 12, h: 1 },
  { type: 'text', w: 4, h: 2 },
  { type: 'long_text', w: 6, h: 3 },
  { type: 'number', w: 3, h: 2 },
  { type: 'date', w: 3, h: 2 },
  { type: 'select', w: 4, h: 2 },
  { type: 'radio', w: 4, h: 3 },
  { type: 'checkbox_group', w: 4, h: 3 },
  { type: 'yes_no_comment', w: 6, h: 3 },
  { type: 'rating', w: 3, h: 2 },
  { type: 'photo', w: 4, h: 4 },
  { type: 'signature', w: 6, h: 3 },
  { type: 'table', w: 12, h: 5 },
]

export function defaultBox(type: FieldType): { w: number; h: number } {
  const p = PALETTE.find((x) => x.type === type)
  return { w: p?.w ?? 4, h: p?.h ?? 3 }
}

function toLayout(items: CanvasItem[]): LayoutItem[] {
  return items.map((it) => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h }))
}
function fromLayout(layout: Layout): CanvasItem[] {
  return layout
    .filter((l) => l.i !== '__dropping__')
    .map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))
}
function sameItems(a: CanvasItem[], b: CanvasItem[]): boolean {
  if (a.length !== b.length) return false
  const m = new Map(a.map((it) => [it.i, it]))
  for (const it of b) {
    const o = m.get(it.i)
    if (!o || o.x !== it.x || o.y !== it.y || o.w !== it.w || o.h !== it.h) return false
  }
  return true
}

export function CanvasEditor({
  section,
  locale,
  defaultLocale,
  selectedFieldId,
  dragTypeRef,
  onLayout,
  onAddWidget,
  onSelect,
  onDelete,
}: {
  section: FormSection
  locale: AppLocale
  defaultLocale: AppLocale
  selectedFieldId: string | null
  // The element type currently being dragged from the left palette.
  dragTypeRef: RefObject<FieldType | null>
  onLayout: (items: CanvasItem[]) => void
  onAddWidget: (type: FieldType, box: { x: number; y: number; w: number; h: number }) => void
  onSelect: (fieldId: string) => void
  onDelete: (fieldId: string) => void
}) {
  const canvas = section.canvas!
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true })
  // Tells a real "select" click apart from the click event that fires at the END
  // of a drag/resize: a drag's release click lands far from where the press
  // began, so only a near-stationary click selects. A pure distance check can
  // never block a genuine (stationary) click, so selection always works.
  const pressRef = useRef<{ x: number; y: number } | null>(null)

  const fieldById = useMemo(() => new Map(section.fields.map((f) => [f.id, f])), [section.fields])
  // Only render items whose field still exists.
  const items = useMemo(
    () => canvas.items.filter((it) => fieldById.has(it.i)),
    [canvas.items, fieldById],
  )
  const layout = useMemo(() => toLayout(items), [items])

  return (
    <div
      ref={containerRef}
      className="relative min-h-[240px] rounded-md border border-slate-200"
      style={{
        backgroundImage:
          'linear-gradient(to right, #f1f5f9 1px, transparent 1px), linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)',
        backgroundSize: `${width > 0 ? width / canvas.cols : 40}px ${canvas.rowHeight}px`,
      }}
    >
      {items.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-md bg-white/80 px-3 py-1.5 text-xs text-slate-400">
            Drag elements here from the left panel
          </span>
        </div>
      ) : null}
      {mounted && width > 0 ? (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: canvas.cols, rowHeight: canvas.rowHeight, margin: [8, 8] }}
          dragConfig={{ handle: '.cv-drag' }}
          dropConfig={{
            enabled: true,
            defaultItem: { w: 4, h: 3 },
            onDragOver: () => ({ w: 4, h: 3 }),
          }}
          compactor={FREE_COMPACTOR}
          droppingItem={{ i: '__dropping__', x: 0, y: 0, w: 4, h: 3 }}
          onDrop={(_l, item) => {
            const t = dragTypeRef.current
            if (t && item) onAddWidget(t, { x: item.x, y: item.y, ...defaultBox(t) })
            dragTypeRef.current = null
          }}
          onLayoutChange={(l) => {
            const next = fromLayout(l)
            if (!sameItems(items, next)) onLayout(next)
          }}
        >
          {items.map((it) => {
            const f = fieldById.get(it.i)!
            const sel = f.id === selectedFieldId
            return (
              <div
                key={it.i}
                onPointerDown={(e) => {
                  pressRef.current = { x: e.clientX, y: e.clientY }
                }}
                onClick={(e) => {
                  const d = pressRef.current
                  pressRef.current = null
                  // The click that ends a drag/resize lands far from the press —
                  // only a near-stationary click selects, so moving an element no
                  // longer opens the properties panel.
                  if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
                  onSelect(f.id)
                }}
                title={FIELD_TYPES[f.type]?.label ?? f.type}
                className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition ${
                  sel
                    ? 'border-teal-500 ring-1 ring-teal-500'
                    : 'border-slate-200 hover:border-slate-300 hover:shadow'
                }`}
              >
                {/* Hover toolbar: drag handle + remove. The card body is a live
                      preview of the element as it ships. */}
                <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <span
                    className="cv-drag flex h-5 w-5 cursor-grab items-center justify-center rounded bg-white/90 text-slate-400 shadow-sm ring-1 ring-slate-200 hover:text-slate-600 active:cursor-grabbing"
                    title="Drag to move"
                  >
                    <GripVertical size={11} />
                  </span>
                  <button
                    type="button"
                    title="Remove element"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(f.id)
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded bg-white/90 text-slate-400 shadow-sm ring-1 ring-slate-200 hover:text-rose-500"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="app-scroll min-h-0 flex-1 overflow-auto p-2.5">
                  <ElementPreview field={f} locale={locale} defaultLocale={defaultLocale} compact />
                </div>
              </div>
            )
          })}
        </GridLayout>
      ) : null}
    </div>
  )
}
