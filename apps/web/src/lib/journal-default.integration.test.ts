import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  people,
  tenants,
  users,
  tenantUsers,
  roles,
  roleAssignments,
  journalEntries,
  auditLog,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getOrCreateEntryForDate } from '@/app/(app)/journals/_data'
import { personRecordSaver } from '@/app/(app)/people/_record-edits'
const urls = [process.env.DATABASE_URL!, process.env.SUPERADMIN_DATABASE_URL!]
for (const url of urls)
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw Error('Isolated local database required')
const app = createClient({ url: urls[0], max: 2 }),
  admin = createClient({ url: urls[1], max: 2 })
const tenantId = randomUUID(),
  userId = randomUUID(),
  personId = randomUUID(),
  membershipId = randomUUID(),
  roleId = randomUUID()
const ctx: RequestContext = {
  tenantId,
  userId,
  personId,
  membership: { id: membershipId, displayName: 'Journal QA' },
  isSuperAdmin: false,
  permissions: new Set(['admin.org.manage', 'journals.create']),
  scopes: [{ type: 'self' }],
  timezone: 'America/Toronto',
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, tenantId, run),
}
beforeAll(async () => {
  await admin.db
    .insert(tenants)
    .values({ id: tenantId, slug: tenantId, name: 'Journal default QA' })
  await admin.db
    .insert(users)
    .values({ id: userId, name: 'Journal QA', email: userId + '@example.test' })
  await ctx.db(async (tx) => {
    await tx.insert(tenantUsers).values({ id: membershipId, tenantId, userId })
    await tx.insert(people).values({
      id: personId,
      tenantId,
      userId,
      firstName: 'Journal',
      lastName: 'QA',
      metadata: { personType: 'employee', preserved: 'yes' },
    })
    await tx.insert(roles).values({ id: roleId, tenantId, key: 'foreman', name: 'Foreman' })
    await tx
      .insert(roleAssignments)
      .values({ tenantId, tenantUserId: membershipId, roleId, scope: { type: 'self' } })
  })
})
afterAll(async () => {
  await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
  await admin.db.delete(users).where(eq(users.id, userId))
  await app.sql.end()
  await admin.sql.end()
})
it('defaults a foreman to worker, honors employee settings and never rewrites existing journals', async () => {
  const id = await getOrCreateEntryForDate(ctx, '2031-01-06')
  const read = async (id: string) =>
    ctx.db(
      async (tx) => (await tx.select().from(journalEntries).where(eq(journalEntries.id, id)))[0]!,
    )
  expect((await read(id!)).definition).toBe('worker')
  const result = await personRecordSaver(ctx, personId, [
    { fieldId: 'journalDefinition', base: null, value: 'supervisor' },
  ])
  expect(result).toMatchObject({
    ok: true,
    applied: [{ fieldId: 'journalDefinition', stored: 'supervisor' }],
  })
  expect(await getOrCreateEntryForDate(ctx, '2031-01-06')).toBe(id)
  expect((await read(id!)).definition).toBe('worker')
  const next = await getOrCreateEntryForDate(ctx, '2031-01-07')
  expect((await read(next!)).definition).toBe('supervisor')
  const [person] = await ctx.db((tx) => tx.select().from(people).where(eq(people.id, personId)))
  expect(person!.metadata).toMatchObject({
    preserved: 'yes',
    personType: 'employee',
    journalDefinition: 'supervisor',
  })
  const audit = await ctx.db((tx) =>
    tx.select().from(auditLog).where(eq(auditLog.entityId, personId)),
  )
  expect(audit.some((r) => r.after?.journalDefinition === 'supervisor')).toBe(true)
})
it('enforces permission, rejects invalid defaults and reports stale edits as conflicts', async () => {
  expect(
    await personRecordSaver({ ...ctx, permissions: new Set() }, personId, [
      { fieldId: 'journalDefinition', base: 'supervisor', value: 'worker' },
    ]),
  ).toMatchObject({ ok: false, reason: 'forbidden' })
  expect(
    await personRecordSaver(ctx, personId, [
      { fieldId: 'journalDefinition', base: 'supervisor', value: 'invalid' },
    ]),
  ).toMatchObject({ ok: true, rejected: [{ fieldId: 'journalDefinition' }] })
  expect(
    await personRecordSaver(ctx, personId, [
      { fieldId: 'journalDefinition', base: null, value: 'worker' },
    ]),
  ).toMatchObject({
    ok: true,
    conflicts: [{ fieldId: 'journalDefinition', current: 'supervisor' }],
  })
  expect(
    await personRecordSaver(ctx, personId, [
      { fieldId: 'journalDefinition', base: 'supervisor', value: null },
    ]),
  ).toMatchObject({ ok: true, applied: [{ stored: null }] })
  const [person] = await ctx.db((tx) => tx.select().from(people).where(eq(people.id, personId)))
  expect(person!.metadata).toEqual({ personType: 'employee', preserved: 'yes' })
})
