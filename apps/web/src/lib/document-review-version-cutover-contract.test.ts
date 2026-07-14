import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('document review version cutover contract', () => {
  it('records periodic reviews against the locked latest published version', () => {
    const page = source('../app/(app)/documents/[id]/page.tsx')
    expect(page).toContain(".for('update')")
    expect(page).toContain('isNotNull(documentVersions.publishedAt)')
    expect(page).toContain('documentVersionId: reviewedVersion.id')
    expect(page).toContain("status: 'completed'")
    expect(page).toContain('Publish the document before recording a periodic review.')
    expect(page).toContain("'outcome not recorded'")
    expect(page).toContain('v{row.documentVersion}')
  })

  it('pins management-review selections transactionally instead of storing document-id JSON', () => {
    const actions = source('../app/(app)/documents/management-reviews/[id]/actions.ts')
    const detail = source('../app/(app)/documents/management-reviews/[id]/page.tsx')
    expect(actions).toContain("eq(documents.status, 'published')")
    expect(actions).toContain(".for('update')")
    expect(actions).toContain('documentVersionId: pin.id')
    expect(actions).toContain('.delete(documentManagementReviewDocuments)')
    expect(actions).toContain('recordAuditInTransaction')
    expect(detail).toContain('.from(documentManagementReviewDocuments)')
    expect(detail).toContain('v{d.version}')
    expect(actions).not.toContain('documentsReviewed: docIds')
  })

  it('does not preselect an approval outcome', () => {
    const drawer = source('../app/(app)/documents/[id]/_drawers.tsx')
    expect(drawer).toContain("| 'approved_no_change'")
    expect(drawer).toContain("useState<'' | 'approved_no_change' | 'updated' | 'retired'>('')")
    expect(drawer).toContain('Choose an outcome…')
    expect(drawer).toContain("setError('Choose the review outcome.')")
  })
})
