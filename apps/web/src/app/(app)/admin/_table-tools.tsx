'use client'

// Shared table-editing tools for the GrapesJS builders (email + pdf). The plain
// HTML tables authored in the builders need real structural editing — add/remove
// columns + rows and set per-column width — which GrapesJS doesn't expose out of
// the box. This module manipulates the selected cell's table in the component
// tree, and renders a contextual <TableToolbar> that appears whenever a table
// cell is selected.

import { useEffect, useState } from 'react'
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

export function addColumn(editor: Editor): void {
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

export function removeColumn(editor: Editor): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  // Never delete the last column.
  if (ctx.rows.every((r) => r.components().length <= 1)) return
  ctx.rows.forEach((row) => row.components().at(ctx.colIndex)?.remove())
  editor.trigger('change:canvasOffset')
}

export function addRow(editor: Editor): void {
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

export function removeRow(editor: Editor): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  if (ctx.rows.length <= 1) return
  ctx.row.remove()
  editor.trigger('change:canvasOffset')
}

// Apply a width to EVERY cell in the selected cell's column (px, or '' to clear).
// Style width is captured by the builders' fullHtml serialization (and inlined by
// juice for email), so it survives to the rendered output.
export function setColumnWidth(editor: Editor, px: number | null): void {
  const ctx = cellCtx(editor)
  if (!ctx) return
  ctx.rows.forEach((row) => {
    const c = row.components().at(ctx.colIndex)
    if (!c || typeof c.setStyle !== 'function') return
    const style = { ...c.getStyle() }
    if (px && px > 0) style.width = `${px}px`
    else delete (style as Record<string, unknown>).width
    c.setStyle(style)
  })
  editor.trigger('change:canvasOffset')
}

function currentColWidthPx(editor: Editor): string {
  const ctx = cellCtx(editor)
  if (!ctx) return ''
  const w = String(ctx.cell.getStyle().width ?? '')
  const m = w.match(/^(\d+(?:\.\d+)?)px$/)
  return m?.[1] ?? ''
}

const BTN =
  'rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'

// Floats at the top of the canvas whenever a table cell is selected.
export function TableToolbar({ editor }: { editor: Editor | null }) {
  const [active, setActive] = useState(false)
  const [width, setWidth] = useState('')

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      const ctx = cellCtx(editor)
      setActive(!!ctx)
      setWidth(currentColWidthPx(editor))
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
        Table
      </span>
      <button type="button" className={BTN} onClick={() => addColumn(editor)} title="Add column">
        + Col
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => removeColumn(editor)}
        title="Remove column"
      >
        − Col
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <button type="button" className={BTN} onClick={() => addRow(editor)} title="Add row">
        + Row
      </button>
      <button type="button" className={BTN} onClick={() => removeRow(editor)} title="Remove row">
        − Row
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        Col width
        <input
          type="number"
          min={0}
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={(e) => applyWidth(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyWidth((e.target as HTMLInputElement).value)
          }}
          placeholder="auto"
          className="h-6 w-16 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        px
      </label>
    </div>
  )
}
