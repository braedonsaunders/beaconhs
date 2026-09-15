'use client'

import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'

// Shared table-editing tools for the GrapesJS builders (email + pdf). The plain
// HTML tables authored in the builders need real structural editing — add/remove
// columns + rows and set per-column width — which GrapesJS doesn't expose out of
// the box. This module manipulates the selected cell's table in the component
// tree, and renders a contextual <TableToolbar> that appears whenever a table
// cell is selected.

import { useEffect, useRef, useState } from 'react'
import type { Component, Editor } from 'grapesjs'

const CELL_TAGS = new Set(['td', 'th'])

function closestCell(cmp: Component | undefined): Component | null {
  let c: Component | undefined = cmp
  while (c) {
    if (CELL_TAGS.has(String(c.get('tagName')))) return c
    c = c.parent()
  }
  return null
}

function closestTable(cmp: Component | null): Component | null {
  let c: Component | null | undefined = cmp
  while (c) {
    if (String(c.get('tagName')) === 'table') return c
    c = c.parent()
  }
  return null
}

function collectRows(node: Component, out: Component[]): void {
  node.components().forEach((child: Component) => {
    const tag = String(child.get('tagName'))
    if (tag === 'tr') out.push(child)
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') collectRows(child, out)
  })
}

type CellCtx = {
  cell: Component
  row: Component
  table: Component
  colIndex: number
  rows: Component[]
}

function cellCtx(editor: Editor): CellCtx | null {
  const cell = closestCell(editor.getSelected())
  if (!cell) return null
  const row = cell.parent()
  if (!row || String(row.get('tagName')) !== 'tr') return null
  const table = closestTable(row)
  if (!table) return null
  const rows: Component[] = []
  collectRows(table, rows)
  return { cell, row, table, colIndex: cell.index(), rows }
}

// Copy the reference cell's resolved style onto a freshly inserted cell, so a
// new column/row visually matches its neighbours (GrapesJS keeps styles in CSS
// rules keyed by id, not inline, so a bare new cell would be unstyled).
function copyStyle(from: Component | undefined, to: Component | undefined): void {
  if (!from || !to || typeof to.setStyle !== 'function') return
  const style = { ...from.getStyle() }
  delete (style as Record<string, unknown>).width // width is per-column, set explicitly
  to.setStyle(style)
}

function firstAdded(added: Component | Component[]): Component | undefined {
  return Array.isArray(added) ? added[0] : added
}

function addColumn(editor: Editor): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  const at = ctx.colIndex + 1
  ctx.rows.forEach((row) => {
    const cells = row.components()
    const ref = cells.at(Math.min(ctx.colIndex, cells.length - 1))
    const tag = String(ref?.get('tagName')) === 'th' ? 'th' : 'td'
    const label = tag === 'th' ? 'Column' : '&nbsp;'
    // component.append() parses the HTML into a real component; the collection's
    // own .add() does NOT parse an HTML string (it just makes an empty model).
    const created = firstAdded(
      row.append(`<${tag}>${label}</${tag}>`, { at: Math.min(at, cells.length) }),
    )
    copyStyle(ref, created)
  })
  editor.trigger('change:canvasOffset')
}

function removeColumn(editor: Editor): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  // Never delete the last column.
  if (ctx.rows.every((r) => r.components().length <= 1)) return
  ctx.rows.forEach((row) => row.components().at(ctx.colIndex)?.remove())
  editor.trigger('change:canvasOffset')
}

function addRow(editor: Editor): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  const parent = ctx.row.parent()
  if (!parent) return
  const at = ctx.row.index() + 1
  const cellsHtml = ctx.row
    .components()
    .map((c: Component) => {
      const tag = String(c.get('tagName')) === 'th' ? 'th' : 'td'
      return `<${tag}>&nbsp;</${tag}>`
    })
    .join('')
  // New rows are static (no data-each marker — those come from record data).
  const newRow = firstAdded(parent.append(`<tr>${cellsHtml}</tr>`, { at }))
  if (newRow) {
    const src = ctx.row.components()
    const dst = newRow.components()
    src.forEach((c: Component, i: number) => copyStyle(c, dst.at(i)))
  }
  editor.trigger('change:canvasOffset')
}

function removeRow(editor: Editor): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  if (ctx.rows.length <= 1) return
  ctx.row.remove()
  editor.trigger('change:canvasOffset')
}

/** The <col> elements of a table, in column order (empty when there is no colgroup). */
function tableCols(table: Component): Component[] {
  const group = table
    .components()
    .toArray()
    .find((c: Component) => String(c.get('tagName')) === 'colgroup')
  if (!group) return []
  return group
    .components()
    .toArray()
    .filter((c: Component) => String(c.get('tagName')) === 'col')
}

/**
 * Column widths as percentages, in column order.
 *
 * Document tables are laid out `table-layout: fixed` against a known paper
 * width, so a <colgroup> of percentages is what the renderer reads and what a
 * resize has to write. Falls back to the header cells for hand-built tables
 * that have no colgroup yet.
 */
function readColumnPercents(ctx: CellCtx): number[] {
  const cols = tableCols(ctx.table)
  const count = ctx.rows[0]?.components().length ?? 0
  const read = (cmp: Component | undefined): number | null => {
    const raw = String(cmp?.getStyle?.().width ?? '')
    const pct = /^([\d.]+)%$/.exec(raw)?.[1]
    return pct ? Number(pct) : null
  }
  const source = cols.length > 0 ? cols : (ctx.rows[0]?.components().toArray() ?? [])
  const declared = Array.from({ length: count }, (_, i) => read(source[i]))
  const used = declared.reduce((sum: number, w) => sum + (w ?? 0), 0)
  const unsized = declared.filter((w) => w === null).length
  const share = unsized > 0 ? Math.max(0, 100 - used) / unsized : 0
  return declared.map((w) => w ?? share)
}

/** Write percentage widths back, preferring the colgroup the renderer reads. */
function writeColumnPercents(ctx: CellCtx, percents: number[]): void {
  const cols = tableCols(ctx.table)
  const set = (cmp: Component | undefined, pct: number) => {
    if (!cmp || typeof cmp.setStyle !== 'function') return
    cmp.setStyle({ ...cmp.getStyle(), width: `${Math.round(pct * 10) / 10}%` })
  }
  if (cols.length > 0) {
    percents.forEach((pct, i) => set(cols[i], pct))
    return
  }
  // No colgroup: fall back to per-cell widths on every row, which is how the
  // hand-built tables in the block palette are sized.
  ctx.rows.forEach((row) => {
    percents.forEach((pct, i) => set(row.components().at(i), pct))
  })
}

/** Set ONE column's width, taking the difference from its right-hand neighbour. */
function setColumnWidth(editor: Editor, pct: number | null): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  const percents = readColumnPercents(ctx)
  const index = ctx.colIndex
  const neighbour = index + 1 < percents.length ? index + 1 : index - 1
  if (pct === null || neighbour < 0) return
  const pair = (percents[index] ?? 0) + (percents[neighbour] ?? 0)
  const next = Math.min(Math.max(pct, MIN_COLUMN_PCT), pair - MIN_COLUMN_PCT)
  percents[index] = next
  percents[neighbour] = pair - next
  writeColumnPercents(ctx, percents)
  editor.trigger('change:canvasOffset')
}

const MIN_COLUMN_PCT = 3

function currentColWidthPct(editor: Editor): string {
  const ctx = cellCtx(editor)
  if (!ctx) return ''
  const pct = readColumnPercents(ctx)[ctx.colIndex]
  return pct === undefined ? '' : String(Math.round(pct * 10) / 10)
}

const BTN =
  'rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'

// Floats at the top of the canvas whenever a table cell is selected.
export function TableToolbar({ editor }: { editor: Editor | null }) {
  const tGenerated = useGeneratedTranslations()
  const [active, setActive] = useState(false)
  const [width, setWidth] = useState('')

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      const ctx = cellCtx(editor)
      setActive(!!ctx)
      setWidth(currentColWidthPct(editor))
    }
    editor.on('component:selected', sync)
    editor.on('component:deselected', sync)
    editor.on('component:update', sync)
    return () => {
      editor.off('component:selected', sync)
      editor.off('component:deselected', sync)
      editor.off('component:update', sync)
    }
  }, [editor])

  if (!editor || !active) return null

  const applyWidth = (raw: string) => {
    const n = Number(raw)
    setColumnWidth(editor, Number.isFinite(n) && n > 0 ? n : null)
  }

  return (
    <div className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
      <span className="px-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        <GeneratedText id="m_1ccaefc0402329" />
      </span>
      <button
        type="button"
        className={BTN}
        onClick={() => addColumn(editor)}
        title={tGenerated('m_059cd549852b55')}
      >
        <GeneratedText id="m_1792a2fde54c1c" />
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => removeColumn(editor)}
        title={tGenerated('m_0605fd789eea1e')}
      >
        <GeneratedText id="m_173569351d7bf3" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <button
        type="button"
        className={BTN}
        onClick={() => addRow(editor)}
        title={tGenerated('m_1eabd71bbc0199')}
      >
        <GeneratedText id="m_0d067cf371aad1" />
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => removeRow(editor)}
        title={tGenerated('m_12b310a027b08a')}
      >
        <GeneratedText id="m_18e6c9418cc728" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_086b61a81c41e5" />
        <input
          type="number"
          min={0}
          max={100}
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={(e) => applyWidth(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyWidth((e.target as HTMLInputElement).value)
          }}
          placeholder={tGenerated('m_0e4a54b8ee5d61')}
          className="h-6 w-16 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <GeneratedText id="m_10e423cde29e41" />
      </label>
    </div>
  )
}

/**
 * Drag handles on the column boundaries of the selected table.
 *
 * Typing a number into the toolbar works, but sizing a printed table is a
 * visual judgement — you widen "Specific controls" until the hand-written box
 * looks big enough. The handles sit over the canvas at each boundary and move
 * width between the two columns they divide, so the row always totals 100% and
 * the table can never drift off the page.
 */
export function TableColumnResizer({ editor }: { editor: Editor | null }) {
  const [bounds, setBounds] = useState<
    { left: number; top: number; height: number; index: number }[]
  >([])
  const dragRef = useRef<{
    index: number
    startX: number
    percents: number[]
    width: number
  } | null>(null)

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      const ctx = cellCtx(editor)
      const headerRow = ctx?.rows[0]
      const tableEl = ctx?.table.getEl()
      if (!ctx || !headerRow || !tableEl) {
        setBounds([])
        return
      }
      const canvas = editor.Canvas
      const tablePos = canvas.getElementPos(tableEl)
      // Boundaries come from the widest row's cells, so a colspan heading row
      // (which spans every column and knows nothing about them) is skipped.
      const cells = ctx.rows
        .map((row) => row.components().toArray())
        .reduce(
          (widest, cells) => (cells.length > widest.length ? cells : widest),
          [] as Component[],
        )
      const next: { left: number; top: number; height: number; index: number }[] = []
      cells.forEach((cell, index) => {
        if (index === cells.length - 1) return
        const el = cell.getEl()
        if (!el) return
        const pos = canvas.getElementPos(el)
        next.push({
          left: pos.left + pos.width,
          top: tablePos.top,
          height: tablePos.height,
          index,
        })
      })
      setBounds(next)
    }
    const events = [
      'component:selected',
      'component:deselected',
      'component:update',
      'change:canvasOffset',
      'canvasScroll',
    ]
    events.forEach((event) => editor.on(event, sync))
    sync()
    return () => events.forEach((event) => editor.off(event, sync))
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.width <= 0) return
      const ctx = cellCtx(editor)
      if (!ctx) return
      const deltaPct = ((event.clientX - drag.startX) / drag.width) * 100
      const percents = [...drag.percents]
      const left = drag.index
      const right = drag.index + 1
      const pair = (percents[left] ?? 0) + (percents[right] ?? 0)
      const nextLeft = Math.min(
        Math.max((percents[left] ?? 0) + deltaPct, MIN_COLUMN_PCT),
        pair - MIN_COLUMN_PCT,
      )
      percents[left] = nextLeft
      percents[right] = pair - nextLeft
      writeColumnPercents(ctx, percents)
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      editor.trigger('change:canvasOffset')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [editor])

  if (!editor || bounds.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <GeneratedValue
        value={bounds.map((bound) => (
          <div
            key={bound.index}
            role="separator"
            aria-orientation="vertical"
            className="pointer-events-auto absolute w-2 -translate-x-1/2 cursor-col-resize bg-teal-500/0 transition-colors hover:bg-teal-500/40"
            style={{ left: bound.left, top: bound.top, height: bound.height }}
            onPointerDown={(event) => {
              const ctx = cellCtx(editor)
              const tableEl = ctx?.table.getEl()
              if (!ctx || !tableEl) return
              event.preventDefault()
              dragRef.current = {
                index: bound.index,
                startX: event.clientX,
                percents: readColumnPercents(ctx),
                width: tableEl.getBoundingClientRect().width,
              }
            }}
          />
        ))}
      />
    </div>
  )
}
