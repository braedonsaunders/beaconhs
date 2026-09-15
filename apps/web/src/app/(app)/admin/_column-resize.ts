import type { Component } from 'grapesjs'

/** Smallest share a column may be reduced to, so it can never vanish. */
export const MIN_COLUMN_PCT = 3

/**
 * Column widths after dragging the boundary to the right of `index` by
 * `deltaPct` of the table's width.
 *
 * Width only ever moves between the two columns the boundary divides, so the
 * row still totals 100% and the table cannot creep off the page. Both keep at
 * least MIN_COLUMN_PCT so a column can never be dragged out of existence.
 */
export function nextColumnPercents(percents: number[], index: number, deltaPct: number): number[] {
  const left = percents[index]
  const right = percents[index + 1]
  if (left === undefined || right === undefined) return percents
  const pair = left + right
  if (pair <= MIN_COLUMN_PCT * 2) return percents
  const next = [...percents]
  const nextLeft = Math.min(Math.max(left + deltaPct, MIN_COLUMN_PCT), pair - MIN_COLUMN_PCT)
  next[index] = nextLeft
  next[index + 1] = pair - nextLeft
  return next
}

/** The <col> elements of a table, in column order (empty when there is no colgroup). */
export function tableCols(table: Component): Component[] {
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
 * How many columns a table really has.
 *
 * NOT the first row's cell count: a collection table opens with a section
 * title spanning every column, so the first row holds exactly one cell. Reading
 * the count from there gave a one-entry width array, which made every drag a
 * no-op (and, before that, produced a jump because the missing neighbour read
 * as zero). Prefer the colgroup; otherwise take the widest row.
 */
export function columnCount(cols: Component[], rows: Component[]): number {
  if (cols.length > 0) return cols.length
  return rows.reduce((widest, row) => Math.max(widest, row.components().length), 0)
}

/** The row whose cells map 1:1 to columns — the widest one. */
function widestRow(rows: Component[]): Component | undefined {
  return rows.reduce<Component | undefined>(
    (widest, row) =>
      !widest || row.components().length > widest.components().length ? row : widest,
    undefined,
  )
}

/**
 * Column widths as percentages, in column order.
 *
 * Document tables are laid out `table-layout: fixed` against a known paper
 * width, so a <colgroup> of percentages is what the renderer reads and what a
 * resize has to write. Falls back to the widest row for hand-built tables that
 * have no colgroup yet.
 */
export function readColumnPercents(cols: Component[], rows: Component[]): number[] {
  const count = columnCount(cols, rows)
  const read = (cmp: Component | undefined): number | null => {
    const raw = String(cmp?.getStyle?.().width ?? '')
    const pct = /^([\d.]+)%$/.exec(raw)?.[1]
    return pct ? Number(pct) : null
  }
  const source = cols.length > 0 ? cols : (widestRow(rows)?.components().toArray() ?? [])
  const declared = Array.from({ length: count }, (_, i) => read(source[i]))
  const used = declared.reduce((sum: number, w) => sum + (w ?? 0), 0)
  const unsized = declared.filter((w) => w === null).length
  const share = unsized > 0 ? Math.max(0, 100 - used) / unsized : 0
  return declared.map((w) => w ?? share)
}

/**
 * Write percentage widths to components resolved UP FRONT.
 *
 * A drag must not re-resolve the selection between moves: setting a width
 * re-creates components and GrapesJS drops the selection, so the second lookup
 * returns nothing and the drag dies after one jump.
 */
export function applyColumnPercents(
  targets: { cols: Component[]; rows: Component[] },
  percents: number[],
): void {
  const set = (cmp: Component | undefined, pct: number) => {
    if (!cmp || typeof cmp.setStyle !== 'function') return
    cmp.setStyle({ ...cmp.getStyle(), width: `${Math.round(pct * 10) / 10}%` })
  }
  if (targets.cols.length > 0) {
    percents.forEach((pct, i) => set(targets.cols[i], pct))
    return
  }
  // No colgroup: size every row's cells, which is how the hand-built tables in
  // the block palette are laid out.
  targets.rows.forEach((row) => {
    if (row.components().length !== percents.length) return
    percents.forEach((pct, i) => set(row.components().at(i), pct))
  })
}
