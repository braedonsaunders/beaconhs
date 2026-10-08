import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentBookPublicationError } from '@beaconhs/db'
const mocks = vi.hoisted(() => ({ publish: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  requireRequestContext: async () => ({
    isSuperAdmin: false,
    permissions: new Set(['documents.manage']),
    db: async (run: (tx: unknown) => Promise<unknown>) => run({}),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: vi.fn() }))
vi.mock('@/lib/document-book-lifecycle', () => ({
  publishDocumentBook: mocks.publish,
  unpublishDocumentBook: vi.fn(),
  lockDraftDocumentBook: vi.fn(),
  livePublishedDocumentIds: vi.fn(),
}))
import { publishBookAction } from './actions'
const id = '10000000-0000-4000-8000-000000000001'
beforeEach(() => vi.clearAllMocks())
describe('book publication action boundary', () => {
  it('returns expected publication failures intact across the production server boundary', async () => {
    mocks.publish.mockRejectedValue(
      new DocumentBookPublicationError('"Overtime" must be published first.'),
    )
    expect(await publishBookAction(id)).toEqual({
      ok: false,
      error: '"Overtime" must be published first.',
    })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('does not disguise infrastructure failures as validation or success', async () => {
    mocks.publish.mockRejectedValue(new Error('Connection lost'))
    await expect(publishBookAction(id)).rejects.toThrow('Connection lost')
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('refreshes both book views only after successful atomic publication', async () => {
    mocks.publish.mockResolvedValue(undefined)
    expect(await publishBookAction(id)).toEqual({ ok: true })
    expect(mocks.revalidate.mock.calls).toEqual([[`/documents/books/${id}`], ['/documents/books']])
  })
})
