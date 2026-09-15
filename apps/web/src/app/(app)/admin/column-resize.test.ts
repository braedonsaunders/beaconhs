import { describe, expect, it } from 'vitest'
import { nextColumnPercents } from './_column-resize'

// Reported from the app: dragging a column edge "instantly doubles the size of
// the cell and locks it". Two faults fed that — the delta was measured in
// iframe pixels while the pointer moves in page pixels, so the first move
// saturated the clamp; and the drag re-resolved the selection each move, which
// GrapesJS had dropped, so nothing moved afterwards. This pins the arithmetic
// that decides where the boundary lands.

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10

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
    // The symptom: a tiny pointer move must produce a tiny change, not a jump
    // to the clamp. A 1% drag on a 20% column lands at 21, never at 37.
    expect(nextColumnPercents([20, 20, 60], 0, 1)).toEqual([21, 19, 60])
  })

  it('is a no-op at the last boundary or on a pair with no room', () => {
    expect(nextColumnPercents([50, 50], 1, 10)).toEqual([50, 50])
    expect(nextColumnPercents([3, 3, 94], 0, 10)).toEqual([3, 3, 94])
  })
})

// --- Against a real GrapesJS document -------------------------------------
//
// The arithmetic above was already right when the drag was broken. What was
// wrong was the COLUMN COUNT: it came from the first row, and a collection
// table opens with a section title spanning every column, so the count was 1
// and every drag became a no-op. That only shows up against a real parsed
// document, so this drives GrapesJS headlessly.

import { JSDOM } from 'jsdom'
import { applyColumnPercents, columnCount, readColumnPercents, tableCols } from './_column-resize'
import type { Component } from 'grapesjs'

const TABLE =
  '<table style="width:100%;table-layout:fixed;">' +
  '<colgroup><col style="width:30%" /><col style="width:20%" /><col style="width:50%" /></colgroup>' +
  '<thead>' +
  '<tr data-if="ppe"><td colspan="3">PPE manifest</td></tr>' +
  '<tr data-if="ppe"><th>PPE</th><th>Required</th><th>Answer</th></tr>' +
  '</thead>' +
  '<tr data-each="ppe"><td>{{name}}</td><td>{{required}}</td><td>&nbsp;</td></tr>' +
  '</table>'

async function loadTable(html: string) {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'Element',
    'Node',
    'DocumentFragment',
    'getComputedStyle',
    'MutationObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'DOMParser',
    'XMLSerializer',
    'Event',
    'CustomEvent',
  ]) {
    try {
      ;(globalThis as Record<string, unknown>)[key] =
        key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
    } catch {
      /* jsdom exposes some globals as getters; those are already usable. */
    }
  }
  const grapesjs = (await import('grapesjs')).default
  const editor = grapesjs.init({ headless: true, storageManager: false })
  editor.setComponents(html)

  const find = (cmp: Component): Component | null => {
    if (String(cmp.get('tagName')) === 'table') return cmp
    for (const child of cmp.components().toArray()) {
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  const table = find(editor.getWrapper()!)!
  const rows: Component[] = []
  const collect = (node: Component) => {
    node.components().forEach((child: Component) => {
      const tag = String(child.get('tagName'))
      if (tag === 'tr') rows.push(child)
      else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') collect(child)
    })
  }
  collect(table)
  return { editor, table, rows, cols: tableCols(table) }
}

describe('column model against a parsed template', () => {
  it('counts columns from the colgroup, not the colspan title row', async () => {
    const { table, rows, cols } = await loadTable(TABLE)
    expect(cols).toHaveLength(3)
    // The first row really does hold one cell — that is the trap.
    expect(rows[0]!.components().length).toBe(1)
    expect(columnCount(cols, rows)).toBe(3)
    expect(tableCols(table)).toHaveLength(3)
  })

  it('reads the authored widths back', async () => {
    const { rows, cols } = await loadTable(TABLE)
    expect(readColumnPercents(cols, rows)).toEqual([30, 20, 50])
  })

  it('a drag actually changes the stored widths', async () => {
    const { rows, cols } = await loadTable(TABLE)
    const before = readColumnPercents(cols, rows)
    applyColumnPercents({ cols, rows }, nextColumnPercents(before, 0, 10))
    expect(readColumnPercents(cols, rows)).toEqual([40, 10, 50])
  })

  it('falls back to the widest row when a table has no colgroup', async () => {
    const { rows, cols } = await loadTable(
      '<table><tr><td colspan="2">Title</td></tr>' +
        '<tr><th style="width:40%">A</th><th style="width:60%">B</th></tr>' +
        '<tr data-each="x"><td>1</td><td>2</td></tr></table>',
    )
    expect(cols).toHaveLength(0)
    expect(columnCount(cols, rows)).toBe(2)
    expect(readColumnPercents(cols, rows)).toEqual([40, 60])
  })
})
