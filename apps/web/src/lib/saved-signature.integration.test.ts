import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => ctx }))
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
const storage = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), head: vi.fn(), remove: vi.fn() }))
vi.mock('@beaconhs/storage', () => ({
  getObject: storage.get,
  putObject: storage.put,
  headObject: storage.head,
  deleteObject: storage.remove,
  newAttachmentKey: (args: { tenantId: string }) =>
    `t/${args.tenantId}/signature/${Math.random().toString(16)}.png`,
}))
import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  people,
  tenants,
  users,
  attachments,
  auditLog,
  storageObjectDeletionOutbox,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { loadMySavedSignature } from './saved-signature'
import { getMySavedSignatureCapture } from './saved-signature-actions'
import {
  clearMySignature,
  saveMySignature,
  saveMySignatureReuseMode,
} from '@/app/(app)/account/actions'
const urls = [process.env.DATABASE_URL!, process.env.SUPERADMIN_DATABASE_URL!]
for (const url of urls)
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw Error('Isolated local database required')
const app = createClient({ url: urls[0], max: 2 }),
  admin = createClient({ url: urls[1], max: 2 })
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  userId = randomUUID(),
  personId = randomUUID(),
  otherPersonId = randomUUID(),
  attachmentId = randomUUID()
let ctx: RequestContext = {
  tenantId,
  userId,
  personId,
  membership: null,
  isSuperAdmin: false,
  permissions: new Set(),
  scopes: [],
  timezone: 'America/Toronto',
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, ctx.tenantId, run),
}
const original = ctx
beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Signature QA' },
    { id: otherTenantId, slug: otherTenantId, name: 'Other signature QA' },
  ])
  await admin.db
    .insert(users)
    .values({ id: userId, name: 'Signer', email: userId + '@example.test' })
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(attachments).values({
      id: attachmentId,
      tenantId,
      kind: 'signature',
      r2Key: `t/${tenantId}/signature/original.png`,
      contentType: 'image/png',
      sizeBytes: 68,
      filename: 'signature.png',
    })
    await tx.insert(people).values({
      id: personId,
      tenantId,
      userId,
      firstName: 'Own',
      lastName: 'Signer',
      signatureAttachmentId: attachmentId,
    })
    await tx
      .insert(people)
      .values({ id: otherPersonId, tenantId, firstName: 'Other', lastName: 'Signer' })
  })
})
beforeEach(async () => {
  ctx = original
  vi.clearAllMocks()
  const bytes = Buffer.from(PNG, 'base64')
  storage.get.mockResolvedValue(bytes)
  storage.put.mockResolvedValue(undefined)
  storage.head.mockResolvedValue({ contentLength: bytes.length, contentType: 'image/png' })
  await ctx.db((tx) =>
    tx
      .update(people)
      .set({ metadata: {}, signatureAttachmentId: attachmentId, status: 'active' })
      .where(eq(people.id, personId)),
  )
})
afterAll(async () => {
  // Production deliberately blocks tenant deletion until storage cleanup drains.
  // These attachments use a mocked object store; drain only this fixture's intents.
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.delete(people)
    await tx.delete(attachments)
    await tx.delete(storageObjectDeletionOutbox)
  })
  await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
  await admin.db.delete(tenants).where(eq(tenants.id, otherTenantId))
  await admin.db.delete(users).where(eq(users.id, userId))
  await app.sql.end()
  await admin.sql.end()
})
it('defaults off and requires the person to enable reuse', async () => {
  expect(await loadMySavedSignature(ctx)).toBeNull()
  expect(await getMySavedSignatureCapture()).toBeNull()
  expect(storage.get).not.toHaveBeenCalled()
  expect(await saveMySignatureReuseMode('manual')).toEqual({ ok: true })
  expect(await loadMySavedSignature(ctx)).toMatchObject({
    mode: 'manual',
    signature: { attachmentId },
  })
  expect(await getMySavedSignatureCapture()).toEqual({
    mode: 'manual',
    dataUrl: 'data:image/png;base64,' + PNG,
  })
  const rows = await ctx.db((tx) =>
    tx.select().from(auditLog).where(eq(auditLog.entityId, personId)),
  )
  expect(rows.some((r) => r.summary === 'Changed own saved signature reuse')).toBe(true)
})
it('refuses another signer, cross-tenant people and impersonated contexts', async () => {
  await saveMySignatureReuseMode('automatic')
  expect(await getMySavedSignatureCapture(otherPersonId)).toBeNull()
  expect(storage.get).not.toHaveBeenCalled()
  expect(
    await loadMySavedSignature({
      ...ctx,
      tenantId: otherTenantId,
      db: (run) => withTenant(app.db, otherTenantId, run),
    }),
  ).toBeNull()
  const impersonation = {
    actor: { userId: 'admin', name: 'Admin', email: 'admin@example.test' },
    tenantId,
    expiresAt: new Date(Date.now() + 60000),
  }
  expect(await loadMySavedSignature({ ...ctx, impersonation })).toBeNull()
  ctx = { ...ctx, impersonation }
  await expect(saveMySignatureReuseMode('automatic')).rejects.toThrow('blocked while impersonating')
})
it('does not reuse inactive people or malformed stored images', async () => {
  await saveMySignatureReuseMode('automatic')
  await ctx.db((tx) => tx.update(people).set({ status: 'inactive' }).where(eq(people.id, personId)))
  expect(await loadMySavedSignature(ctx)).toBeNull()
  await ctx.db((tx) => tx.update(people).set({ status: 'active' }).where(eq(people.id, personId)))
  storage.get.mockResolvedValue(Buffer.from('invalid'))
  await expect(getMySavedSignatureCapture()).rejects.toThrow('declared image type')
})
it('replaces and clears profile ink without deleting prior record evidence', async () => {
  expect(await saveMySignature('data:image/png;base64,' + PNG)).toEqual({ ok: true })
  const [row] = await ctx.db((tx) => tx.select().from(people).where(eq(people.id, personId)))
  expect(row!.signatureAttachmentId).not.toBe(attachmentId)
  expect(await saveMySignatureReuseMode('automatic')).toEqual({ ok: true })
  expect(await clearMySignature()).toEqual({ ok: true })
  expect(await loadMySavedSignature(ctx)).toBeNull()
  const [previous] = await ctx.db((tx) =>
    tx.select().from(attachments).where(eq(attachments.id, attachmentId)),
  )
  expect(previous).toBeDefined()
  expect(storage.remove).not.toHaveBeenCalled()
  expect(await saveMySignatureReuseMode('automatic')).toMatchObject({
    error: 'Save your signature before enabling reuse.',
  })
})
it('rejects unsafe captured images before storage and rejects invalid preference values', async () => {
  expect(await saveMySignature('data:image/svg+xml;base64,PHN2Zz4=')).toHaveProperty('error')
  expect(storage.put).not.toHaveBeenCalled()
  expect(await saveMySignatureReuseMode('anything')).toHaveProperty('error')
})
