import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'

// CONTRACT TEST: a collection table has to survive being split across pages.
//
// Reported from the field on the blank hazard assessment: the PPE manifest ran
// onto a second page and the continuation came out a different shape from the
// first half. Cause was `table-layout: auto` (the default) — a fragmented table
// re-derives its column widths from only the rows that landed on that page, and
// the PPE table left one column unsized, so the two halves disagreed.
//
// Three things keep a long table coherent on paper, and all three are easy to
// lose in an edit:
//   1. table-layout: fixed          — widths stop depending on content
//   2. a <colgroup> of explicit %   — what fixed layout reads first, and the one
//                                     place the designer's resizer writes to
//   3. the header row in <thead>    — so it repeats instead of vanishing

function tables(html: string) {
  const dom = new JSDOM(`<!doctype html><body><div id="root"></div>`)
  const root = dom.window.document.getElementById('root')!
  root.innerHTML = html
  return [...root.querySelectorAll('table')]
}

/** Tables that render a repeating collection — the ones that can run long. */
function collectionTables(html: string) {
  return tables(html).filter((table) => table.querySelector('[data-each]'))
}

describe('PDF templates survive a page break', () => {
  for (const seed of MODULE_PDF_TEMPLATE_SEEDS) {
    describe(seed.key, () => {
      it('lays every long table out fixed, so both halves match', () => {
        for (const table of collectionTables(seed.html)) {
          expect(table.getAttribute('style') ?? '').toContain('table-layout:fixed')
        }
      })

      it('sizes every column explicitly, totalling 100%', () => {
        for (const table of collectionTables(seed.html)) {
          const headerCells = table.querySelectorAll('thead th').length
          // A single-column list (the photo strip) has no columns to hold apart.
          if (headerCells === 0) continue
          const cols = [...table.querySelectorAll('colgroup col')]
          expect(cols.length, 'a colgroup entry per column').toBe(headerCells)

          const total = cols.reduce((sum, col) => {
            const width = /width:\s*([\d.]+)%/.exec(col.getAttribute('style') ?? '')?.[1]
            expect(width, `every column sized in ${seed.key}`).toBeTruthy()
            return sum + Number(width)
          }, 0)
          // Rounding from an even split of the remainder is fine; drift is not.
          expect(Math.abs(total - 100)).toBeLessThan(0.5)
        }
      })

      it('repeats the column headings on each page', () => {
        for (const table of collectionTables(seed.html)) {
          // A bare <tr> of <th> is parsed into <tbody> and does NOT repeat when
          // the table breaks, leaving page two with unlabelled columns. Tables
          // with no headings at all (the photo strip) have nothing to repeat.
          if (table.querySelectorAll('th').length === 0) continue
          expect(table.querySelectorAll('thead tr').length).toBeGreaterThan(0)
          expect(table.querySelectorAll('tbody th').length).toBe(0)
        }
      })
    })
  }
})
