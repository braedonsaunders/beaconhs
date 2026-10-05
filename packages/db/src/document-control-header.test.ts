import { describe, expect, it, vi } from 'vitest'
import type { Database } from './client'
import { loadDocumentControlHeaders } from './document-control-header'

const metadata = {
  id: 'doc',
  title: 'Procedure',
  key: 'PROC-1',
  category: 'Safety',
  type: 'Procedure',
  status: 'published',
  headerIssuedOn: null,
  headerRevisedOn: null,
  headerApprovedBy: null,
  headerVersionLabel: null,
}
function database(rows: unknown[][]): Pick<Database, 'select'> {
  const select = vi.fn(() => {
    const result = Promise.resolve(rows.shift() ?? [])
    const query = {
      from: () => query,
      leftJoin: () => query,
      innerJoin: () => query,
      where: () => query,
      orderBy: () => result,
      then: result.then.bind(result),
    }
    return query
  })
  return { select } as unknown as Pick<Database, 'select'>
}
const versions = [
  { documentId: 'doc', version: 1.1, publishedAt: new Date('2025-05-01T15:00:00Z') },
  { documentId: 'doc', version: 2, publishedAt: new Date('2026-10-05T15:00:00Z') },
]

describe('document control facts', () => {
  it('prints the latest published version instead of Draft, with first issue and latest revision dates', async () => {
    const header = (
      await loadDocumentControlHeaders(database([[metadata], versions, []]), 'tenant', ['doc'])
    ).get('doc')
    expect(header).toMatchObject({
      version: 2,
      issuedAt: '2025-05-01T15:00:00.000Z',
      revisedAt: '2026-10-05T15:00:00.000Z',
    })
  })
  it('uses editable header facts and preserves a custom printed revision', async () => {
    const row = {
      ...metadata,
      headerIssuedOn: '2024-01-01',
      headerRevisedOn: '2026-09-01',
      headerApprovedBy: 'Peter Kazmierczak',
      headerVersionLabel: 'Rev B',
    }
    const header = (
      await loadDocumentControlHeaders(database([[row], versions, []]), 'tenant', ['doc'])
    ).get('doc')
    expect(header).toMatchObject({
      version: 'Rev B',
      issuedAt: '2024-01-01',
      revisedAt: '2026-09-01',
      approvedBy: 'Peter Kazmierczak',
    })
  })
  it('keeps unpublished changes labelled Draft and derives approvers only when no override is entered', async () => {
    const tx = database([
      [{ ...metadata, status: 'draft' }],
      versions,
      [{ documentId: 'doc', participants: ['member'] }],
      [
        {
          id: 'member',
          displayName: 'Reviewer',
          name: 'Account name',
          email: 'member@example.com',
        },
      ],
    ])
    const header = (await loadDocumentControlHeaders(tx, 'tenant', ['doc'])).get('doc')
    expect(header).toMatchObject({ version: 'Draft', approvedBy: 'Reviewer' })
  })
})
