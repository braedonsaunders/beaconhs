import { afterEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type { Component, Editor } from 'grapesjs'
import { nextColumnPercents } from './_table-grid'
import {
  applyColumnPercents,
  columnCount,
  canMoveTableRow,
  moveTableRow,
  fitTableToWidth,
  insertTableColumn,
  insertTableRow,
  normalizeTable,
  normalizeTables,
  readColumnPercents,
  readTable,
  removeTableColumn,
  removeTableRow,
  tableCols,
} from './_table-model'
import { installTableEditing } from './_table-tools'
import { installTemplateComponents } from './_template-components'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { renderTemplate, sanitizeEmailHtml, expandRepeatMarkers } from '@beaconhs/email-render'
import { serializeTemplateEditor } from '@/lib/template-builder-html'

// The table tools against a real GrapesJS document, driven headlessly. The
// arithmetic is pinned in table-grid.test.ts; what goes wrong in the builder is
// how it meets the component tree — a column count read off a title row, a
// delete that left the colgroup behind, widths parked in CSS rules rather than
// inline — and that only shows up against a parsed template.

const TABLE =
  '<table style="width:100%;table-layout:fixed;">' +
  '<colgroup><col style="width:30%" /><col style="width:20%" /><col style="width:50%" /></colgroup>' +
  '<thead>' +
  '<tr data-if="ppe"><td colspan="3">PPE manifest</td></tr>' +
  '<tr data-if="ppe"><th>PPE</th><th>Required</th><th>Answer</th></tr>' +
  '</thead>' +
  '<tbody><tr data-each="ppe"><td>{{name}}</td><td>{{required}}</td><td>&nbsp;</td></tr></tbody>' +
  '<tfoot><tr><td>Total</td><td>{{count}}</td><td>Signed</td></tr></tfoot>' +
  '</table>'

const opened: { editor: Editor; dom: JSDOM }[] = []
afterEach(() => {
  for (const { editor, dom } of opened.splice(0).reverse()) {
    editor.destroy()
    dom.window.close()
  }
})

async function loadEditor(html: string, setup?: (editor: Editor) => void) {
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
  opened.push({ editor, dom })
  setup?.(editor)
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
  return { editor, table }
}

/** Save → reopen as plain HTML, the way the PDF renderer and the HTML tab see it. */
function serialized(editor: Editor) {
  const css = editor.getCss() ?? ''
  const dom = new JSDOM(`<!doctype html><body>${editor.getHtml()}</body>`)
  const table = dom.window.document.querySelector('table')!
  const widthOf = (el: Element) => {
    const id = el.getAttribute('id')
    const rule = id ? new RegExp(`#${id}\\{[^}]*width:([\\d.]+)%`).exec(css)?.[1] : undefined
    const inline = /width:\s*([\d.]+)%/.exec(el.getAttribute('style') ?? '')?.[1]
    return Number(rule ?? inline ?? NaN)
  }
  const cols = [...table.querySelectorAll('colgroup col')]
  const rows = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.children].map((cell) => ({
      text: cell.textContent ?? '',
      tag: cell.tagName.toLowerCase(),
      colspan: Number(cell.getAttribute('colspan') ?? 1),
    })),
  )
  return {
    widths: cols.map(widthOf),
    rows,
    rowWidths: rows.map((cells) => cells.reduce((n, cell) => n + cell.colspan, 0)),
    html: editor.getHtml(),
  }
}

const NBSP = '\u00a0'

const total = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10

describe('column model against a parsed template', () => {
  it('counts columns from the rows, not the colspan title row', async () => {
    const { table } = await loadEditor(TABLE)
    const model = readTable(table)
    expect(model.cols).toHaveLength(3)
    // The first row really does hold one cell — that is the trap.
    expect(model.cells[0]).toHaveLength(1)
    expect(columnCount(model)).toBe(3)
  })

  it('reads the authored widths back', async () => {
    const { table } = await loadEditor(TABLE)
    expect(readColumnPercents(readTable(table))).toEqual([30, 20, 50])
  })

  it('a drag actually changes the stored widths', async () => {
    const { table } = await loadEditor(TABLE)
    const model = readTable(table)
    applyColumnPercents(model, nextColumnPercents(readColumnPercents(model), 0, 10))
    expect(readColumnPercents(readTable(table))).toEqual([40, 10, 50])
  })

  it('falls back to a plain row when a table has no colgroup', async () => {
    const { table } = await loadEditor(
      '<table><tr><td colspan="2">Title</td></tr>' +
        '<tr><th style="width:40%">A</th><th style="width:60%">B</th></tr>' +
        '<tr data-each="x"><td>1</td><td>2</td></tr></table>',
    )
    const model = readTable(table)
    expect(tableCols(table)).toHaveLength(0)
    expect(columnCount(model)).toBe(2)
    expect(readColumnPercents(model)).toEqual([40, 60])
  })
})

describe('deleting a column', () => {
  it('removes the cell from every row — header, repeating, and footer', async () => {
    const { editor, table } = await loadEditor(TABLE)
    expect(removeTableColumn(table, 1)).toBe(true)
    const out = serialized(editor)
    expect(out.rows.map((cells) => cells.map((cell) => cell.text))).toEqual([
      ['PPE manifest'],
      ['PPE', 'Answer'],
      ['{{name}}', NBSP],
      ['Total', 'Signed'],
    ])
    // The title keeps spanning the whole (now narrower) table.
    expect(out.rows[0]![0]!.colspan).toBe(2)
    expect(out.rowWidths).toEqual([2, 2, 2, 2])
  })

  it('removes the colgroup entry and refills the table to 100%', async () => {
    const { editor, table } = await loadEditor(TABLE)
    removeTableColumn(table, 2)
    const out = serialized(editor)
    // The 50% column went; the others keep their 3:2 proportion.
    expect(out.widths).toEqual([60, 40])
    expect(out.widths).toHaveLength(out.rowWidths[1]!)
  })

  it('keeps the repeating-row marker on its row', async () => {
    const { editor, table } = await loadEditor(TABLE)
    removeTableColumn(table, 0)
    expect(serialized(editor).html).toContain('data-each="ppe"')
  })

  it('never deletes the last column', async () => {
    const { editor, table } = await loadEditor(
      '<table><colgroup><col style="width:100%" /></colgroup><tr><td>Only</td></tr></table>',
    )
    expect(removeTableColumn(table, 0)).toBe(false)
    expect(serialized(editor).rows).toEqual([[{ text: 'Only', tag: 'td', colspan: 1 }]])
  })

  it('rescales cell widths on a table without a colgroup', async () => {
    const { editor, table } = await loadEditor(
      '<table style="width:100%"><tr>' +
        '<td style="width:50%">One</td><td style="width:25%">Two</td><td style="width:25%">Three</td>' +
        '</tr></table>',
    )
    removeTableColumn(table, 0)
    expect(readColumnPercents(readTable(table))).toEqual([50, 50])
    expect(serialized(editor).rows[0]!.map((cell) => cell.text)).toEqual(['Two', 'Three'])
  })

  it('deletes the whole column when a cell is deleted with the Delete key or trash icon', async () => {
    const { editor, table } = await loadEditor(TABLE, installTableEditing)
    const header = readTable(table).cells[1]![1]!
    editor.select(header)
    editor.runCommand('core:component-delete')
    const out = serialized(editor)
    expect(out.rows.map((cells) => cells.length)).toEqual([1, 2, 2, 2])
    expect(out.rowWidths).toEqual([2, 2, 2, 2])
    expect(out.widths).toHaveLength(2)
    expect(total(out.widths)).toBe(100)
  })

  it('stops a cell being cloned or dragged out of line', async () => {
    const { table } = await loadEditor(TABLE, installTableEditing)
    const cell = readTable(table).cells[2]![0]!
    expect(cell.get('copyable')).toBe(false)
    expect(cell.get('draggable')).toBe(false)
  })
})

describe('adding a column', () => {
  it('adds a cell to every row, widens the title, and refills to 100%', async () => {
    const { editor, table } = await loadEditor(TABLE)
    insertTableColumn(table, 1)
    const out = serialized(editor)
    expect(out.rowWidths).toEqual([4, 4, 4, 4])
    expect(out.rows[0]![0]!.colspan).toBe(4)
    expect(out.rows[1]!.map((cell) => cell.text)).toEqual(['PPE', 'Column', 'Required', 'Answer'])
    expect(out.rows[1]![1]!.tag).toBe('th')
    expect(out.widths).toHaveLength(4)
    expect(total(out.widths)).toBe(100)
  })
})

describe('rows', () => {
  it('adds a real row of cells, matching the selected row’s columns', async () => {
    const { editor, table } = await loadEditor(TABLE)
    const model = readTable(table)
    insertTableRow(table, model.rows[2]!)
    const out = serialized(editor)
    expect(out.rows).toHaveLength(5)
    expect(out.rows[3]!.map((cell) => cell.tag)).toEqual(['td', 'td', 'td'])
    expect(out.rowWidths).toEqual([3, 3, 3, 3, 3])
    // The copy is static: only the original keeps the repeating marker.
    expect(out.html.match(/data-each/g)).toHaveLength(1)
  })

  it('copies a title row as one cell spanning the table', async () => {
    const { editor, table } = await loadEditor(TABLE)
    insertTableRow(table, readTable(table).rows[0]!)
    const out = serialized(editor)
    expect(out.rows[1]).toEqual([{ text: NBSP, tag: 'td', colspan: 3 }])
  })

  it('removes a row and keeps at least one', async () => {
    const { editor, table } = await loadEditor(
      '<table><tr><td>A</td></tr><tr><td>B</td></tr></table>',
    )
    expect(removeTableRow(table, readTable(table).rows[0]!)).toBe(true)
    expect(removeTableRow(table, readTable(table).rows[0]!)).toBe(false)
    expect(serialized(editor).rows).toEqual([[{ text: 'B', tag: 'td', colspan: 1 }]])
  })

  it('deleting a title cell spanning the table deletes its row', async () => {
    const { editor, table } = await loadEditor(TABLE, installTableEditing)
    editor.select(readTable(table).cells[0]![0]!)
    editor.runCommand('core:component-delete')
    const out = serialized(editor)
    expect(out.rows.map((cells) => cells[0]!.text)).toEqual(['PPE', '{{name}}', 'Total'])
    expect(out.widths).toEqual([30, 20, 50])
  })
})

describe('repairing a table saved in a broken state', () => {
  it('drops a colgroup entry left over from a deleted column, so the table fills the page', async () => {
    // What the old delete saved: cells gone, colgroup and title untouched.
    const { editor, table } = await loadEditor(
      '<table style="width:100%;table-layout:fixed;">' +
        '<colgroup><col style="width:30%" /><col style="width:20%" /><col style="width:50%" /></colgroup>' +
        '<thead><tr><td colspan="3">PPE manifest</td></tr><tr><th>PPE</th><th>Required</th></tr></thead>' +
        '<tbody><tr data-each="ppe"><td>{{name}}</td><td>{{required}}</td></tr></tbody></table>',
    )
    normalizeTable(table)
    const out = serialized(editor)
    expect(out.widths).toEqual([60, 40])
    expect(out.rows[0]![0]!.colspan).toBe(2)
    expect(out.rowWidths).toEqual([2, 2, 2])
  })

  it('pads a row that lost a cell instead of deleting anyone’s content', async () => {
    // What a single-cell delete saved: the header short by one.
    const { editor, table } = await loadEditor(
      '<table style="width:100%;table-layout:fixed;">' +
        '<colgroup><col style="width:30%" /><col style="width:20%" /><col style="width:50%" /></colgroup>' +
        '<thead><tr><th>PPE</th><th>Answer</th></tr></thead>' +
        '<tbody><tr><td>Hard hat</td><td>Yes</td><td>Checked</td></tr></tbody></table>',
    )
    normalizeTable(table)
    const out = serialized(editor)
    expect(out.rows[0]!.map((cell) => cell.tag)).toEqual(['th', 'th', 'th'])
    expect(out.rows[0]!.map((cell) => cell.text)).toEqual(['PPE', 'Answer', NBSP])
    expect(out.rows[1]!.map((cell) => cell.text)).toEqual(['Hard hat', 'Yes', 'Checked'])
    expect(out.widths).toEqual([30, 20, 50])
  })

  it('rescales widths that drifted off 100%', async () => {
    const { editor, table } = await loadEditor(
      '<table style="width:100%;table-layout:fixed;">' +
        '<colgroup><col style="width:30%" /><col style="width:20%" /></colgroup>' +
        '<tr><td>A</td><td>B</td></tr></table>',
    )
    normalizeTable(table)
    expect(serialized(editor).widths).toEqual([60, 40])
  })

  it('leaves a consistent table exactly as it was', async () => {
    const { editor, table } = await loadEditor(TABLE)
    const before = serialized(editor)
    normalizeTables(editor.getWrapper()!)
    normalizeTable(table)
    expect(serialized(editor)).toEqual(before)
  })

  it('survives a save and reopen unchanged once repaired', async () => {
    const { editor, table } = await loadEditor(
      '<table style="width:100%;table-layout:fixed;"><colgroup><col style="width:70%" /></colgroup>' +
        '<tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td></tr></table>',
    )
    normalizeTable(table)
    const saved = `<style>${editor.getCss()}</style>${editor.getHtml()}`
    const first = serialized(editor)
    expect(first.rowWidths).toEqual([3, 3])
    expect(first.rows[1]!.map((cell) => cell.text)).toEqual(['D', NBSP, NBSP])
    expect(total(first.widths)).toBe(100)

    const reopened = await loadEditor(saved)
    normalizeTable(reopened.table)
    const second = serialized(reopened.editor)
    expect(second.rows).toEqual(first.rows)
    expect(second.widths).toEqual(first.widths)
  })
})

describe('fit to width', () => {
  it('stretches a narrow table back to the full width', async () => {
    const { table } = await loadEditor(
      '<table style="width:55%;table-layout:fixed;">' +
        '<colgroup><col style="width:40%" /><col style="width:40%" /></colgroup>' +
        '<tr><td>A</td><td>B</td></tr></table>',
    )
    fitTableToWidth(table)
    expect(table.getStyle().width).toBe('100%')
    expect(readColumnPercents(readTable(table))).toEqual([50, 50])
  })
})

describe('editable record documents', () => {
  const setup = (editor: Editor) => {
    installTemplateComponents(editor)
    installTableEditing(editor)
  }

  it('edits cells as continuous text while keeping movable values and styles on reopen', async () => {
    const { editor, table } = await loadEditor(
      '<table><tr><td>Course</td><td>{{course_name}} ({{course_code}})</td></tr></table>',
      setup,
    )
    const model = readTable(table)
    const label = model.cells[0]![0]!
    expect(label.isInstanceOf('text')).toBe(true)
    expect(label.get('editable')).toBe(true)
    label.components('Session course')
    label.addStyle({ color: '#008080', 'font-size': '18px' })
    const values = model.cells[0]![1]!.components()
      .toArray()
      .filter((c) => c.get('type') === 'record-value')
    expect(values).toHaveLength(2)
    expect(values[0]!.get('draggable')).toBe(true)
    expect(values[0]!.get('editable')).toBe(false)
    expect(values[0]!.get('textable')).toBe(true)
    values[1]!.move(model.cells[0]![0]!)
    const saved = serializeTemplateEditor(editor)
    const reopened = await loadEditor(sanitizeEmailHtml(saved), setup)
    const next = readTable(reopened.table)
    expect(next.cells[0]![0]!.toHTML()).toContain('Session course')
    expect(next.cells[0]![0]!.getStyle().color).toBe('rgb(0, 128, 128)')
    expect(
      next.cells[0]![0]!.components()
        .toArray()
        .some((c) => c.get('type') === 'record-value'),
    ).toBe(true)
    expect(next.cells[0]![1]!.toHTML()).not.toContain('{{course_code}}')
  })

  it('deletes a value without deleting its cell or other rows', async () => {
    const { editor, table } = await loadEditor(
      '<table><tr><td>Course</td><td>{{course_name}}</td></tr><tr><td>Code</td><td>{{course_code}}</td></tr></table>',
      setup,
    )
    editor.select(readTable(table).cells[0]![1]!.components().at(0)!)
    editor.runCommand('core:component-delete')
    expect(readTable(table).cells.map((cells) => cells.length)).toEqual([2, 2])
    expect(editor.getHtml()).not.toContain('{{course_name}}')
    expect(editor.getHtml()).toContain('{{course_code}}')
  })

  it('lets empty and blank existing cells accept typed text', async () => {
    const { table } = await loadEditor('<table><tr><td></td><td>&nbsp;</td></tr></table>', setup)
    for (const cell of readTable(table).cells[0]!) {
      expect(cell.isInstanceOf('text')).toBe(true)
      expect(cell.get('editable')).toBe(true)
    }
  })

  it('new rows and columns also edit as whole cells', async () => {
    const { table } = await loadEditor('<table><tr><td>A</td><td>B</td></tr></table>', setup)
    insertTableRow(table, readTable(table).rows[0]!)
    insertTableColumn(table, 1)
    for (const cells of readTable(table).cells)
      for (const cell of cells) {
        expect(cell.isInstanceOf('text')).toBe(true)
        expect(cell.get('editable')).toBe(true)
      }
  })

  it('preserves separators, line breaks and bindings through rich-text sync, save and rendering', async () => {
    const { editor, table } = await loadEditor(
      '<table><tr><td>{{course_name}}{{course_code}}</td></tr></table>',
      setup,
    )
    const cell = readTable(table).cells[0]![0]!
    expect(cell.isInstanceOf('text')).toBe(true)
    cell.components('{{course_name}}{{course_code}}')
    expect(cell.components().map((component: Component) => component.get('type'))).toEqual([
      'record-value',
      'record-value',
    ])
    // The cell text view reparses its entire content when rich-text editing ends.
    cell.components(
      'Session: <span>{{course_name}}</span> / <span>{{course_code}}</span><br><span data-bhs-caret><strong>Room: \u200b</strong></span><span>{{location}}</span>',
    )
    const reopened = await loadEditor(sanitizeEmailHtml(serializeTemplateEditor(editor)), setup)
    const html = serializeTemplateEditor(reopened.editor)
    const rendered = new JSDOM(
      renderTemplate(html, { course_name: 'MEWP', course_code: '101', location: 'Training room' }),
    )
    expect(rendered.window.document.querySelector('td')!.innerHTML).toContain('<br>')
    expect(rendered.window.document.querySelector('td')!.textContent).toBe(
      'Session: MEWP / 101Room: Training room',
    )
    expect(reopened.editor.getHtml()).not.toContain('contenteditable')
    expect(html).not.toContain('data-bhs-caret')
    expect(html).not.toContain('\u200b')
    expect(rendered.window.document.querySelector('strong')!.textContent).toBe('Room: ')
    rendered.window.close()
  })

  it('keeps nested layout tables out of whole-cell text editing', async () => {
    const { editor, table } = await loadEditor(
      '<table><tr><td><table><tr><td>{{course_name}}</td></tr></table></td></tr></table>',
      setup,
    )
    const outer = readTable(table).cells[0]![0]!
    const inner = outer.findType('cell')[0]!
    const view = editor.DomComponents.getType('cell')!.view.prototype as {
      canActivate: (this: { model: Component; rteEnabled: boolean }) => { result: boolean }
    }
    expect(view.canActivate.call({ model: outer, rteEnabled: false }).result).toBe(false)
    expect(view.canActivate.call({ model: inner, rteEnabled: false }).result).toBe(true)
  })

  it('reorders whole rows within a section and refuses to break rowspans', async () => {
    const { table } = await loadEditor(
      '<table><tr><td>A</td></tr><tr><td>B</td></tr></table>',
      setup,
    )
    const row = readTable(table).rows[1]!
    expect(moveTableRow(table, row, -1)).toBe(true)
    expect(readTable(table).rows[0]).toBe(row)
    expect(canMoveTableRow(table, row, -1)).toBe(false)
    expect(moveTableRow(table, row, 1)).toBe(true)
    expect(readTable(table).rows[1]).toBe(row)
    const spanning = await loadEditor(
      '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>',
      setup,
    )
    expect(moveTableRow(spanning.table, readTable(spanning.table).rows[1]!, -1)).toBe(false)
  })

  for (const seed of MODULE_PDF_TEMPLATE_SEEDS) {
    it(`preserves every binding and control block for ${seed.key}`, async () => {
      const { editor } = await loadEditor(seed.html, setup)
      const bindings = (html: string) =>
        [...html.matchAll(/\{\{\{?[\s\S]*?\}\}\}?/g)].map((m) => m[0]).sort()
      const saved = serializeTemplateEditor(editor)
      expect(bindings(saved)).toEqual(bindings(seed.html))
      const reopened = await loadEditor(sanitizeEmailHtml(saved), setup)
      expect(bindings(serializeTemplateEditor(reopened.editor))).toEqual(bindings(seed.html))
      const data = {
        course_name: 'Safety basics',
        course_code: 'SB-1',
        title: 'Morning session',
        attendee_count: 1,
        attendees: [{ name: 'Test trainee', email: 'trainee@example.com', status: 'Enrolled' }],
      }
      // Parse the compiled output as HTML: a designer round-trip must still fill
      // scalar fields, loop rows, and conditions rather than print token text.
      const output = renderTemplate(expandRepeatMarkers(saved), data)
      expect(output).not.toContain('{{')
      if (seed.key === 'training-class-pdf') {
        expect(output).toContain('Safety basics')
        expect(output).toContain('Test trainee')
      }
    })
  }
})
