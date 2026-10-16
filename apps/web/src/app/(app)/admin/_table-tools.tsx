'use client'

import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Shared table-editing tools for the GrapesJS builders (email + pdf). The plain
// HTML tables authored in the builders need real structural editing — add and
// delete whole columns and rows, size columns, fit a table to the page — which
// GrapesJS doesn't expose out of the box. The geometry lives in `_table-grid.ts`
// and its application to components in `_table-model.ts`; this module wires it
// to the editor and renders the contextual <TableToolbar> and column handles.

import { useEffect, useRef, useState } from 'react'
import type { Component, Editor } from 'grapesjs'
import { layoutTable, nextColumnPercents, nextTableWidthPct } from './_table-grid'
import {
  applyColumnPercents,
  canMoveTableRow,
  cellAtColumn,
  cellPosition,
  fitTableToWidth,
  insertTableColumn,
  insertTableRow,
  isTableCell,
  moveTableRow,
  normalizeTables,
  readColumnPercents,
  readTableWidthPct,
  removeTableColumn,
  removeTableRow,
  setTableWidthPct,
  type CellPosition,
} from './_table-model'

function closestCell(cmp: Component | undefined): Component | null {
  let c: Component | undefined = cmp
  while (c) {
    if (isTableCell(c)) return c
    c = c.parent()
  }
  return null
}

function selectedPosition(editor: Editor): CellPosition | null {
  const cell = closestCell(editor.getSelected())
  return cell ? cellPosition(cell) : null
}

function refresh(editor: Editor): void {
  editor.trigger('change:canvasOffset')
}

function addColumn(editor: Editor): void {
  const pos = selectedPosition(editor)
  if (!pos) return
  // The new column goes to the right of everything the selected cell covers.
  insertTableColumn(pos.table, pos.placement.start + pos.placement.span)
  refresh(editor)
}

/** A column can be deleted from a cell that sits in exactly one column, while another remains. */
function canDeleteColumn(pos: CellPosition | null): pos is CellPosition {
  return !!pos && pos.placement.span === 1 && pos.count > 1
}

function deleteColumn(editor: Editor): void {
  const pos = selectedPosition(editor)
  if (!canDeleteColumn(pos)) return
  const { table, row, placement } = pos
  if (!removeTableColumn(table, placement.start)) return
  // The selected cell is gone. Select its neighbour in the same row so the
  // toolbar stays put and the next delete is one click away.
  const next = cellAtColumn(table, row, Math.min(placement.start, pos.count - 2))
  if (next) editor.select(next)
  else editor.select(table)
  refresh(editor)
}

function addRow(editor: Editor): void {
  const pos = selectedPosition(editor)
  if (!pos) return
  insertTableRow(pos.table, pos.row)
  refresh(editor)
}

function deleteRow(editor: Editor): void {
  const pos = selectedPosition(editor)
  if (!pos) return
  if (removeTableRow(pos.table, pos.row)) {
    editor.select(pos.table)
    refresh(editor)
  }
}

function fitToWidth(editor: Editor): void {
  const pos = selectedPosition(editor)
  if (!pos) return
  fitTableToWidth(pos.table)
  refresh(editor)
}

/** Set ONE column's width, taking the difference from its right-hand neighbour. */
function setColumnWidth(editor: Editor, pct: number | null): void {
  const pos = selectedPosition(editor)
  if (!pos || pct === null || pos.placement.span !== 1) return
  const column = pos.placement.start
  const percents = readColumnPercents(pos.model)
  // Typing a width is the same move as dragging that column's right edge
  // (or, for the last column, its left edge).
  const index = column < percents.length - 1 ? column : column - 1
  if (index < 0) return
  const current = percents[column] ?? 0
  const delta = column === index ? pct - current : current - pct
  applyColumnPercents(pos.model, nextColumnPercents(percents, index, delta))
  refresh(editor)
}

function currentColWidthPct(pos: CellPosition | null): string {
  if (!pos || pos.placement.span !== 1) return ''
  const pct = readColumnPercents(pos.model)[pos.placement.start]
  return pct === undefined ? '' : String(Math.round(pct * 10) / 10)
}

/**
 * Make GrapesJS treat table cells as parts of a grid. Call once from the
 * builder's onEditor, BEFORE loading components.
 *
 * Out of the box a cell is just another component: its Delete key and trash
 * icon removed that one cell, leaving the rows below it a cell longer, and
 * clone/move did the same in reverse. Here deleting a cell deletes its whole
 * column (or, for a title cell spanning the table, its row), and cells cannot
 * be cloned or dragged out of line.
 */
export function installTableEditing(editor: Editor): void {
  editor.DomComponents.addType('cell', {
    extend: 'text',
    isComponent: (el) => el.nodeType === 1 && ['TD', 'TH'].includes(el.tagName),
    model: {
      defaults: {
        type: 'cell',
        tagName: 'td',
        draggable: false,
        copyable: false,
        droppable: true,
        stylable: true,
        editable: true,
      },
    },
    view: {
      events() {
        return {
          dblclick: 'onActive',
          input: 'onInput',
          keydown: 'onCellKeydown',
        }
      },
      onCellKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter' || event.isComposing || !this.rteEnabled) return
        const doc = this.el.ownerDocument
        const anchor = doc.getSelection()?.anchorNode
        const element = anchor?.nodeType === 1 ? (anchor as Element) : anchor?.parentElement
        if (element?.closest('li')) return
        // insertLineBreak adds two breaks before a noneditable inline value in
        // Chrome. Insert one HTML break instead, retaining the native undo stack.
        const existing = new Set(this.el.querySelectorAll('[data-bhs-caret]'))
        this.activeRte.exec('insertHTML', '<br><span data-bhs-caret>\u200b</span>')
        const inserted = [...this.el.querySelectorAll('[data-bhs-caret]')].find(
          (span) => !existing.has(span),
        )
        if (inserted) {
          // Browsers need an editable character before a noneditable value at
          // the start of a line. The parser removes this caret anchor on sync.
          const range = doc.createRange()
          range.setStart(inserted.firstChild!, 0)
          range.collapse(true)
          const selection = doc.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
        event.preventDefault()
        event.stopPropagation()
      },
      canActivate() {
        // Each cell is its own editing surface, including inside nested layout
        // tables. Never make an outer layout cell edit the nested grid as text.
        return {
          result:
            !this.rteEnabled &&
            this.model.get('editable') &&
            this.model.findType('table').length === 0,
        }
      },
    },
  })
  editor.on(
    'command:run:before:core:component-delete',
    ({ options }: { options: { abort?: boolean } }) => {
      const selected = editor.getSelected()
      if (!selected || !isTableCell(selected)) return
      options.abort = true
      const pos = cellPosition(selected)
      if (!pos) return
      if (pos.placement.span === 1) {
        deleteColumn(editor)
      } else if (pos.placement.span === pos.count) {
        deleteRow(editor)
      }
    },
  )
}

/**
 * Repair every table in a freshly loaded document. Call right after
 * setComponents so a template saved with misaligned rows, or with a colgroup
 * still sizing a deleted column, opens whole — and saves that way.
 */
export function repairTables(editor: Editor): void {
  const wrapper = editor.getWrapper()
  if (wrapper) normalizeTables(wrapper)
}

const BTN =
  'rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-700'

// Floats at the top of the canvas whenever a table cell is selected.
export function TableToolbar({ editor }: { editor: Editor | null }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [active, setActive] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const [canSize, setCanSize] = useState(false)
  const [width, setWidth] = useState('')
  const [canMoveUp, setCanMoveUp] = useState(false)
  const [canMoveDown, setCanMoveDown] = useState(false)

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      const pos = selectedPosition(editor)
      setCanMoveUp(!!pos && canMoveTableRow(pos.table, pos.row, -1))
      setCanMoveDown(!!pos && canMoveTableRow(pos.table, pos.row, 1))
      setActive(!!pos)
      setCanDelete(canDeleteColumn(pos))
      setCanSize(!!pos && pos.placement.span === 1 && pos.count > 1)
      setWidth(currentColWidthPct(pos))
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

  const moveRow = (direction: -1 | 1) => {
    const pos = selectedPosition(editor)
    if (pos && moveTableRow(pos.table, pos.row, direction)) {
      editor.select(pos.cell)
      refresh(editor)
    }
  }

  const applyWidth = (raw: string) => {
    const n = Number(raw)
    setColumnWidth(editor, Number.isFinite(n) && n > 0 ? n : null)
  }

  return (
    <div className="absolute top-2 right-2 left-2 z-20 flex flex-wrap items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
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
        onClick={() => deleteColumn(editor)}
        disabled={!canDelete}
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
        onClick={() => deleteRow(editor)}
        title={tGenerated('m_12b310a027b08a')}
      >
        <GeneratedText id="m_18e6c9418cc728" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <button
        type="button"
        className={BTN}
        onClick={() => fitToWidth(editor)}
        title={tGenerated('m_0b3b42818d84db')}
      >
        <GeneratedText id="m_1fd502c12105c1" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <button
        type="button"
        className={BTN}
        disabled={!canMoveUp}
        onClick={() => moveRow(-1)}
        aria-label={tGeneratedValue('Move row up')}
        title={tGeneratedValue('Move row up')}
      >
        ↑
      </button>
      <button
        type="button"
        className={BTN}
        disabled={!canMoveDown}
        onClick={() => moveRow(1)}
        aria-label={tGeneratedValue('Move row down')}
        title={tGeneratedValue('Move row down')}
      >
        ↓
      </button>
      <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_086b61a81c41e5" />
        <input
          type="number"
          min={0}
          max={100}
          value={width}
          disabled={!canSize}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={(e) => applyWidth(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyWidth((e.target as HTMLInputElement).value)
          }}
          placeholder={tGenerated('m_0e4a54b8ee5d61')}
          className="h-6 w-16 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <GeneratedText id="m_10e423cde29e41" />
      </label>
    </div>
  )
}

type Handle = {
  left: number
  top: number
  height: number
  /** A column boundary (the column to its left), or the table's own right edge. */
  kind: 'column' | 'table'
  index: number
}

/** How much of the width it sits in a table fills, in %, measured in the canvas. */
function measuredTableWidthPct(tableEl: HTMLElement): number {
  const parent = tableEl.parentElement
  const view = tableEl.ownerDocument.defaultView
  if (!parent || !view) return 100
  const style = view.getComputedStyle(parent)
  const inner =
    parent.clientWidth -
    parseFloat(style.paddingLeft || '0') -
    parseFloat(style.paddingRight || '0')
  if (inner <= 0) return 100
  return Math.min(100, (tableEl.getBoundingClientRect().width / inner) * 100)
}

/**
 * Drag handles on the column boundaries of the selected table.
 *
 * Typing a number into the toolbar works, but sizing a printed table is a
 * visual judgement — you widen "Specific controls" until the hand-written box
 * looks big enough. The handles sit over the canvas at each boundary and move
 * width between the two columns they divide, so the row always totals 100% and
 * the table can never drift off the page. A table narrower than the page also
 * gets a handle on its right edge, to drag it back out to full width.
 */
export function TableColumnResizer({ editor }: { editor: Editor | null }) {
  const tGenerated = useGeneratedTranslations()
  const [handles, setHandles] = useState<Handle[]>([])
  const dragRef = useRef<
    | {
        kind: 'column'
        index: number
        startX: number
        percents: number[]
        width: number
        // Captured up front. Re-resolving the selection on every move was the
        // bug: writing a width re-creates components, GrapesJS drops the
        // selection, and the lookup then returns null — so the drag applied ONE
        // jump and went dead.
        model: CellPosition['model']
      }
    | { kind: 'table'; startX: number; startPct: number; containerWidth: number; table: Component }
    | null
  >(null)

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      // Never move the handles mid-drag: each width write fires component:update,
      // which would recompute and re-render the control under the cursor.
      if (dragRef.current) return
      const pos = selectedPosition(editor)
      const tableEl = pos?.table.getEl()
      if (!pos || !tableEl) {
        setHandles([])
        return
      }
      const canvas = editor.Canvas
      const tablePos = canvas.getElementPos(tableEl)
      const { placements } = layoutTable(pos.model.grid)
      const percents = readColumnPercents(pos.model)
      const next: Handle[] = []
      let cumulative = 0
      for (let index = 0; index < pos.count - 1; index++) {
        cumulative += percents[index] ?? 0
        // Measure the boundary off a cell that ends there — a title row
        // spanning every column knows nothing about it, so it is skipped.
        const el = placements
          .flatMap((own, r) =>
            own.flatMap((p, c) =>
              p.start + p.span - 1 === index ? [pos.model.cells[r]![c]!] : [],
            ),
          )
          .map((cell) => cell.getEl())
          .find((cellEl) => !!cellEl)
        const cellPos = el ? canvas.getElementPos(el) : null
        const left = cellPos
          ? cellPos.left + cellPos.width
          : tablePos.left + (tablePos.width * cumulative) / 100
        next.push({ left, top: tablePos.top, height: tablePos.height, kind: 'column', index })
      }
      if (measuredTableWidthPct(tableEl) < 99.5) {
        next.push({
          left: tablePos.left + tablePos.width,
          top: tablePos.top,
          height: tablePos.height,
          kind: 'table',
          index: pos.count - 1,
        })
      }
      setHandles(next)
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

  if (!editor || handles.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <GeneratedValue
        value={handles.map((handle) => (
          <div
            key={`${handle.kind}:${handle.index}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={
              handle.kind === 'table'
                ? tGenerated('m_18726b31cb3a41')
                : tGenerated('m_13b885cc10f3a7')
            }
            className="pointer-events-auto absolute w-2 -translate-x-1/2 cursor-col-resize bg-teal-500/0 transition-colors hover:bg-teal-500/40"
            style={{ left: handle.left, top: handle.top, height: handle.height }}
            onPointerDown={(event) => {
              const pos = selectedPosition(editor)
              const tableEl = pos?.table.getEl()
              if (!pos || !tableEl) return
              event.preventDefault()
              // Capture on the handle itself. The canvas is an IFRAME, so once
              // the cursor crosses into it the parent document stops seeing
              // pointer events — the handle rendered and highlighted but never
              // moved. Capture keeps them coming to this element.
              event.currentTarget.setPointerCapture(event.pointerId)
              // Measure in the SAME space the handles are positioned in.
              // getBoundingClientRect() reports iframe pixels, which do not
              // match the pointer's coordinates once the canvas is zoomed — the
              // delta came out scaled and saturated the clamp on the first move.
              const width = editor.Canvas.getElementPos(tableEl).width
              if (handle.kind === 'table') {
                const startPct = readTableWidthPct(pos.table) ?? measuredTableWidthPct(tableEl)
                dragRef.current = {
                  kind: 'table',
                  startX: event.clientX,
                  startPct,
                  containerWidth: startPct > 0 ? (width / startPct) * 100 : width,
                  table: pos.table,
                }
                return
              }
              dragRef.current = {
                kind: 'column',
                index: handle.index,
                startX: event.clientX,
                percents: readColumnPercents(pos.model),
                width,
                model: pos.model,
              }
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag) return
              if (drag.kind === 'table') {
                if (drag.containerWidth <= 0) return
                const deltaPct = ((event.clientX - drag.startX) / drag.containerWidth) * 100
                setTableWidthPct(drag.table, nextTableWidthPct(drag.startPct, deltaPct))
                return
              }
              if (drag.width <= 0) return
              const deltaPct = ((event.clientX - drag.startX) / drag.width) * 100
              applyColumnPercents(
                drag.model,
                nextColumnPercents(drag.percents, drag.index, deltaPct),
              )
            }}
            onPointerUp={(event) => {
              if (!dragRef.current) return
              dragRef.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
              refresh(editor)
            }}
          />
        ))}
      />
    </div>
  )
}
