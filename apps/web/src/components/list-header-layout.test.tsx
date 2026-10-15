import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
}))
vi.mock('./search-input', () => ({
  SearchInput: ({ placeholder }: { placeholder: string }) => <input placeholder={placeholder} />,
}))

const { PageHeader } = await import('@beaconhs/ui')
const { TableToolbar } = await import('./table-toolbar')
const { SearchInput } = await import('./search-input')

/** Stand-in for the app's value-only translation wrapper. */
function Value({ value }: { value: ReactNode }) {
  return <>{value}</>
}

describe('list page header on phones', () => {
  it('keeps the last action on the title row and folds the rest behind More', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Hazard assessments"
        actions={
          <div className="flex gap-2">
            <button type="button">Print blank</button>
            <Value value={<button type="button">New assessment</button>} />
          </div>
        }
      />,
    )
    const more = html.indexOf('aria-label="More actions"')
    const secondary = html.indexOf('Print blank')
    const primary = html.indexOf('New assessment')
    expect(more).toBeGreaterThan(-1)
    // Secondary actions render once, hidden on phones until More is tapped.
    expect(html.match(/Print blank/g)).toHaveLength(1)
    expect(html.slice(html.lastIndexOf('<div', secondary), secondary)).toContain('hidden')
    expect(primary).toBeGreaterThan(secondary)
  })

  it('drops permission-gated nulls and shows no More button for a single action', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="People"
        actions={
          <div>
            <Value value={null} />
            <Value value={<button type="button">Add person</button>} />
          </div>
        }
      />,
    )
    expect(html).toContain('Add person')
    expect(html).not.toContain('More actions')
  })

  it('gives search its own row and puts every filter in one scrolling row, ranges last', () => {
    const html = renderToStaticMarkup(
      <TableToolbar trailing={<button type="button">Columns</button>}>
        <form>
          <input name="dateFrom" />
        </form>
        <button type="button">Type</button>
        <SearchInput placeholder="Search…" />
        <button type="button">Status</button>
      </TableToolbar>,
    )
    const search = html.indexOf('placeholder="Search…"')
    const row = html.indexOf('overflow-x-auto')
    expect(search).toBeGreaterThan(-1)
    expect(row).toBeGreaterThan(search)
    const order = ['>Type<', '>Status<', 'name="dateFrom"', '>Columns<'].map((s) => html.indexOf(s))
    expect(order.every((index) => index > row)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
