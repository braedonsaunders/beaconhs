import type { Component } from 'grapesjs'
import {
  layoutTable,
  normalizePercents,
  parseSpan,
  percentsNeedRepair,
  percentsWithColumn,
  percentsWithoutColumn,
  planColumnInsertion,
  planColumnRemoval,
  planRowFixes,
  tableColumnCount,
  type GridRow,
  type Placement,
} from './_table-grid'

// GrapesJS side of the template builders' table tools: reads a table component
// into the plain grid `_table-grid.ts` plans on, and applies those plans back to
// the components. Structural edits always keep three things in step — every
// row's cells, the <colgroup>, and widths that total 100% of the table.

const CELL_TAGS = new Set(['td', 'th'])
const SECTION_TAGS = new Set(['thead', 'tbody', 'tfoot'])

const tagOf = (cmp: Component | null | undefined): string =>
  String(cmp?.get('tagName') ?? '').toLowerCase()

export const isTableCell = (cmp: Component | null | undefined): boolean => CELL_TAGS.has(tagOf(cmp))

type TableModel = {
  table: Component
  /** The <col> entries, in column order (empty when there is no colgroup). */
  cols: Component[]
  rows: Component[]
  /** Each row's cells, in order. */
  cells: Component[][]
  grid: GridRow[]
}

function colgroupOf(table: Component): Component | undefined {
  return table
    .components()
    .toArray()
    .find((child: Component) => tagOf(child) === 'colgroup')
}

/** The <col> elements of a table, in column order (empty when there is no colgroup). */
export function tableCols(table: Component): Component[] {
  const group = colgroupOf(table)
  if (!group) return []
  return group
    .components()
    .toArray()
    .filter((child: Component) => tagOf(child) === 'col')
}

/** A table's rows and cells, grouped by thead/tbody/tfoot so rowspans stay inside one. */
export function readTable(table: Component): TableModel {
  const rows: Component[] = []
  const sections: number[] = []
  let section = 0
  let loose: number | null = null
  table.components().forEach((child: Component) => {
    const tag = tagOf(child)
    if (tag === 'tr') {
      loose ??= section++
      rows.push(child)
      sections.push(loose)
    } else if (SECTION_TAGS.has(tag)) {
      loose = null
      const id = section++
      child.components().forEach((row: Component) => {
        if (tagOf(row) !== 'tr') return
        rows.push(row)
        sections.push(id)
      })
    }
  })
  const cells = rows.map((row) => row.components().toArray().filter(isTableCell))
  const grid = cells.map((rowCells, i) => ({
    section: sections[i]!,
    cells: rowCells.map((cell) => {
      const attrs = cell.getAttributes()
      return { colspan: parseSpan(attrs.colspan), rowspan: parseSpan(attrs.rowspan) }
    }),
  }))
  return { table, cols: tableCols(table), rows, cells, grid }
}

/** How many columns a table really has — see `tableColumnCount`. */
export function columnCount(model: TableModel): number {
  return tableColumnCount(model.grid)
}

function widthPctOf(cmp: Component | undefined): number | null {
  const raw = String(cmp?.getStyle?.().width ?? '').trim()
  const pct = /^([\d.]+)%$/.exec(raw)?.[1]
  return pct ? Number(pct) : null
}

function setWidthPct(cmp: Component | undefined, pct: number): void {
  if (!cmp || typeof cmp.setStyle !== 'function') return
  cmp.setStyle({ ...cmp.getStyle(), width: `${Math.round(pct * 10) / 10}%` })
}

/** Rows whose cells map 1:1 onto the columns — no spans, no cells from a row above. */
function plainRows(model: TableModel, count: number): number[] {
  const { placements, occupied } = layoutTable(model.grid)
  return placements.flatMap((own, r) =>
    own.length === count && occupied[r]!.size === count && own.every((p) => p.span === 1)
      ? [r]
      : [],
  )
}

/**
 * The widths the table declares, in column order. The colgroup is what a
 * `table-layout: fixed` renderer reads; hand-built tables without one size the
 * cells of a plain row instead.
 */
function declaredPercents(model: TableModel, count: number): (number | null)[] {
  if (model.cols.length > 0) return model.cols.map(widthPctOf)
  const reference = plainRows(model, count)[0]
  return reference === undefined ? [] : model.cells[reference]!.map(widthPctOf)
}

/** Whether the table sizes its columns at all (an auto-layout table may leave it to content). */
function declaresWidths(model: TableModel, count: number): boolean {
  return model.cols.length > 0 || declaredPercents(model, count).some((pct) => pct !== null)
}

/** Column widths as percentages, in column order, always totalling 100%. */
export function readColumnPercents(model: TableModel): number[] {
  const count = columnCount(model)
  return normalizePercents(declaredPercents(model, count), count)
}

/**
 * Write percentage widths to components resolved UP FRONT.
 *
 * A drag must not re-resolve the selection between moves: setting a width
 * re-creates components and GrapesJS drops the selection, so the second lookup
 * returns nothing and the drag dies after one jump.
 */
export function applyColumnPercents(model: TableModel, percents: number[]): void {
  if (model.cols.length > 0) {
    percents.forEach((pct, i) => setWidthPct(model.cols[i], pct))
    return
  }
  // No colgroup: size the cells of every plain row, which is how the
  // hand-built tables in the block palette are laid out.
  for (const r of plainRows(model, percents.length)) {
    percents.forEach((pct, i) => setWidthPct(model.cells[r]![i], pct))
  }
}

/** The table's own width as a share of what it sits in, when it declares one in %. */
export function readTableWidthPct(table: Component): number | null {
  return widthPctOf(table)
}

export function setTableWidthPct(table: Component, pct: number): void {
  setWidthPct(table, pct)
}

function setColspan(cell: Component, colspan: number): void {
  if (colspan > 1) cell.addAttributes({ colspan: String(colspan) })
  else cell.removeAttributes('colspan')
}

/**
 * Copy the reference cell's resolved style onto a freshly inserted cell, so a
 * new column/row visually matches its neighbours (GrapesJS keeps styles in CSS
 * rules keyed by id, not inline, so a bare new cell would be unstyled).
 */
function copyStyle(from: Component | undefined, to: Component | undefined): void {
  if (!from || !to || typeof to.setStyle !== 'function') return
  const style = { ...from.getStyle() }
  delete (style as Record<string, unknown>).width // width is per-column, set explicitly
  to.setStyle(style)
}

function firstAdded(added: Component | Component[]): Component | undefined {
  return Array.isArray(added) ? added[0] : added
}

const NBSP = '\u00a0'

/**
 * A table part as a component definition, never an HTML string: GrapesJS
 * parses strings as a document body, and the HTML parser drops <td>, <tr> and
 * <col> found outside a table — an appended "<td>x</td>" arrived as the bare
 * text "x" beside the cells, not as a new cell.
 */
function cellDef(tag: 'td' | 'th', text: string, colspan = 1) {
  return {
    type: 'cell',
    tagName: tag,
    ...(colspan > 1 ? { attributes: { colspan: String(colspan) } } : {}),
    components: [
      { type: 'text', tagName: 'span', components: [{ type: 'textnode', content: text }] },
    ],
  }
}

const COL_DEF = { tagName: 'col', void: true }

/** Append (or insert at component index `at`) a cell, styled like `like`. */
function addCell(row: Component, tag: 'td' | 'th', text: string, like?: Component, at?: number) {
  const created = firstAdded(row.append(cellDef(tag, text), at === undefined ? {} : { at }))
  copyStyle(like, created)
  return created
}

/** Keep the colgroup at exactly `count` entries. Trailing extras are stale; missing ones are added. */
function syncColgroup(model: TableModel, count: number): boolean {
  const group = colgroupOf(model.table)
  if (!group || model.cols.length === count) return false
  if (model.cols.length > count) {
    model.cols.slice(count).forEach((col) => col.remove())
  } else {
    for (let i = model.cols.length; i < count; i++) group.append(COL_DEF)
  }
  return true
}

/**
 * Repair a table so every row fills the same columns and the widths fill the
 * table. Safe to run on any table, any number of times: a consistent table is
 * left exactly as it is, and no cell — so no content — is ever removed.
 *
 * Tables saved before column deletes were whole-column operations come back
 * here in one of two broken shapes: rows with a cell more or fewer than their
 * neighbours, or a colgroup still sizing a deleted column (which pinned the
 * table part-way across the page and left no edge to drag it back).
 */
export function normalizeTable(table: Component): void {
  let model = readTable(table)
  const count = columnCount(model)
  if (count === 0) return
  const fixes = planRowFixes(model.grid, count)
  for (const fix of fixes) {
    const row = model.rows[fix.row]!
    const cells = model.cells[fix.row]!
    for (const { cell, colspan } of fix.colspans) {
      const target = cells[cell]
      if (target) setColspan(target, colspan)
    }
    const last = cells[cells.length - 1]
    const tag = cells.length > 0 && cells.every((cell) => tagOf(cell) === 'th') ? 'th' : 'td'
    for (let i = 0; i < fix.pad; i++) addCell(row, tag, NBSP, last)
  }
  if (fixes.length > 0) model = readTable(table)
  if (syncColgroup(model, count)) model = readTable(table)
  if (model.cols.length === 0) return
  const declared = model.cols.map(widthPctOf)
  if (percentsNeedRepair(declared, count)) {
    applyColumnPercents(model, normalizePercents(declared, count))
  }
}

/** Repair every table in the document — run once when a template opens. */
export function normalizeTables(root: Component): void {
  const tables: Component[] = []
  const walk = (cmp: Component) => {
    if (tagOf(cmp) === 'table') tables.push(cmp)
    cmp.components().forEach(walk)
  }
  walk(root)
  tables.forEach(normalizeTable)
}

/** Delete logical column `column` from every row, its colgroup entry, and its share of the width. */
export function removeTableColumn(table: Component, column: number): boolean {
  normalizeTable(table)
  const model = readTable(table)
  const count = columnCount(model)
  // Never delete the last column.
  if (count <= 1 || column < 0 || column >= count) return false
  const sized = declaresWidths(model, count)
  const before = readColumnPercents(model)
  for (const change of planColumnRemoval(model.grid, column)) {
    const cell = model.cells[change.row]?.[change.cell]
    if (!cell) continue
    if (change.colspan === null) cell.remove()
    else setColspan(cell, change.colspan)
  }
  model.cols[column]?.remove()
  if (sized) applyColumnPercents(readTable(table), percentsWithoutColumn(before, column))
  return true
}

/** Insert a new logical column so it becomes column `at`, in every row and the colgroup. */
export function insertTableColumn(table: Component, at: number): boolean {
  normalizeTable(table)
  const model = readTable(table)
  const count = columnCount(model)
  if (at < 0 || at > count) return false
  const sized = declaresWidths(model, count)
  const before = readColumnPercents(model)
  const plan = planColumnInsertion(model.grid, at)
  for (const { row, cell } of plan.widen) {
    const target = model.cells[row]?.[cell]
    if (target) setColspan(target, model.grid[row]!.cells[cell]!.colspan + 1)
  }
  for (const { row, index, like } of plan.insert) {
    const rowCmp = model.rows[row]!
    const cells = model.cells[row]!
    const ref = like === null ? undefined : cells[like]
    const tag = tagOf(ref) === 'th' ? 'th' : 'td'
    const position = cells[index]?.index() ?? rowCmp.components().length
    addCell(rowCmp, tag, tag === 'th' ? 'Column' : NBSP, ref, position)
  }
  const group = colgroupOf(table)
  if (group && model.cols.length > 0) {
    group.append(COL_DEF, { at: model.cols[at]?.index() ?? group.components().length })
  }
  if (sized) applyColumnPercents(readTable(table), percentsWithColumn(before, at))
  return true
}

/** Add a row below `row` with the same column layout, styled like it. */
export function insertTableRow(table: Component, row: Component): void {
  const parent = row.parent()
  if (!parent) return
  const cells = row.components().toArray().filter(isTableCell)
  const components = cells.map((cell) =>
    cellDef(tagOf(cell) === 'th' ? 'th' : 'td', NBSP, parseSpan(cell.getAttributes().colspan)),
  )
  // New rows are static (no data-each marker — those come from record data).
  const created = firstAdded(
    parent.append({ type: 'row', tagName: 'tr', components }, { at: row.index() + 1 }),
  )
  if (created) {
    const added = created.components().toArray().filter(isTableCell)
    cells.forEach((cell, i) => copyStyle(cell, added[i]))
  }
  // A row added under a cell that spans down can collide with it; even it out.
  normalizeTable(table)
}

/** Move a row within its section; crossing rowspans would change the grid's meaning. */
export function canMoveTableRow(table: Component, row: Component, direction: -1 | 1): boolean {
  const model = readTable(table)
  if (model.grid.some((r) => r.cells.some((cell) => cell.rowspan > 1))) return false
  const index = row.index() + direction
  if (index < 0) return false
  const sibling = row.parent()?.components().at(index)
  return !!sibling && tagOf(sibling) === 'tr'
}

export function moveTableRow(table: Component, row: Component, direction: -1 | 1): boolean {
  const parent = row.parent()
  if (!parent || !canMoveTableRow(table, row, direction)) return false
  row.move(parent, { at: row.index() + (direction === 1 ? 2 : -1) })
  return true
}

/** Remove a row, keeping at least one. Cells that spanned down through it are evened out. */
export function removeTableRow(table: Component, row: Component): boolean {
  if (readTable(table).rows.length <= 1) return false
  row.remove()
  normalizeTable(table)
  return true
}

/**
 * Stretch a table to the full width it sits in and repair its columns — the
 * one-click way out of a table left narrower than the page.
 */
export function fitTableToWidth(table: Component): void {
  normalizeTable(table)
  setTableWidthPct(table, 100)
  const model = readTable(table)
  const count = columnCount(model)
  if (declaresWidths(model, count)) applyColumnPercents(model, readColumnPercents(model))
}

/** The cell of `row` that covers logical column `column` (or the row's last cell). */
export function cellAtColumn(
  table: Component,
  row: Component,
  column: number,
): Component | undefined {
  const model = readTable(table)
  const r = model.rows.indexOf(row)
  if (r === -1) return undefined
  const own = layoutTable(model.grid).placements[r]!
  const hit = own.findIndex((p) => column >= p.start && column < p.start + p.span)
  const cells = model.cells[r]!
  return hit === -1 ? cells[cells.length - 1] : cells[hit]
}

export type CellPosition = {
  cell: Component
  row: Component
  table: Component
  model: TableModel
  placement: Placement
  count: number
}

/** Where a cell sits in its table: its logical column and span, not its index in the row. */
export function cellPosition(cell: Component): CellPosition | null {
  const row = cell.parent()
  if (!row || tagOf(row) !== 'tr') return null
  let table: Component | undefined = row.parent()
  while (table && tagOf(table) !== 'table') table = table.parent()
  if (!table) return null
  const model = readTable(table)
  const r = model.rows.indexOf(row)
  const c = r === -1 ? -1 : model.cells[r]!.indexOf(cell)
  if (c === -1) return null
  const placement = layoutTable(model.grid).placements[r]![c]!
  return { cell, row, table, model, placement, count: columnCount(model) }
}
