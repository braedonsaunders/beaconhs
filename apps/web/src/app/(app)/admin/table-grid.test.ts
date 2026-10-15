import { describe, expect, it } from 'vitest'
import {
  layoutTable,
  MIN_COLUMN_PCT,
  MIN_TABLE_PCT,
  nextColumnPercents,
  nextTableWidthPct,
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
} from './_table-grid'

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10

/** Rows from cell specs: a number is a colspan, `[colspan, rowspan]` adds a rowspan. */
function rows(section: number, ...specs: (number | [number, number])[][]): GridRow[] {
  return specs.map((cells) => ({
    section,
    cells: cells.map((cell) =>
      Array.isArray(cell) ? { colspan: cell[0], rowspan: cell[1] } : { colspan: cell, rowspan: 1 },
    ),
  }))
}

describe('parseSpan', () => {
  it('reads a positive integer and falls back to 1', () => {
    expect(parseSpan('3')).toBe(3)
    expect(parseSpan(2)).toBe(2)
    for (const bad of [undefined, null, '', '0', '-2', 'abc']) expect(parseSpan(bad)).toBe(1)
  })
})

describe('layoutTable', () => {
  it('places cells after colspans and rowspans from above', () => {
    const grid = rows(0, [[1, 2], 2], [1, 1])
    const { placements, occupied } = layoutTable(grid)
    expect(placements[0]).toEqual([
      { start: 0, span: 1, rowspan: 2 },
      { start: 1, span: 2, rowspan: 1 },
    ])
    // Column 0 of the second row is taken by the rowspan above.
    expect(placements[1]!.map((p) => p.start)).toEqual([1, 2])
    expect([...occupied[1]!].sort()).toEqual([0, 1, 2])
  })

  it('stops a rowspan at the end of its thead/tbody/tfoot', () => {
    const grid = [...rows(0, [[1, 3], 1]), ...rows(1, [1, 1])]
    expect(layoutTable(grid).placements[1]!.map((p) => p.start)).toEqual([0, 1])
  })
})

describe('tableColumnCount', () => {
  it('reads plain rows, not a section title that spans the table', () => {
    expect(tableColumnCount(rows(0, [3], [1, 1, 1], [1, 1, 1]))).toBe(3)
  })

  it('ignores a stale title still spanning a deleted column', () => {
    // The state an old single-row delete left behind.
    expect(tableColumnCount(rows(0, [3], [1, 1], [1, 1]))).toBe(2)
  })

  it('takes the widest plain row, so a row missing a cell is the short one', () => {
    expect(tableColumnCount(rows(0, [1, 1], [1, 1, 1]))).toBe(3)
  })

  it('falls back to spanning rows when there are no plain ones', () => {
    expect(tableColumnCount(rows(0, [2, 1], [1, 2]))).toBe(3)
  })

  it('never counts fewer columns than a row has cells', () => {
    expect(tableColumnCount(rows(0, [1, 1], [2, 1, 1]))).toBe(3)
  })

  it('is zero for a table with no cells', () => {
    expect(tableColumnCount([])).toBe(0)
  })
})

describe('planRowFixes', () => {
  it('leaves a consistent table alone', () => {
    expect(planRowFixes(rows(0, [3], [1, 1, 1], [1, 1, 1]), 3)).toEqual([])
  })

  it('pads a row that lost a cell with an empty one', () => {
    expect(planRowFixes(rows(0, [1, 1], [1, 1, 1]), 3)).toEqual([{ row: 0, colspans: [], pad: 1 }])
  })

  it('narrows a title still spanning a deleted column', () => {
    expect(planRowFixes(rows(0, [3], [1, 1], [1, 1]), 2)).toEqual([
      { row: 0, colspans: [{ cell: 0, colspan: 2 }], pad: 0 },
    ])
  })

  it('widens a title rather than padding beside it', () => {
    expect(planRowFixes(rows(0, [2], [1, 1, 1]), 3)).toEqual([
      { row: 0, colspans: [{ cell: 0, colspan: 3 }], pad: 0 },
    ])
  })

  it('never plans to remove a cell', () => {
    for (const fix of planRowFixes(rows(0, [1, 1, 1, 1], [1, 1], [4]), 4)) {
      expect(fix.pad).toBeGreaterThanOrEqual(0)
      for (const { colspan } of fix.colspans) expect(colspan).toBeGreaterThanOrEqual(1)
    }
  })

  it('accounts for a rowspan from the row above', () => {
    // Row 1 has one own cell plus the rowspan: it is full at 2 columns.
    expect(planRowFixes(rows(0, [[1, 2], 1], [1]), 2)).toEqual([])
  })
})

describe('planColumnRemoval', () => {
  it('removes the column from every row and narrows a spanning title', () => {
    expect(planColumnRemoval(rows(0, [3], [1, 1, 1], [1, 1, 1]), 1)).toEqual([
      { row: 0, cell: 0, colspan: 2 },
      { row: 1, cell: 1, colspan: null },
      { row: 2, cell: 1, colspan: null },
    ])
  })

  it('finds the column by position, not by index in the row', () => {
    // Row 1's first own cell sits in column 1 because of the rowspan above.
    expect(planColumnRemoval(rows(0, [[1, 2], 1, 1], [1, 1]), 1)).toEqual([
      { row: 0, cell: 1, colspan: null },
      { row: 1, cell: 0, colspan: null },
    ])
  })

  it('handles a cell spanning down once, where it starts', () => {
    expect(planColumnRemoval(rows(0, [[1, 2], 1], [1]), 0)).toEqual([
      { row: 0, cell: 0, colspan: null },
    ])
  })
})

describe('planColumnInsertion', () => {
  it('adds a cell to every plain row and widens a title spanning the gap', () => {
    expect(planColumnInsertion(rows(0, [3], [1, 1, 1], [1, 1, 1]), 2)).toEqual({
      widen: [{ row: 0, cell: 0 }],
      insert: [
        { row: 1, index: 2, like: 1 },
        { row: 2, index: 2, like: 1 },
      ],
    })
  })

  it('appends after the last column', () => {
    expect(planColumnInsertion(rows(0, [1, 1]), 2)).toEqual({
      widen: [],
      insert: [{ row: 0, index: 2, like: 1 }],
    })
  })

  it('widens a cell spanning down across the gap once, where it starts', () => {
    expect(planColumnInsertion(rows(0, [[2, 2], 1], [1]), 1)).toEqual({
      widen: [{ row: 0, cell: 0 }],
      insert: [],
    })
  })
})

describe('normalizePercents', () => {
  it('rescales widths that no longer fill the table', () => {
    // A colgroup left at [30, 20] after a 50% column was deleted.
    expect(normalizePercents([30, 20], 2)).toEqual([60, 40])
  })

  it('drops stale entries and sizes missing ones', () => {
    expect(normalizePercents([30, 20, 50], 2)).toEqual([60, 40])
    expect(normalizePercents([40, 40], 3)).toEqual([40, 40, 20])
  })

  it('gives unsized columns what the sized ones leave', () => {
    expect(normalizePercents([50, null, null], 3)).toEqual([50, 25, 25])
  })

  it('gives unsized columns an average share when the sized ones leave nothing', () => {
    expect(normalizePercents([60, 40, null], 3)).toEqual([40, 26.7, 33.3])
  })

  it('splits evenly with nothing declared', () => {
    expect(normalizePercents([], 4)).toEqual([25, 25, 25, 25])
  })

  it('always totals exactly 100', () => {
    for (const declared of [
      [33.3, 33.3, 33.3],
      [10, 10, 10],
      [1, 2, 3, 4, 5, 6, 7],
      [99, 99],
    ]) {
      expect(sum(normalizePercents(declared, declared.length))).toBe(100)
    }
  })

  it('keeps every column at least MIN_COLUMN_PCT wide', () => {
    const out = normalizePercents([98, 1, 1], 3)
    expect(Math.min(...out)).toBeGreaterThanOrEqual(MIN_COLUMN_PCT)
    expect(sum(out)).toBe(100)
  })
})

describe('percentsNeedRepair', () => {
  it('accepts widths that fill the table, rounding included', () => {
    expect(percentsNeedRepair([33.3, 33.3, 33.3], 3)).toBe(false)
    expect(percentsNeedRepair([30, 20, 50], 3)).toBe(false)
  })

  it('flags a wrong count, a missing width, or drift', () => {
    expect(percentsNeedRepair([30, 20, 50], 2)).toBe(true)
    expect(percentsNeedRepair([50, null], 2)).toBe(true)
    expect(percentsNeedRepair([30, 20], 2)).toBe(true)
  })
})

describe('column add/delete widths', () => {
  it('deleting a column lets the others grow in proportion to fill the table', () => {
    expect(percentsWithoutColumn([30, 20, 50], 2)).toEqual([60, 40])
    expect(sum(percentsWithoutColumn([25, 25, 25, 25], 0))).toBe(100)
  })

  it('a new column gets an even share and the others shrink in proportion', () => {
    expect(percentsWithColumn([50, 50], 2)).toEqual([33.4, 33.3, 33.3])
    expect(percentsWithColumn([60, 40], 1)).toEqual([40, 33.3, 26.7])
  })
})

// Reported from the app: dragging a column edge "instantly doubles the size of
// the cell and locks it". Two faults fed that — the delta was measured in
// iframe pixels while the pointer moves in page pixels, so the first move
// saturated the clamp; and the drag re-resolved the selection each move, which
// GrapesJS had dropped, so nothing moved afterwards. This pins the arithmetic
// that decides where the boundary lands.
describe('nextColumnPercents', () => {
  it('moves width from the right column to the left one', () => {
    expect(nextColumnPercents([20, 20, 60], 0, 5)).toEqual([25, 15, 60])
  })

  it('moves width the other way on a negative drag', () => {
    expect(nextColumnPercents([20, 20, 60], 0, -5)).toEqual([15, 25, 60])
  })

  it('always totals 100%, whatever the drag', () => {
    for (const delta of [-999, -37, -1, 0, 1, 37, 999]) {
      expect(sum(nextColumnPercents([25, 25, 25, 25], 1, delta))).toBe(100)
    }
  })

  it('never drags a column out of existence', () => {
    const [left, right] = nextColumnPercents([20, 20, 60], 0, 999)
    expect(right).toBeGreaterThanOrEqual(3)
    expect(left).toBeLessThanOrEqual(37)
  })

  it('leaves untouched columns exactly alone', () => {
    const out = nextColumnPercents([10, 30, 40, 20], 1, 12)
    expect(out[0]).toBe(10)
    expect(out[3]).toBe(20)
    expect(out[1]! + out[2]!).toBe(70)
  })

  it('does not jump when the drag has barely moved', () => {
    expect(nextColumnPercents([20, 20, 60], 0, 1)).toEqual([21, 19, 60])
  })

  it('is a no-op at the last boundary or on a pair with no room', () => {
    expect(nextColumnPercents([50, 50], 1, 10)).toEqual([50, 50])
    expect(nextColumnPercents([3, 3, 94], 0, 10)).toEqual([3, 3, 94])
  })
})

describe('nextTableWidthPct', () => {
  it('grows a narrow table back to full width and no further', () => {
    expect(nextTableWidthPct(60, 25)).toBe(85)
    expect(nextTableWidthPct(60, 999)).toBe(100)
  })

  it('never shrinks a table out of sight', () => {
    expect(nextTableWidthPct(60, -999)).toBe(MIN_TABLE_PCT)
  })
})
