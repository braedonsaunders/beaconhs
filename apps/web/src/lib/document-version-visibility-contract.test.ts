import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('document version visibility contract', () => {
  it.each([
    ['document PDF pane', '../app/(app)/documents/[id]/_actions.ts'],
    ['assistant text and vision reader', './assistant/document-content.ts'],
    ['assistant human reader', '../app/(app)/assistant/_document-reader-actions.ts'],
  ])('%s uses the shared published-version boundary', (_label, relativePath) => {
    const content = source(relativePath)
    expect(content).toContain('documentVersionVisibilityWhere(')
    expect(content).toContain("can(ctx, 'documents.manage')")
  })

  it('publishes and audits an uploaded PDF atomically after validating the latest version', () => {
    const page = source('../app/(app)/documents/[id]/page.tsx')
    const start = page.indexOf('async function publishFileDocument')
    const end = page.indexOf('\nasync function unpublish', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const action = page.slice(start, end)
    expect(action).toContain(".for('update')")
    expect(action).toContain('assertUploadedDocumentPdf(attachment)')
    expect(action).toContain('recordAuditInTransaction(tx, ctx')
    expect(action).not.toContain('recordAudit(ctx')
  })

  it.each([
    ['global search', '../app/api/search/route.ts'],
    ['public REST reads', './api/query.ts'],
  ])('%s uses the shared document visibility boundary', (_label, relativePath) => {
    expect(source(relativePath)).toContain('documentReadFilter(ctx)')
  })

  it('does not offer a metadata-only bulk publication shortcut', () => {
    const actions = source('../app/(app)/documents/_actions.ts')
    const bulkBar = source('../app/(app)/documents/_bulk-bar.tsx')
    expect(actions).not.toContain('bulkPublishDocuments')
    expect(bulkBar).not.toContain('value="publish"')
  })

  it.each([
    ['document UI actions', '../app/(app)/documents/_actions.ts'],
    ['public REST mutations', './api/write.ts'],
  ])('%s uses the canonical compliance-aware deletion policy', (_label, relativePath) => {
    expect(source(relativePath)).toContain('softDeleteDocumentsInTransaction(')
  })

  it('keeps public REST metadata updates out of the publication lifecycle', () => {
    const write = source('./api/write.ts')
    const start = write.indexOf('const documentCreate')
    const end = write.indexOf('// --- equipment', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const documentApi = write.slice(start, end)
    expect(documentApi).not.toContain('status: z.enum(documentStatus.enumValues)')
    expect(documentApi).not.toContain("hasOwn(b, 'status')")
    expect(documentApi).not.toContain('Legacy/freeform category label')
  })

  it('records acknowledgments only through the published-version signature saga', () => {
    const actions = source('../app/(app)/documents/[id]/_ack-actions.ts')
    expect(actions).toContain("eq(documents.status, 'published')")
    expect(actions).toContain('withStoredSignatureAttachment(')
    expect(actions).toContain('recordAuditInTransaction(tx, ctx')
    expect(actions).not.toContain('recordAudit(ctx')
    expect(existsSync(new URL('./upload-signature.ts', import.meta.url))).toBe(false)
  })

  it('emails only a downloadable published PDF version', () => {
    const email = source('../app/(app)/documents/[id]/_send-email.ts')
    expect(email).toContain("eq(documents.status, 'published')")
    expect(email).toContain('isNotNull(documentVersions.publishedAt)')
    expect(email).toContain('publishedVersion.v.pdfAttachmentId')
    expect(email).toContain('publishedVersion.v.contentAttachmentId')
    expect(email).toContain('const cc = uniqueEmails(options?.cc ?? [])')
  })
})
