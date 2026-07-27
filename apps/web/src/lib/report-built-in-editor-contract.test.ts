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
const studioActions = readFileSync(
  new URL('../app/(app)/reports/_studio/actions.ts', import.meta.url),
  'utf8',
)
const deleteButton = readFileSync(
  new URL('../app/(app)/reports/_delete-report-button.client.tsx', import.meta.url),
  'utf8',
)
const newReport = readFileSync(
  new URL('../app/(app)/reports/definitions/new/page.tsx', import.meta.url),
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

  it('navigates a newly persisted report without catching a Next redirect as a save error', () => {
    expect(studioActions).not.toContain("from 'next/navigation'")
    expect(studioActions).not.toContain('redirect(')
    expect(studioActions).toContain('id: definitionId')
    expect(studio).toContain('onSaved=')
    expect(studio).toContain('router.replace(')
    expect(newReport).toContain('existingNames.has(defaultName)')
  })

  it('deletes definitions and dependent schedules through one audited tenant transaction', () => {
    expect(studioActions).toContain('export async function deleteReportDefinition')
    expect(studioActions).toContain('.delete(reportSchedules)')
    expect(studioActions).toContain('.delete(reportDefinitions)')
    expect(studioActions).toContain("action: 'delete'")
    expect(studioActions).toContain("revalidatePath('/reports/schedules')")
    expect(studio).toContain('onDelete=')
    expect(studio).toContain('onDeleted=')
    expect(studio).toContain("router.replace('/reports')")
    expect(list).toContain('<DeleteReportButton')
    expect(deleteButton).toContain('confirmDialog')
    expect(deleteButton).toContain('deleteReportDefinition(id)')
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
