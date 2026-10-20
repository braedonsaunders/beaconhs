import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const jobs = vi.hoisted(() => ({ pdfEmail: vi.fn(async () => undefined) }))
vi.mock('@beaconhs/jobs', async (original) => ({
  ...(await original<typeof import('@beaconhs/jobs')>()),
  enqueuePdfEmail: jobs.pdfEmail,
}))
import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  people,
  tenantUsers,
  users,
  inspectionTypes,
  inspectionRecords,
  auditLog,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { ActionData } from '@beaconhs/forms-core'
import { inspectionRecordSaver } from './_record-edits'
import { createInspectionFlowAdapter } from '@/lib/flows/adapters/inspections'
import { executeFlowPlan } from '@/lib/flows/execute-flow-plan'
import { inspectionForemanMatches } from '@/lib/inspection-foremen'
import { assertInspectionStatusTransitionInTx } from './_lib'

const url = process.env.DATABASE_URL
const adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Inspection integration tests require an isolated localhost database')
}
const app = createClient({ url, max: 2 })
const admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  recordId = randomUUID(),
  typeId = randomUUID()
const foremanA = randomUUID(),
  foremanB = randomUUID(),
  outsider = randomUUID(),
  inactive = randomUUID()
const supervisorUser = randomUUID(),
  supervisor = randomUUID(),
  linkedUser = randomUUID()
const ctx: RequestContext = {
  tenantId,
  userId: supervisorUser,
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
    { id: tenantId, slug: tenantId, name: 'Foreman test' },
    { id: otherTenant, slug: otherTenant, name: 'Other tenant' },
  ])
  await admin.db.insert(users).values([
    { id: supervisorUser, name: 'Supervisor account', email: `${supervisorUser}@example.com` },
    { id: linkedUser, name: 'Linked foreman', email: `${linkedUser}@example.com` },
  ])
  await ctx.db(async (tx) => {
    await tx.insert(tenantUsers).values({ id: supervisor, tenantId, userId: supervisorUser })
    await tx.insert(people).values([
      { id: foremanA, tenantId, firstName: 'Alex', lastName: 'Foreman', email: 'alex@example.com' },
      { id: foremanB, tenantId, firstName: 'Blair', lastName: 'Foreman', userId: linkedUser },
      { id: inactive, tenantId, firstName: 'Former', lastName: 'Foreman', status: 'inactive' },
    ])
    await tx
      .insert(inspectionTypes)
      .values({ id: typeId, tenantId, name: 'Site check', requiresForeman: true })
    await tx.insert(inspectionRecords).values({
      id: recordId,
      tenantId,
      reference: 'INS-TEST',
      typeId,
      occurredAt: new Date(),
      supervisorTenantUserId: supervisor,
      foremanText: 'Old typed name',
    })
  })
  await withTenant(app.db, otherTenant, (tx) =>
    tx.insert(people).values({
      id: outsider,
      tenantId: otherTenant,
      firstName: 'Other',
      lastName: 'Foreman',
      email: 'outside@example.com',
    }),
  )
})
afterAll(async () => {
  try {
    await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
    await admin.db.delete(tenants).where(eq(tenants.id, otherTenant))
    await admin.db.delete(users).where(eq(users.id, supervisorUser))
    await admin.db.delete(users).where(eq(users.id, linkedUser))
  } finally {
    await app.sql.end()
    await admin.sql.end()
  }
})
it('requires directory selections, rejects inactive/cross-tenant ids, and saves auditable foremen', async () => {
  const [record] = await ctx.db((tx) =>
    tx.select().from(inspectionRecords).where(eq(inspectionRecords.id, recordId)),
  )
  await expect(
    ctx.db((tx) => assertInspectionStatusTransitionInTx(tx, tenantId, record!, 'submitted')),
  ).rejects.toThrow('select at least one foreman')
  for (const id of [outsider, inactive]) {
    expect(
      await inspectionRecordSaver(ctx, recordId, [
        { fieldId: 'foremanPersonIds', value: [id], base: [] },
      ]),
    ).toMatchObject({
      rejected: [{ fieldId: 'foremanPersonIds', error: 'Choose active foremen in this tenant.' }],
    })
  }
  expect(
    await inspectionRecordSaver(ctx, recordId, [
      { fieldId: 'foremanPersonIds', value: [foremanA, foremanB], base: [] },
    ]),
  ).toMatchObject({
    applied: [{ fieldId: 'foremanPersonIds', stored: [foremanA, foremanB] }],
    rejected: [],
  })
  const [saved] = await ctx.db((tx) =>
    tx.select().from(inspectionRecords).where(eq(inspectionRecords.id, recordId)),
  )
  expect(saved).toMatchObject({ foremanPersonIds: [foremanA, foremanB], foremanText: null })
  const audit = await ctx.db((tx) =>
    tx.select().from(auditLog).where(eq(auditLog.entityId, recordId)),
  )
  expect(audit.some((entry) => entry.summary === 'Updated foremanPersonIds')).toBe(true)
  const matches = await ctx.db((tx) =>
    tx
      .select({ id: inspectionRecords.id })
      .from(inspectionRecords)
      .where(inspectionForemanMatches('%Blair Foreman%')),
  )
  expect(matches).toEqual([{ id: recordId }])
})
it('prints all selected names and queues one PDF email for foremen, supervisor and existing recipients', async () => {
  const adapter = createInspectionFlowAdapter(ctx, recordId)
  const values = await adapter.loadValues()
  expect(values.foreman_text).toBe('Alex Foreman, Blair Foreman')
  expect(values.foreman_person_ids).toBe(`${foremanA},${foremanB}`)
  const action: ActionData = {
    action: 'send_email',
    mode: 'inline',
    attachPdf: true,
    pdfFormat: 'summary',
    subject: 'Inspection {{reference}}',
    bodyTemplate: 'Foremen: {{foreman_text}}',
    to: [
      { type: 'field', field: 'foreman_person_ids' },
      { type: 'field', field: 'supervisor_tenant_user_id' },
      { type: 'literal', email: 'safety@example.com; ALEX@example.com' },
      { type: 'field', field: 'extra_people' },
    ],
  }
  for (const roster of [values.foreman_person_ids, [foremanA, foremanB]]) {
    jobs.pdfEmail.mockClear()
    const result = await executeFlowPlan(ctx, adapter, {
      flowId: randomUUID(),
      values: { ...values, foreman_person_ids: roster, extra_people: [outsider] },
      plan: { actions: [action], actionNodes: [{ nodeId: 'email', action }], gates: [] },
    })
    expect(result).toEqual({ ran: ['send_email+pdf→4'], failed: [] })
    expect(jobs.pdfEmail).toHaveBeenCalledTimes(1)
    const [pdf, payload] = jobs.pdfEmail.mock.calls[0] as unknown as [
      unknown,
      { to: string[]; deliverAsSingleMessage: boolean },
    ]
    expect(payload.to).toEqual([
      'alex@example.com',
      `${linkedUser}@example.com`,
      `${supervisorUser}@example.com`,
      'safety@example.com',
    ])
    expect(payload.deliverAsSingleMessage).toBe(true)
    expect(JSON.stringify(pdf)).toContain('Alex Foreman, Blair Foreman')
  }
})
