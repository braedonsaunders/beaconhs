import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { HazidCtx } from './_assessment-rules'
const auth = vi.hoisted(() => ({ context: null as HazidCtx | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ requireRequestContext: async () => auth.context }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('Redirect to assessment list')
  },
}))
import { and, eq, inArray } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import { auditLog, domainEventOutbox, hazidAssessments, tenants, users } from '@beaconhs/db/schema'
import { deleteAssessment } from './_actions'

const url = process.env.DATABASE_URL,
  adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Assessment deletion tests require an isolated localhost database')
}
const app = createClient({ url, max: 2 }),
  admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  userId = randomUUID(),
  id = randomUUID()
const ctx: HazidCtx = {
  tenantId,
  userId,
  membership: null,
  personId: null,
  isSuperAdmin: true,
  permissions: new Set(['*']),
  scopes: [],
  timezone: 'America/Toronto',
  locale: 'en',
  defaultLocale: 'en',
  enabledLocales: ['en'],
  localeOverride: null,
  db: (run) => withTenant(app.db, tenantId, run),
}
beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Delete retry' },
    { id: otherTenant, slug: otherTenant, name: 'Other' },
  ])
  await admin.db
    .insert(users)
    .values({ id: userId, name: 'Delete tester', email: `${userId}@example.com` })
  await ctx.db((tx) =>
    tx
      .insert(hazidAssessments)
      .values({ id, tenantId, reference: 'HAZ-RETRY', occurredAt: new Date() }),
  )
  auth.context = ctx
})
afterAll(async () => {
  try {
    await admin.db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenant]))
    await admin.db.delete(users).where(eq(users.id, userId))
  } finally {
    await app.sql.end()
    await admin.sql.end()
  }
})
it('accepts a committed delete retry without duplicate effects and still denies other scopes', async () => {
  const input = new FormData()
  input.set('id', id)
  await expect(deleteAssessment(input)).rejects.toThrow('Redirect to assessment list')
  const [first] = await ctx.db((tx) =>
    tx.select().from(hazidAssessments).where(eq(hazidAssessments.id, id)),
  )
  expect(first!.deletedAt).toBeInstanceOf(Date)
  await expect(deleteAssessment(input)).rejects.toThrow('Redirect to assessment list')
  const [replayed] = await ctx.db((tx) =>
    tx.select().from(hazidAssessments).where(eq(hazidAssessments.id, id)),
  )
  expect(replayed!.deletedAt).toEqual(first!.deletedAt)
  expect(
    await ctx.db((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'delete'))),
    ),
  ).toHaveLength(1)
  expect(
    await ctx.db((tx) =>
      tx.select().from(domainEventOutbox).where(eq(domainEventOutbox.subjectId, id)),
    ),
  ).toHaveLength(1)
  auth.context = {
    ...ctx,
    isSuperAdmin: false,
    permissions: new Set(['hazid.delete.own', 'hazid.read.self']),
  }
  await expect(deleteAssessment(input)).rejects.toThrow('Assessment not found')
  auth.context = {
    ...ctx,
    tenantId: otherTenant,
    db: (run) => withTenant(app.db, otherTenant, run),
  }
  await expect(deleteAssessment(input)).rejects.toThrow('Assessment not found')
})
