import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  incidents,
  tenants,
  users,
  tenantUsers,
  incidentRootCauseWhys,
  auditLog,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { incidentRecordSaver } from '@/app/(app)/incidents/_record-edits'
import { createIncidentFlowAdapter } from './flows/adapters/incidents'

const url = process.env.DATABASE_URL!
const adminUrl = process.env.SUPERADMIN_DATABASE_URL!
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1'].includes(new URL(value).hostname))
    throw Error('Isolated local database required')
}
it('persists and audits reporting metrics, preserves old scores and enforces scope, conflicts and locks', async () => {
  const app = createClient({ url, max: 1 }),
    admin = createClient({ url: adminUrl, max: 1 })
  const tenantId = randomUUID(),
    other = randomUUID(),
    userId = randomUUID(),
    memberId = randomUUID(),
    id = randomUUID()
  const ctx = {
    tenantId,
    userId,
    membership: { id: memberId, displayName: 'Reporter' },
    personId: null,
    isSuperAdmin: false,
    permissions: new Set(['incidents.update', 'incidents.read.all']),
    scopes: [],
    timezone: 'America/Toronto',
    locale: 'en',
    defaultLocale: 'en',
    enabledLocales: ['en'],
    localeOverride: null,
    db: (run: Parameters<RequestContext['db']>[0]) => withTenant(app.db, tenantId, run),
  } as RequestContext
  try {
    await admin.db.insert(tenants).values([
      { id: tenantId, slug: tenantId, name: 'Metrics' },
      { id: other, slug: other, name: 'Other' },
    ])
    await admin.db
      .insert(users)
      .values({ id: userId, name: 'Reporter', email: `${userId}@example.test` })
    await admin.db.insert(tenantUsers).values({ id: memberId, tenantId, userId })
    await ctx.db((tx) =>
      tx.insert(incidents).values({
        id,
        tenantId,
        reference: 'INC-TEST',
        title: 'Test',
        type: 'near_miss',
        severity: 'no_injury',
        occurredAt: new Date(),
        reportedByTenantUserId: memberId,
        actualSeverity: 2,
        severityRating: 4,
      }),
    )
    const result = await incidentRecordSaver(ctx, id, [
      { fieldId: 'processExperience', base: '', value: '3' },
      { fieldId: 'crewResponse', base: '', value: '5' },
      { fieldId: 'siteConditions', base: '', value: '2' },
      { fieldId: 'experiencePersonName', base: '', value: 'Person involved' },
      { fieldId: 'rootCause', base: '', value: '<p>Employee account.</p>' },
    ])
    expect(result).toMatchObject({ ok: true, rejected: [], conflicts: [] })
    if (!result.ok) throw Error('Expected successful save')
    expect(result.applied).toHaveLength(5)
    const [row] = await ctx.db((tx) => tx.select().from(incidents).where(eq(incidents.id, id)))
    expect(row).toMatchObject({
      actualSeverity: 2,
      severityRating: 4,
      processExperience: 3,
      crewResponse: 5,
      siteConditions: 2,
    })
    const audit = await ctx.db((tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, id)))
    expect(audit.length).toBeGreaterThan(0)
    for (const invalid of ['0', '6', '1.5', 'wrong']) {
      const rejected = await incidentRecordSaver(ctx, id, [
        { fieldId: 'crewResponse', base: '5', value: invalid },
      ])
      if (!rejected.ok) throw Error('Expected field validation result')
      expect(rejected.rejected).toHaveLength(1)
    }
    const conflict = await incidentRecordSaver(ctx, id, [
      { fieldId: 'crewResponse', base: '', value: '1' },
    ])
    if (!conflict.ok) throw Error('Expected conflict result')
    expect(conflict.conflicts).toHaveLength(1)
    await ctx.db((tx) =>
      tx
        .insert(incidentRootCauseWhys)
        .values({ tenantId, incidentId: id, ordinal: 1, whyText: 'Investigator analysis.' }),
    )
    const reporterCtx = {
      ...ctx,
      permissions: new Set(['incidents.create', 'incidents.read.self']),
    }
    const ownSave = await incidentRecordSaver(reporterCtx, id, [
      {
        fieldId: 'rootCause',
        base: '<p>Employee account.</p>',
        value: '<p>Employee clarification.</p>',
      },
      { fieldId: 'potentialSeverity', base: '', value: '4' },
    ])
    expect(ownSave).toMatchObject({ ok: true, rejected: [], conflicts: [] })
    if (!ownSave.ok) throw Error('Reporter must be able to complete their own report')
    expect(ownSave.applied).toHaveLength(2)
    const deniedFields = await incidentRecordSaver(reporterCtx, id, [
      { fieldId: 'status', base: 'reported', value: 'closed' },
    ])
    if (!deniedFields.ok) throw Error('Expected field-level rejection')
    expect(deniedFields.rejected).toHaveLength(1)
    expect(
      (
        await incidentRecordSaver(reporterCtx, id, [
          { fieldId: 'severityRating', base: '4', value: '1' },
        ])
      ).ok,
    ).toBe(false)
    const otherReporter = {
      ...reporterCtx,
      membership: { id: randomUUID(), displayName: 'Other' },
      permissions: new Set(['incidents.create', 'incidents.read.all']),
    }
    expect(
      (
        await incidentRecordSaver(otherReporter, id, [
          { fieldId: 'rootCause', base: '', value: 'Not mine' },
        ])
      ).ok,
    ).toBe(false)
    const values = await createIncidentFlowAdapter(ctx, id).loadValues()
    expect(values.process_experience).toBe(3)
    expect(values.crew_response_answer).toContain('5 — Treatment/repair provided.')
    expect(values.root_cause).toContain('Employee clarification.')
    expect(values.cause_analysis).toEqual([{ ordinal: 1, description: 'Investigator analysis.' }])
    const foreignCtx = {
      ...ctx,
      tenantId: other,
      db: (run: Parameters<RequestContext['db']>[0]) => withTenant(app.db, other, run),
    } as RequestContext
    expect(
      (
        await incidentRecordSaver(foreignCtx, id, [
          { fieldId: 'crewResponse', base: '5', value: '1' },
        ])
      ).ok,
    ).toBe(false)
    expect(
      (
        await incidentRecordSaver({ ...ctx, permissions: new Set() }, id, [
          { fieldId: 'crewResponse', base: '5', value: '1' },
        ])
      ).ok,
    ).toBe(false)
    await ctx.db((tx) => tx.update(incidents).set({ locked: true }).where(eq(incidents.id, id)))
    expect(
      (await incidentRecordSaver(ctx, id, [{ fieldId: 'crewResponse', base: '5', value: '1' }])).ok,
    ).toBe(false)
  } finally {
    await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
    await admin.db.delete(tenants).where(eq(tenants.id, other))
    await admin.db.delete(users).where(eq(users.id, userId))
    await app.sql.end()
    await admin.sql.end()
  }
})
