import { expect, it, vi, beforeEach } from 'vitest'
const storage = vi.hoisted(() => ({ head: vi.fn(), promote: vi.fn(), remove: vi.fn() }))
vi.mock('@beaconhs/storage', () => ({
  assertTenantObjectKey: vi.fn(),
  headObject: storage.head,
  promoteObject: storage.promote,
  deleteObject: storage.remove,
  newAttachmentKey: () => 'tenant/new-independent-photo.png',
}))
import { withCopiedAttachments } from './copy-attachments'
import type { RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'

const source = {
  id: 'original-photo',
  tenantId: 'tenant',
  kind: 'image',
  r2Key: 'tenant/original-photo.png',
  filename: 'photo.png',
  sizeBytes: 10,
  contentType: 'image/png',
  annotations: [{ type: 'rectangle' }],
  wopiLock: 'old-lock',
  wopiLockExpiresAt: new Date(),
  wopiSaveTicket: 4,
  wopiAppliedTicket: 4,
  createdAt: new Date(),
  updatedAt: new Date(),
}
let inserted: Record<string, unknown>[]
function setup() {
  inserted = []
  const query = {
    from() {
      return this
    },
    where() {
      return this
    },
    limit() {
      return this
    },
    for: async () => [source],
  }
  const tx = {
    select: () => query,
    insert: () => ({
      values: (data: Record<string, unknown>) => {
        inserted.push(data)
        return { returning: async () => [{ id: 'copied-photo' }] }
      },
    }),
  } as unknown as Database
  return {
    tx,
    ctx: {
      tenantId: 'tenant',
      userId: 'copy-author',
      db: async (run: (db: Database) => Promise<unknown>) => run(tx),
    } as RequestContext,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  storage.head.mockResolvedValue({ etag: 'verified-etag', contentLength: 10 })
  storage.promote.mockResolvedValue(undefined)
  storage.remove.mockResolvedValue(undefined)
})
it('clones each referenced file once, rewrites URLs and clears editing locks without changing the original', async () => {
  const { ctx } = setup()
  const result = await withCopiedAttachments(ctx, async (tx, copy) =>
    copy.payload(tx, {
      files: [{ attachmentId: 'original-photo', url: '/old' }],
      sketch: { attachmentId: 'original-photo', scene: { elements: [] } },
    }),
  )
  expect(result.files).toEqual([
    {
      attachmentId: 'copied-photo',
      url: expect.stringContaining('/api/attachments/copied-photo?cap='),
    },
  ])
  expect(result.sketch).toMatchObject({ attachmentId: 'copied-photo', scene: { elements: [] } })
  expect(storage.promote).toHaveBeenCalledOnce()
  expect(inserted[0]).toMatchObject({
    r2Key: 'tenant/new-independent-photo.png',
    uploadedBy: 'copy-author',
    annotations: source.annotations,
  })
  expect(inserted[0]).not.toHaveProperty('id')
  expect(inserted[0]).not.toHaveProperty('wopiLock')
  expect(storage.remove).not.toHaveBeenCalled()
  expect(source.r2Key).toBe('tenant/original-photo.png')
})
it('removes only newly copied objects when the assessment transaction fails', async () => {
  const { ctx } = setup()
  await expect(
    withCopiedAttachments(ctx, async (tx, copy) => {
      await copy.attachment(tx, source.id)
      throw Error('Database rejected copy')
    }),
  ).rejects.toThrow('Database rejected copy')
  expect(storage.remove).toHaveBeenCalledExactlyOnceWith({
    key: 'tenant/new-independent-photo.png',
  })
})
it('refuses to copy an unverifiable source file and leaves storage untouched', async () => {
  const { ctx } = setup()
  storage.head.mockResolvedValue({ etag: 'etag', contentLength: 9 })
  await expect(
    withCopiedAttachments(ctx, (tx, copy) => copy.attachment(tx, source.id)),
  ).rejects.toThrow('could not be verified')
  expect(storage.promote).not.toHaveBeenCalled()
  expect(inserted).toEqual([])
})
