'use client'

// The Appsmith / WordPress-style visual canvas for ONE section. Drag widgets
// from the palette onto a grid, move + resize them, click to select (the normal
// Field properties drawer opens), delete. Desktop-only authoring — the END
// PRODUCT renders mobile-first (see _lib/canvas.ts). Uses react-grid-layout v2,
// which needs an explicit width, so we self-measure with a ResizeObserver.

import { useMemo, useRef } from 'react'
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
import { GripVertical, Trash2 } from 'lucide-react'
import { FIELD_TYPES, type CanvasItem, type FieldType, type FormSection } from '@beaconhs/forms-core'

// Curated widget palette with sensible default boxes (in grid units, 12 cols).
const PALETTE: { type: FieldType; w: number; h: number }[] = [
  { type: 'heading', w: 12, h: 1 },
  { type: 'paragraph', w: 12, h: 2 },
  { type: 'divider', w: 12, h: 1 },
  { type: 'image', w: 4, h: 4 },
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
  selectedFieldId,
  onLayout,
  onAddWidget,
  onSelect,
  onDelete,
}: {
  section: FormSection
  selectedFieldId: string | null
  onLayout: (items: CanvasItem[]) => void
  onAddWidget: (type: FieldType, box: { x: number; y: number; w: number; h: number }) => void
  onSelect: (fieldId: string) => void
  onDelete: (fieldId: string) => void
}) {
  const canvas = section.canvas!
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true })
  const dragType = useRef<FieldType | null>(null)

  const fieldById = useMemo(() => new Map(section.fields.map((f) => [f.id, f])), [section.fields])
  // Only render items whose field still exists.
  const items = useMemo(
    () => canvas.items.filter((it) => fieldById.has(it.i)),
    [canvas.items, fieldById],
  )
  const layout = useMemo(() => toLayout(items), [items])
  const bottomY = items.reduce((m, it) => Math.max(m, it.y + it.h), 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 p-2">
        <span className="self-center pr-1 text-[11px] font-medium text-slate-500">
          Drag onto the canvas →
        </span>
        {PALETTE.map((p) => (
          <button
            key={p.type}
            type="button"
            draggable
            onDragStart={(e) => {
              dragType.current = p.type
              e.dataTransfer.setData('text/plain', p.type)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAddWidget(p.type, { x: 0, y: bottomY, ...defaultBox(p.type) })}
            className="cursor-grab rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 transition hover:border-teal-400 hover:bg-teal-50 active:cursor-grabbing"
            title={`Drag or click to add a ${FIELD_TYPES[p.type]?.label ?? p.type}`}
          >
            {FIELD_TYPES[p.type]?.label ?? p.type}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        className="min-h-[220px] rounded-md border border-slate-200"
        style={{
          backgroundImage:
            'linear-gradient(to right, #f1f5f9 1px, transparent 1px), linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)',
          backgroundSize: `${width > 0 ? width / canvas.cols : 40}px ${canvas.rowHeight}px`,
        }}
      >
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
            compactor={noCompactor}
            droppingItem={{ i: '__dropping__', x: 0, y: 0, w: 4, h: 3 }}
            onDrop={(_l, item) => {
              const t = dragType.current
              if (t && item) onAddWidget(t, { x: item.x, y: item.y, ...defaultBox(t) })
              dragType.current = null
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
                  onClick={() => onSelect(f.id)}
                  className={`group flex h-full flex-col overflow-hidden rounded-md border bg-white shadow-sm ${
                    sel ? 'border-teal-500 ring-1 ring-teal-500' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-1.5 py-0.5">
                    <span className="cv-drag flex flex-1 cursor-grab items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 active:cursor-grabbing">
                      <GripVertical size={11} /> {FIELD_TYPES[f.type]?.label ?? f.type}
                    </span>
                    <button
                      type="button"
                      title="Remove widget"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(f.id)
                      }}
                      className="text-slate-300 hover:text-rose-500"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1 px-2 py-1">
                    <div className="truncate text-xs font-medium text-slate-700">
                      {f.label?.en ?? f.id}
                    </div>
                    {f.required ? <span className="text-[10px] text-rose-500">required</span> : null}
                  </div>
                </div>
              )
            })}
          </GridLayout>
        ) : null}
      </div>
    </div>
  )
}
