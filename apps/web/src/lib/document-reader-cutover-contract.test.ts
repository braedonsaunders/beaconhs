import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_ROLES } from '@beaconhs/db/schema'

const web = (relative: string) => readFileSync(resolve(import.meta.dirname, '..', relative), 'utf8')

describe('document reader cutover', () => {
  it('sends readers to a dedicated page instead of the authoring workspace', () => {
    const detail = web('app/(app)/documents/[id]/page.tsx')
    const reader = web('app/(app)/documents/[id]/read/page.tsx')
    const grid = web('app/(app)/documents/_read-only-grid.tsx')
    const panel = web('app/(app)/documents/[id]/_acknowledgments-panel.tsx')
    const resolveLink = web('app/(app)/compliance/_resolve-link.ts')

    expect(detail).toContain('redirect(`/documents/${id}/read`)')
    expect(reader).toContain('DocumentReader')
    expect(grid).toContain('href={`/documents/${d.id}/read`}')
    expect(resolveLink).toContain('`/documents/${ref.documentId}/read`')
    expect(panel).not.toContain('acknowledgeDocument')
    expect(panel).toContain('SignatureEvidence')
  })

  it('lets field supervisors and safety managers acknowledge their own reading', () => {
    expect(BUILTIN_ROLES.foreman?.permissions).toContain('documents.acknowledge')
    expect(BUILTIN_ROLES.safety_manager?.permissions).toContain('documents.acknowledge')
    expect(BUILTIN_ROLES.worker?.permissions).toContain('documents.acknowledge')
  })
})
