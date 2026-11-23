import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  requireRequestContext: async () => ctx,
  requireExportContext: async () => ctx,
}))
import { and, eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  attachments,
  auditLog,
  equipmentItems,
  storageObjectDeletionOutbox,
  tenants,
  users,
} from '@beaconhs/db/schema'
import { newTenantObjectKey } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { setEquipmentPhoto } from './_actions'

const url = process.env.DATABASE_URL,
  adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl])
  if (!value || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Equipment photo tests require an isolated localhost database')
const app = createClient({ url, max: 2 }),
  admin = createClient({ url: adminUrl, max: 1 })
const tenantId = randomUUID(),
  otherId = randomUUID(),
  userId = randomUUID(),
  itemId = randomUUID(),
  photoId = randomUUID(),
  documentId = randomUUID(),
  foreignPhotoId = randomUUID()
const manager: RequestContext = {
  tenantId,
  userId,
  membership: null,
  personId: null,
  isSuperAdmin: false,
  permissions: new Set(['equipment.manage', 'equipment.read.all']),
  scopes: [],
  timezone: 'America/Toronto',
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, tenantId, run),
}
let ctx: RequestContext = manager

const attachment = (id: string, tenant: string, kind: 'image' | 'document') => ({
  id,
  tenantId: tenant,
  kind,
  r2Key: newTenantObjectKey({ tenantId: tenant, scope: 'equipment/photos', filename: 'unit.jpg' }),
  contentType: kind === 'image' ? 'image/jpeg' : 'application/pdf',
  sizeBytes: 1024,
  filename: kind === 'image' ? 'unit.jpg' : 'manual.pdf',
})

beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Equipment photo tests' },
    { id: otherId, slug: otherId, name: 'Other tenant' },
  ])
  await admin.db
    .insert(users)
    .values({ id: userId, email: `${userId}@example.com`, name: 'Photo tester' })
  await admin.db
    .insert(attachments)
    .values([
      attachment(photoId, tenantId, 'image'),
      attachment(documentId, tenantId, 'document'),
      attachment(foreignPhotoId, otherId, 'image'),
    ])
  await manager.db((tx) =>
    tx.insert(equipmentItems).values({
      id: itemId,
      tenantId,
      name: 'Telehandler',
      assetTag: 'TH-1',
      qrToken: randomUUID(),
    }),
  )
})

afterAll(async () => {
  // Production blocks tenant deletion until storage cleanup drains; these
  // fixtures never reached an object store, so drain only their intents.
  for (const tenant of [tenantId, otherId])
    await withTenant(app.db, tenant, async (tx) => {
      await tx.delete(equipmentItems)
      await tx.delete(attachments)
      await tx.delete(storageObjectDeletionOutbox)
    })
  await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
  await admin.db.delete(tenants).where(eq(tenants.id, otherId))
  await admin.db.delete(users).where(eq(users.id, userId))
  await app.sql.end()
  await admin.sql.end()
})

const photoOf = async () =>
  (
    await manager.db((tx) =>
      tx
        .select({ photo: equipmentItems.photoAttachmentId })
        .from(equipmentItems)
        .where(eq(equipmentItems.id, itemId)),
    )
  )[0]?.photo

it('sets, refuses non-images and foreign files, removes, and audits a unit photo', async () => {
  await setEquipmentPhoto(itemId, photoId)
  expect(await photoOf()).toBe(photoId)

  await expect(setEquipmentPhoto(itemId, documentId)).rejects.toThrow()
  await expect(setEquipmentPhoto(itemId, foreignPhotoId)).rejects.toThrow()
  expect(await photoOf()).toBe(photoId)

  await setEquipmentPhoto(itemId, null)
  expect(await photoOf()).toBeNull()

  const audit = await manager.db((tx) =>
    tx
      .select({ summary: auditLog.summary })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'equipment'), eq(auditLog.entityId, itemId))),
  )
  expect(audit.map((row) => row.summary).sort()).toEqual(['Changed photo', 'Removed photo'])
})

it('requires the equipment manage permission', async () => {
  ctx = { ...manager, permissions: new Set(['equipment.read.all']) }
  try {
    await expect(setEquipmentPhoto(itemId, photoId)).rejects.toThrow()
    expect(await photoOf()).toBeNull()
  } finally {
    ctx = manager
  }
})
