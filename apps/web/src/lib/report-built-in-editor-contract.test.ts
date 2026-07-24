import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const list = readFileSync(new URL('../app/(app)/reports/page.tsx', import.meta.url), 'utf8')
const definitions = readFileSync(
  new URL('../app/(app)/reports/_definitions.ts', import.meta.url),
  'utf8',
)
const viewer = readFileSync(
  new URL('../app/(app)/reports/_viewer/viewer.client.tsx', import.meta.url),
  'utf8',
)
const editor = readFileSync(
  new URL('../app/(app)/reports/definitions/[id]/edit/page.tsx', import.meta.url),
  'utf8',
)
const studio = readFileSync(
  new URL('../app/(app)/reports/_studio/studio.client.tsx', import.meta.url),
  'utf8',
)
const backLink = readFileSync(
  new URL('../app/(app)/reports/_back-link.tsx', import.meta.url),
  'utf8',
)
const runPage = readFileSync(
  new URL('../app/(app)/reports/definitions/[id]/page.tsx', import.meta.url),
  'utf8',
)
const reportCatalog = readFileSync(new URL('./report-catalog.ts', import.meta.url), 'utf8')
const reportRun = readFileSync(new URL('../app/(app)/reports/_run.ts', import.meta.url), 'utf8')

describe('unified AppKit report contract', () => {
  it('has no list-side alternate preview or built-in/custom execution branch', () => {
    expect(list).toContain('loadVisibleDefinitions')
    expect(list).not.toContain('preview-pane')
    expect(list).not.toMatch(/\bkind\b/)
    expect(definitions).not.toContain('queryKind')
    expect(definitions).not.toContain('customQuery')
  })

  it('makes every authorized definition editable through the AppKit studio', () => {
    expect(viewer).toContain('href={`/reports/definitions/${definition.id}/edit`}')
    expect(viewer).not.toContain('definition.kind')
    expect(editor).toContain('BeaconReportStudio')
    expect(editor).not.toContain('built_in')
  })

  it('uses one runtime filter and grouping state for preview and export', () => {
    expect(viewer).toContain('runReportWithControls')
    expect(viewer).toContain("params.set('filters', JSON.stringify(activeFilters))")
    expect(viewer).toContain("params.set('groupBy', groupBy)")
    expect(viewer).toContain("tGenerated('m_1df37ea02bdc43')")
  })

  it('keeps route navigation in the host shell and PDF export in the AppKit studio', () => {
    expect(backLink).toContain('SmartBackLink')
    expect(backLink).toContain('href="/reports"')
    expect(backLink).not.toContain('<a')
    expect(editor).toContain('<ReportsBackLink />')
    expect(runPage).toContain('<ReportsBackLink />')
    expect(studio).not.toContain('backHref')
    expect(studio).toContain('`/reports/definitions/${definition.id}/export?format=pdf`')
  })

  it('uses the same authorized source inventory as Insights, including scoped Builder apps', () => {
    expect(reportCatalog).toContain('resolveAnalyticsAccess(ctx, tx)')
    expect(reportCatalog).toContain('loadBeaconReportCatalog(tx, access.entities)')
    expect(editor).toContain('loadAuthorizedReportCatalog(ctx)')
    expect(runPage).toContain('loadAuthorizedReportCatalog(ctx)')
    expect(reportRun).toContain('loadAuthorizedReportCatalogInTransaction(ctx, tx)')
    expect(editor).not.toContain('loadBeaconReportCatalog')
    expect(runPage).not.toContain('loadBeaconReportCatalog')
  })
})
