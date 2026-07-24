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

  it('keeps editor navigation and PDF export on the shared AppKit studio', () => {
    expect(studio).toContain('backHref="/reports"')
    expect(studio).toContain('backLabel="Back to reports"')
    expect(studio).toContain('`/reports/definitions/${definition.id}/export?format=pdf`')
  })
})
