import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createClient, withTenant, type Database } from '@beaconhs/db'
import {
  tenants,
  users,
  tenantUsers,
  people,
  attachments,
  documents,
  documentVersions,
  documentAcknowledgments,
  journalEntries,
  truckLogEntries,
  equipmentItems,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => ctx }))
vi.mock('@/lib/signature-storage', () => ({
  withStoredSignatureAttachment: async (
    context: RequestContext,
    _data: string,
    write: (tx: Parameters<Parameters<RequestContext['db']>[0]>[0], id: string) => Promise<unknown>,
  ) =>
    context.db(async (tx) => {
      const id = randomUUID()
      await tx.insert(attachments).values({
        id,
        tenantId: context.tenantId,
        kind: 'signature',
        r2Key: `t/${context.tenantId}/${id}.png`,
        contentType: 'image/png',
        filename: 'signature.png',
        sizeBytes: 68,
      })
      return write(tx, id)
    }),
}))
import { addSignOffSigner, completeSignOffSession } from '@/app/(app)/documents/[id]/_ack-actions'
import {
  upsertVehicleLogEntry,
  updateVehicleLogEntry,
  deleteVehicleLogEntry,
} from '@/app/(app)/equipment/vehicle-log/_service'
import { loadWorkspaceHistory } from './workspace-history'
import { canFacilitateDocumentSignoff } from './document-signoff-permission'
import { moduleAdminByKey } from './module-admin/registry'
let ctx: RequestContext
const url = process.env.MIGRATION_DATABASE_URL!
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
  throw Error('Isolated database required')

it('records repeated talks independently, enforces facilitator access and updates carried mileage across months', async () => {
  const client = createClient({ url, max: 1 })
  const tenantId = randomUUID(),
    personId = randomUUID(),
    userId = randomUUID(),
    membership = randomUUID()
  const documentId = randomUUID(),
    versionId = randomUUID(),
    equipmentId = randomUUID()
  const rollback = new Error('Test rollback')
  try {
    await expect(
      withTenant(client.db, tenantId, async (tx) => {
        await tx.execute(sql`set local role ${sql.identifier(process.env.DATABASE_OWNER_ROLE!)}`)
        await tx.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Regression QA' })
        await tx
          .insert(users)
          .values({ id: userId, name: 'Facilitator QA', email: `${userId}@example.test` })
        await tx.insert(tenantUsers).values({ id: membership, tenantId, userId })
        await tx
          .insert(people)
          .values({ id: personId, tenantId, userId, firstName: 'Facilitator', lastName: 'QA' })
        ctx = {
          tenantId,
          userId,
          personId,
          membership: { id: membership, displayName: 'QA' },
          isSuperAdmin: false,
          permissions: new Set([
            'documents.read',
            'documents.signoff',
            'equipment.read.all',
            'equipment.vehicle-log.update.own',
          ]),
          scopes: [{ type: 'tenant' }],
          timezone: 'America/Toronto',
          locale: 'en',
          defaultLocale: 'en',
          enabledLocales: ['en'],
          localeOverride: null,
          db: (run) => tx.transaction((inner) => run(inner as unknown as Database)),
        }
        expect(canFacilitateDocumentSignoff(ctx)).toBe(true)
        expect(
          canFacilitateDocumentSignoff({
            ...ctx,
            permissions: new Set(['documents.read', 'documents.acknowledge']),
          }),
        ).toBe(false)
        expect(
          moduleAdminByKey('documents')?.tabs.find((t) => t.key === 'management-reviews')
            ?.permission,
        ).toBe('documents.manage')
        await tx.insert(documents).values({
          id: documentId,
          tenantId,
          key: 'QA-TALK',
          title: 'Repeatable talk',
          status: 'published',
        })
        await tx.insert(documentVersions).values({
          id: versionId,
          tenantId,
          documentId,
          version: 1,
          publishedAt: new Date('2022-01-01'),
        })
        await tx.insert(documentAcknowledgments).values({
          tenantId,
          documentId,
          versionId,
          personId,
          acknowledgedAt: new Date('2022-01-01'),
        })
        const input = { documentId, versionId, personId, signatureDataUrl: 'test-signature' }
        const first = await addSignOffSigner(input),
          second = await addSignOffSigner(input)
        expect(first.ok).toBe(true)
        expect(second.ok).toBe(true)
        if (!first.ok || !second.ok) throw Error('Sign-off failed')
        expect(first.sessionId).not.toBe(second.sessionId)
        expect(
          await addSignOffSigner({ ...input, session: { id: first.sessionId } }),
        ).toMatchObject({
          ok: false,
          error: expect.stringContaining('already signed this session'),
        })
        expect(await completeSignOffSession({ documentId, sessionId: first.sessionId })).toEqual({
          ok: true,
        })
        expect(
          await addSignOffSigner({ ...input, session: { id: first.sessionId } }),
        ).toMatchObject({ ok: false, error: expect.stringContaining('already complete') })
        expect(
          await tx
            .select()
            .from(documentAcknowledgments)
            .where(eq(documentAcknowledgments.documentId, documentId)),
        ).toHaveLength(3)
        await tx.insert(journalEntries).values([
          ...Array.from({ length: 6 }, (_, i) => ({
            tenantId,
            reference: `QA-${i}`,
            title: `Submitted journal ${i}`,
            entryDate: '2026-10-30',
            status: 'submitted' as const,
            createdByTenantUserId: membership,
            submittedAt: new Date(`2026-10-30T10:0${i}:00Z`),
          })),
          {
            tenantId,
            reference: 'QA-draft',
            title: 'Unfinished',
            entryDate: '2026-10-30',
            status: 'draft' as const,
            createdByTenantUserId: membership,
          },
          {
            tenantId,
            reference: 'QA-other',
            title: 'Not mine',
            entryDate: '2026-10-30',
            status: 'submitted' as const,
          },
        ])
        const firstHistoryPage = await loadWorkspaceHistory(ctx, { kind: 'journal', perPage: '5' })
        expect(firstHistoryPage.total).toBe(6)
        expect(firstHistoryPage.rows).toHaveLength(5)
        expect(firstHistoryPage.rows[0]?.title).toBe('Submitted journal 5')
        expect(
          (await loadWorkspaceHistory(ctx, { kind: 'journal', perPage: '5', page: '2' })).rows,
        ).toHaveLength(1)
        const history = await loadWorkspaceHistory(ctx, { kind: 'document' })
        expect(history.total).toBe(3)
        expect(history.rows[0]?.title).toBe('Repeatable talk')
        await tx
          .update(documents)
          .set({ deletedAt: new Date() })
          .where(eq(documents.id, documentId))
        expect(
          (await loadWorkspaceHistory(ctx, { kind: 'document' })).rows.every(
            (row) => row.href === null,
          ),
        ).toBe(true)
        await tx.update(documents).set({ deletedAt: null }).where(eq(documents.id, documentId))
        expect((await loadWorkspaceHistory(ctx, { q: 'Individual acknowledgment' })).total).toBe(1)
        expect((await loadWorkspaceHistory(ctx, { q: 'Group sign-off' })).total).toBe(2)
        expect((await loadWorkspaceHistory(ctx, { q: 'missing' })).total).toBe(0)
        const ownPerson = ctx.personId
        ctx.personId = randomUUID()
        expect((await loadWorkspaceHistory(ctx, { kind: 'document' })).total).toBe(0)
        ctx.personId = ownPerson
        expect(await addSignOffSigner({ ...input, documentId: randomUUID() })).toMatchObject({
          ok: false,
        })
        ctx.permissions = new Set(['documents.read'])
        await expect(addSignOffSigner(input)).rejects.toThrow('permission required')
        ctx.permissions = new Set(['equipment.read.all', 'equipment.vehicle-log.update.own'])
        await tx.insert(equipmentItems).values({
          id: equipmentId,
          tenantId,
          assetTag: 'QA-1',
          name: 'Truck QA',
          qrToken: randomUUID(),
        })
        const base = {
          equipmentItemId: equipmentId,
          driverPersonId: personId,
          entryMode: 'odometer' as const,
        }
        const firstLog = await upsertVehicleLogEntry(ctx, {
          ...base,
          entryDate: '2026-09-30',
          startOdometer: 1000,
          endOdometer: 1100,
        })
        await upsertVehicleLogEntry(ctx, { ...base, entryDate: '2026-10-01', endOdometer: 1200 })
        await upsertVehicleLogEntry(ctx, {
          ...base,
          entryDate: '2026-10-02',
          startOdometer: 1200,
          endOdometer: 1300,
        })
        await updateVehicleLogEntry(ctx, firstLog.id, {
          ...base,
          entryDate: '2026-09-30',
          startOdometer: 1000,
          endOdometer: 1120,
        })
        let rows = await tx.select().from(truckLogEntries).orderBy(truckLogEntries.entryDate)
        expect(rows[1]).toMatchObject({
          startOdometer: 1120,
          kmDriven: 80,
          startOdometerCarried: true,
        })
        expect(rows[2]).toMatchObject({ startOdometer: 1200, startOdometerCarried: false })
        await expect(
          upsertVehicleLogEntry(ctx, {
            ...base,
            entryDate: '2026-09-30',
            startOdometer: 1000,
            endOdometer: 1250,
          }),
        ).rejects.toThrow('previous ending reading')
        rows = await tx.select().from(truckLogEntries).orderBy(truckLogEntries.entryDate)
        expect(rows[0]?.endOdometer).toBe(1120)
        await expect(
          upsertVehicleLogEntry(ctx, {
            ...base,
            driverPersonId: randomUUID(),
            entryDate: '2026-10-03',
            endOdometer: 1400,
          }),
        ).rejects.toThrow('permission')
        ctx.permissions.add('equipment.manage')
        await upsertVehicleLogEntry(ctx, {
          ...base,
          entryDate: '2026-09-29',
          startOdometer: 900,
          endOdometer: 1000,
        })
        await deleteVehicleLogEntry(ctx, firstLog.id)
        const [afterDelete] = await tx
          .select()
          .from(truckLogEntries)
          .where(eq(truckLogEntries.entryDate, '2026-10-01'))
        expect(afterDelete).toMatchObject({ startOdometer: 1000, kmDriven: 200 })
        throw rollback
      }),
    ).rejects.toBe(rollback)
  } finally {
    await client.sql.end()
  }
}, 30_000)
