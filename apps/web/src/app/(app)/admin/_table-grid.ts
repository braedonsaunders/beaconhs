// Pure table geometry for the template builders' table tools.
//
// A template table is a grid of logical columns. Rows hold cells that may span
// several columns (a section title over the whole table) or several rows, and a
// <colgroup> of percentages sizes the columns. Every structural edit — add or
// delete a column, repair a table saved in a broken state — is planned here on
// plain data, then applied to the editor's components by `_table-model.ts`.
// Keeping the arithmetic free of GrapesJS is what makes it testable.

/** Smallest share a column may be reduced to, so it can never vanish. */
export const MIN_COLUMN_PCT = 3

/** Narrowest a table may be dragged, as a share of the width it sits in. */
export const MIN_TABLE_PCT = 20

const MAX_SPAN = 1000

type GridCell = { colspan: number; rowspan: number }

/** A row's own cells. `section` groups rows of one thead/tbody/tfoot. */
export type GridRow = { section: number; cells: GridCell[] }

/** Where one of a row's own cells sits on the column grid. */
export type Placement = { start: number; span: number; rowspan: number }

export type TableLayout = {
  /** Each row's own cells, in order, placed on the grid. */
  placements: Placement[][]
  /** Column slots filled in each row — its own cells and rowspans from above. */
  occupied: Set<number>[]
}

/** A colspan/rowspan attribute as a usable span: a positive integer, else 1. */
export function parseSpan(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(value) && value >= 1 ? Math.min(value, MAX_SPAN) : 1
}

/** Place every cell on the column grid, honouring colspan and rowspan. */
export function layoutTable(rows: GridRow[]): TableLayout {
  const occupied = rows.map(() => new Set<number>())
  const placements = rows.map((row, r) => {
    const filled = occupied[r]!
    let col = 0
    return row.cells.map((cell) => {
      while (filled.has(col)) col++
      const span = Math.max(1, cell.colspan)
      // A rowspan never reaches past its own thead/tbody/tfoot.
      let rowspan = 1
      while (rowspan < cell.rowspan && rows[r + rowspan]?.section === row.section) rowspan++
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < span; dc++) occupied[r + dr]!.add(col + dc)
      }
      const placement = { start: col, span, rowspan }
      col += span
      return placement
    })
  })
  return { placements, occupied }
}

function rowWidth(occupied: Set<number>): number {
  let width = 0
  for (const slot of occupied) width = Math.max(width, slot + 1)
  return width
}

function covers(p: Placement, column: number): boolean {
  return column >= p.start && column < p.start + p.span
}

/**
 * How many columns a table really has.
 *
 * Rows of single-column cells are the truth: their width is the column count
 * the author built. A section title spanning the table is only a decoration —
 * after a column is deleted it can be left claiming one column too many, and
 * that phantom column is what pinned a table part-way across the page. Spanning
 * rows set the count only when there are no plain rows to read. The count never
 * drops below what a row needs to keep every one of its cells.
 */
export function tableColumnCount(rows: GridRow[]): number {
  const { placements, occupied } = layoutTable(rows)
  let plain = 0
  let spanning = 0
  let hasPlain = false
  let floor = 0
  rows.forEach((row, r) => {
    const filled = occupied[r]!
    if (filled.size === 0) return
    const width = rowWidth(filled)
    if (row.cells.length > 0 && row.cells.every((cell) => cell.colspan <= 1)) {
      hasPlain = true
      plain = Math.max(plain, width)
    } else {
      spanning = Math.max(spanning, width)
    }
    const own = placements[r]!
    const carried = [...filled].filter((slot) => !own.some((p) => covers(p, slot))).length
    floor = Math.max(floor, row.cells.length + carried)
  })
  return Math.max(hasPlain ? plain : spanning, floor)
}

/** One row's repair: new colspans for some of its cells, then empty cells appended. */
export type RowFix = { row: number; colspans: { cell: number; colspan: number }[]; pad: number }

/**
 * Make every row fill exactly `count` columns without losing a cell.
 *
 * A short row — a cell deleted on its own, a column added to some rows only —
 * gets empty cells appended (or, for a title row, its spanning cell widened).
 * A row that claims too many columns has its spanning cells narrowed. Content
 * is never removed: a cell is only ever widened, narrowed, or added.
 */
export function planRowFixes(rows: GridRow[], count: number): RowFix[] {
  const work: GridRow[] = rows.map((row) => ({
    section: row.section,
    cells: row.cells.map((cell) => ({ ...cell })),
  }))
  const fixes: RowFix[] = []
  work.forEach((row, r) => {
    const colspans = new Map<number, number>()
    // Narrow spanning cells, rightmost first, until the row fits.
    for (;;) {
      const layout = layoutTable(work)
      if (rowWidth(layout.occupied[r]!) <= count) break
      let widest = row.cells.length - 1
      while (widest >= 0 && row.cells[widest]!.colspan <= 1) widest--
      if (widest < 0) break
      row.cells[widest]!.colspan -= 1
      colspans.set(widest, row.cells[widest]!.colspan)
    }

    const layout = layoutTable(work)
    const filled = layout.occupied[r]!
    const free: number[] = []
    for (let slot = 0; slot < count; slot++) if (!filled.has(slot)) free.push(slot)
    let pad = 0
    if (free.length > 0) {
      const own = layout.placements[r]!
      const last = own.length - 1
      const lastPlacement = own[last]
      const end = lastPlacement ? lastPlacement.start + lastPlacement.span : -1
      const freeTail = free.every((slot, i) => slot === end + i)
      if (lastPlacement && lastPlacement.span > 1 && freeTail) {
        // A title row spanning the table keeps spanning all of it.
        row.cells[last]!.colspan += free.length
        colspans.set(last, row.cells[last]!.colspan)
      } else {
        pad = free.length
        for (let i = 0; i < pad; i++) row.cells.push({ colspan: 1, rowspan: 1 })
      }
    }
    if (colspans.size > 0 || pad > 0) {
      fixes.push({
        row: r,
        colspans: [...colspans].map(([cell, colspan]) => ({ cell, colspan })),
        pad,
      })
    }
  })
  return fixes
}

/** What happens to one cell when a column goes: narrowed to `colspan`, or removed (null). */
export type CellChange = { row: number; cell: number; colspan: number | null }

/**
 * Delete logical column `column` from every row.
 *
 * Each cell covering the column — once, in the row it starts in, so a rowspan is
 * handled once — is removed when it only covers that column, or narrowed by one
 * when it spans others too (a title row keeps spanning what is left).
 */
export function planColumnRemoval(rows: GridRow[], column: number): CellChange[] {
  const { placements } = layoutTable(rows)
  const changes: CellChange[] = []
  placements.forEach((own, row) => {
    own.forEach((p, cell) => {
      if (!covers(p, column)) return
      changes.push({ row, cell, colspan: p.span > 1 ? p.span - 1 : null })
    })
  })
  return changes
}

export type ColumnInsertion = {
  /** Cells spanning across the insertion point: widened by one. */
  widen: { row: number; cell: number }[]
  /**
   * New cells: inserted before the row's own cell at `index` (or appended when
   * the index is past the end), styled like the row's cell at `like`.
   */
  insert: { row: number; index: number; like: number | null }[]
}

/**
 * Insert a new logical column so it becomes column `at`.
 *
 * Rows get a new cell at that position; a cell spanning across the insertion
 * point (a title row) is widened instead, so it keeps spanning the table.
 */
export function planColumnInsertion(rows: GridRow[], at: number): ColumnInsertion {
  const { placements } = layoutTable(rows)
  const crosses = (p: Placement) => at > 0 && covers(p, at - 1) && covers(p, at)
  const plan: ColumnInsertion = { widen: [], insert: [] }
  placements.forEach((own, row) => {
    const spanning = own.findIndex(crosses)
    if (spanning !== -1) {
      plan.widen.push({ row, cell: spanning })
      return
    }
    // Covered by a cell spanning down from a row above, which is widened where it starts.
    const fromAbove = placements
      .slice(0, row)
      .some((above, r) => above.some((p) => crosses(p) && r + p.rowspan > row))
    if (fromAbove) return
    const index = own.filter((p) => p.start < at).length
    const leftNeighbour = own.findIndex((p) => at > 0 && covers(p, at - 1))
    const like =
      leftNeighbour !== -1 ? leftNeighbour : own.length > 0 ? Math.max(0, index - 1) : null
    plan.insert.push({ row, index, like })
  })
  return plan
}

// --- Column widths ---------------------------------------------------------

const round1 = (value: number) => Math.round(value * 10) / 10

/** Scale to a 100% total, rounded to 0.1, with the rounding error absorbed by the widest column. */
function toHundred(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (values.length === 0) return []
  if (total <= 0) return toHundred(values.map(() => 1))
  const scaled = values.map((value) => round1((value / total) * 100))
  const residual = round1(100 - scaled.reduce((sum, value) => sum + value, 0))
  if (residual !== 0) {
    const widest = scaled.indexOf(Math.max(...scaled))
    scaled[widest] = round1(scaled[widest]! + residual)
  }
  return scaled
}

/**
 * Column widths that fill the table: exactly `count` entries totalling 100%.
 *
 * Declared widths keep their proportions. Missing or unusable ones share what
 * the declared columns leave (or an average share when they leave nothing), and
 * no column ends up narrower than MIN_COLUMN_PCT while there is room for that.
 */
export function normalizePercents(declared: readonly (number | null)[], count: number): number[] {
  if (count <= 0) return []
  const widths = Array.from({ length: count }, (_, i) => {
    const value = declared[i]
    return value !== null && value !== undefined && Number.isFinite(value) && value > 0
      ? value
      : null
  })
  const sized = widths.filter((value): value is number => value !== null)
  const used = sized.reduce((sum, value) => sum + value, 0)
  const unsized = count - sized.length
  const share =
    unsized === 0
      ? 0
      : sized.length === 0
        ? 100 / count
        : used < 100
          ? Math.max((100 - used) / unsized, MIN_COLUMN_PCT)
          : used / sized.length
  let percents = toHundred(widths.map((value) => value ?? share))
  if (count * MIN_COLUMN_PCT <= 100 && percents.some((value) => value < MIN_COLUMN_PCT)) {
    const narrow = percents.map((value) => value < MIN_COLUMN_PCT)
    const rest = percents.reduce((sum, value, i) => (narrow[i] ? sum : sum + value), 0)
    const room = 100 - MIN_COLUMN_PCT * narrow.filter(Boolean).length
    percents = toHundred(
      percents.map((value, i) => (narrow[i] ? MIN_COLUMN_PCT : (value / rest) * room)),
    )
  }
  return percents
}

/**
 * True when stored widths do not describe `count` sized columns filling the
 * table — a column missing a width, a stale extra entry, or a total that has
 * drifted off 100%. Rounding to the builder's 0.1% is not drift.
 */
export function percentsNeedRepair(declared: readonly (number | null)[], count: number): boolean {
  if (declared.length !== count) return true
  let total = 0
  for (const value of declared) {
    if (value === null || !Number.isFinite(value) || value <= 0) return true
    total += value
  }
  return Math.abs(total - 100) > 0.5
}

/** Widths after deleting column `index`: the others grow in proportion to fill the table. */
export function percentsWithoutColumn(percents: readonly number[], index: number): number[] {
  return normalizePercents(
    percents.filter((_, i) => i !== index),
    percents.length - 1,
  )
}

/** Widths after inserting a column at `at`: it gets an even share, the others shrink in proportion. */
export function percentsWithColumn(percents: readonly number[], at: number): number[] {
  const count = percents.length + 1
  const share = 100 / count
  const scale = (100 - share) / 100
  const next = percents.map((value) => value * scale)
  next.splice(at, 0, share)
  return normalizePercents(next, count)
}

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

/** A table's width after dragging its right edge by `deltaPct` of the width it sits in. */
export function nextTableWidthPct(startPct: number, deltaPct: number): number {
  return round1(Math.min(Math.max(startPct + deltaPct, MIN_TABLE_PCT), 100))
}
