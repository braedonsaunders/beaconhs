import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('people directory primary-title contract', () => {
  it('projects, searches, sorts, and renders the canonical primary title', () => {
    const page = source('./page.tsx')
    const table = source('./_records-table.tsx')

    expect(page).toContain('primaryPersonTitleName(people.id, people.tenantId)')
    expect(page).toContain('ilike(primaryTitleName, term)')
    expect(page).toContain("params.sort === 'title'")
    expect(page).toContain('primaryTitleName,')
    expect(table).toContain('<SortTh column="title"')
    expect(table).toContain('Primary job title')
    expect(table).toContain("{r.primaryTitleName ?? '—'}")
  })

  it('keeps the matching CSV export and user guide truthful', () => {
    const csv = source('./export.csv/route.ts')
    const manual = source('../../../lib/manual/content/oversight-admin.ts')

    expect(csv).toContain('primaryPersonTitleName(people.id, people.tenantId)')
    expect(csv).toContain('ilike(primaryTitleName, term)')
    expect(csv).toContain("params.sort === 'title'")
    expect(csv).toContain("'Primary job title'")
    expect(csv).toContain("r.primaryTitleName ?? ''")
    expect(manual).toContain('**Search by name, employee #, or job title**')
    expect(manual).toContain('Click **Create person**')
  })
})
