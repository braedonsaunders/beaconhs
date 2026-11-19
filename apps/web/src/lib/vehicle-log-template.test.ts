import { describe, expect, it } from 'vitest'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { findTableStructureBlockHelpers } from '@beaconhs/email-render'
import { compileBuilderHtml } from './template-builder-compile'

const seed = MODULE_PDF_TEMPLATE_SEEDS.find((template) => template.key === 'vehicle-log-month-pdf')!

/** The day-by-day tables (the letterhead is a table too). */
function logTables(html: string): string[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)]
    .map(([table]) => table)
    .filter((table) => table.includes('entries'))
}

/** Header labels and the cells of the first repeating row, for each table. */
function tables(html: string) {
  return logTables(html).map((table) => {
    const headers = [...table.matchAll(/<th\b/g)].length
    const each = table.indexOf('{{#each entries}}')
    const row = table.slice(each, table.indexOf('</tr>', each))
    return { headers, cells: [...row.matchAll(/<td\b/g)].length, row }
  })
}

describe('vehicle log PDF template', () => {
  it('keeps one cell per column per day after the editor’s save compile', () => {
    // Saving from the PDF editor re-parses the template as HTML; block helpers
    // between cells used to be hoisted out of the table, doubling every row.
    const { html, errors } = compileBuilderHtml(seed.html)
    expect(errors).toEqual([])
    expect(html).not.toContain('is_weekend')
    const [odometer, destinations] = tables(html)
    expect(odometer).toMatchObject({ headers: 5, cells: 5 })
    expect(destinations).toMatchObject({ headers: 6, cells: 6 })
    expect(destinations!.row).toContain('bgcolor="{{row_shade}}"')
  })

  it('gives the customer / site column the room and keeps day and km columns narrow', () => {
    const destinations = logTables(seed.html)[1]!
    const widths = [...destinations.matchAll(/<col style="width:(\d+(?:\.\d+)?)%"/g)].map((m) =>
      Number(m[1]),
    )
    expect(widths).toEqual([9, 34, 21, 12, 12, 12])
  })

  it('keeps every built-in PDF template editable without losing table structure', () => {
    for (const template of MODULE_PDF_TEMPLATE_SEEDS) {
      expect({ key: template.key, stray: findTableStructureBlockHelpers(template.html) }).toEqual({
        key: template.key,
        stray: [],
      })
    }
  })

  it('refuses to save template HTML with block helpers between table cells', () => {
    const { errors } = compileBuilderHtml(
      '<table><tr>{{#if is_weekend}}<td>a</td>{{else}}<td>b</td>{{/if}}</tr></table>',
    )
    expect(errors[0]).toContain('{{#if is_weekend}} sits between table cells')
  })
})
