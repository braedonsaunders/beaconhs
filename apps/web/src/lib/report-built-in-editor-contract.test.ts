import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const hubPreview = readFileSync(
  new URL('../app/(app)/reports/_hub/preview-pane.tsx', import.meta.url),
  'utf8',
)
const viewer = readFileSync(
  new URL('../app/(app)/reports/definitions/[id]/page.tsx', import.meta.url),
  'utf8',
)
const editor = readFileSync(
  new URL('../app/(app)/reports/definitions/[id]/edit/page.tsx', import.meta.url),
  'utf8',
)
const newReport = readFileSync(
  new URL('../app/(app)/reports/definitions/new/page.tsx', import.meta.url),
  'utf8',
)

describe('built-in report execution contract', () => {
  it('uses the full viewer row cap in both catalogue and report previews', () => {
    expect(hubPreview).toContain('runReportForViewer(ctx, definition)')
    expect(hubPreview).toContain('DOCUMENT_PREVIEW_MAX_ROWS')
    expect(hubPreview).not.toContain('HUB_PREVIEW_MAX_ROWS')
  })

  it('never presents a best-effort custom query as an edit of a built-in report', () => {
    expect(hubPreview).toContain("canBuild && definition.kind === 'custom'")
    expect(viewer).toContain('const editHref = isCustom ? `/reports/definitions/${id}/edit` : null')
    expect(editor).toContain('redirect(`/reports/definitions/${id}` as never)')
    expect(newReport).toContain("if (requestedClone?.kind === 'built_in')")
    expect(newReport).not.toContain('builtInSeedQuery')
  })
})
