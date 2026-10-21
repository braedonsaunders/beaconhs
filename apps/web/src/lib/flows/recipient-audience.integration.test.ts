import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const jobs = vi.hoisted(() => ({ pdfEmail: vi.fn(async () => undefined) }))
vi.mock('@beaconhs/jobs', async (original) => ({
  ...(await original<typeof import('@beaconhs/jobs')>()),
  enqueuePdfEmail: jobs.pdfEmail,
}))
import { eq, inArray, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  people,
  personGroups,
  personGroupMemberships,
  complianceObligations,
  complianceAudience,
  formAutomations,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { readFileSync } from 'node:fs'
import type { ActionData, EmailTarget } from '@beaconhs/forms-core'
import { buildRecordSummaryPdfJob } from './pdf-summary'
import type { FlowSubjectAdapter } from './types'
import { executeFlowPlan } from '@/lib/flows/execute-flow-plan'

const url = process.env.DATABASE_URL
const adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Recipient integration tests require an isolated localhost database')
}
const app = createClient({ url, max: 2 })
const admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID()
const foreignPerson = randomUUID()
const member = randomUUID(),
  outside = randomUUID(),
  recipient = randomUUID(),
  groupId = randomUUID(),
  obligationId = randomUUID(),
  flowId = randomUUID()
const ctx: RequestContext = {
  tenantId,
  userId: 'test',
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
let target: Extract<EmailTarget, { type: 'audience_recipient' }>
beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Routing' },
    { id: otherTenant, slug: otherTenant, name: 'Other' },
  ])
  await withTenant(app.db, otherTenant, (tx) =>
    tx.insert(people).values({
      id: foreignPerson,
      tenantId: otherTenant,
      firstName: 'Other',
      lastName: 'Tenant',
      metadata: { personType: 'employee' },
    }),
  )
  await ctx.db(async (tx) => {
    await tx.insert(people).values([
      {
        id: member,
        tenantId,
        firstName: 'Member',
        lastName: 'One',
        metadata: { personType: 'employee' },
      },
      {
        id: outside,
        tenantId,
        firstName: 'Outside',
        lastName: 'Two',
        metadata: { personType: 'employee' },
      },
      {
        id: recipient,
        tenantId,
        firstName: 'Recipient',
        lastName: 'Manager',
        email: 'manager@example.com',
      },
    ])
    await tx.insert(personGroups).values({ id: groupId, tenantId, name: 'Electrical' })
    await tx.insert(personGroupMemberships).values({ tenantId, groupId, personId: member })
    await tx.insert(complianceObligations).values({
      id: obligationId,
      tenantId,
      title: 'Electrical',
      sourceModule: 'journal',
      subjectKind: 'per_person',
      recurrenceKind: 'frequency',
      targetRef: {},
      recurrence: { kind: 'frequency', frequency: 'week', quantity: 5 },
      workerType: 'employee',
    })
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId, kind: 'person_group', entityKey: groupId })
    // Stored pre-cutover configuration is intentionally written through SQL.
    await tx.execute(
      sql`INSERT INTO form_automations (id,tenant_id,subject_type,subject_key,name,graph) VALUES (${flowId},${tenantId},'module','journals','Routing',${JSON.stringify({ schemaVersion: 1, edges: [], nodes: [{ id: 'email', position: { x: 0, y: 0 }, data: { kind: 'action', action: { action: 'send_email', to: [{ type: 'compliance_recipient', obligationId, personField: 'person_id', recipient: { type: 'person', personId: recipient } }] } } }] })}::jsonb)`,
    )
  })
})
afterAll(async () => {
  try {
    await admin.db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenant]))
  } finally {
    await app.sql.end()
    await admin.sql.end()
  }
})
it('migrates once and keeps delivery scope independent of merged and archived obligations', async () => {
  const migration = readFileSync(
    new URL(
      '../../../../../packages/db/drizzle/0081_flow_recipient_audiences.sql',
      import.meta.url,
    ),
    'utf8',
  )
  await admin.db.execute(sql.raw(migration))
  const [flow] = await ctx.db((tx) =>
    tx.select().from(formAutomations).where(eq(formAutomations.id, flowId)),
  )
  const node = flow!.graph.nodes[0]!
  if (node.data.kind !== 'action' || node.data.action.action !== 'send_email')
    throw new Error('Missing migrated action')
  target = node.data.action.to[0] as typeof target
  expect(target).toMatchObject({
    type: 'audience_recipient',
    audienceName: 'Electrical',
    workerType: 'employee',
    audience: [{ kind: 'person_group', entityKey: groupId }],
  })
  expect(target).not.toHaveProperty('obligationId')
  await admin.db.execute(sql.raw(migration))
  const [twice] = await ctx.db((tx) =>
    tx.select().from(formAutomations).where(eq(formAutomations.id, flowId)),
  )
  expect(twice!.graph).toEqual(flow!.graph)
  await ctx.db(async (tx) => {
    await tx
      .insert(complianceAudience)
      .values({ tenantId, obligationId, kind: 'everyone', entityKey: '' })
    await tx
      .update(complianceObligations)
      .set({ status: 'archived' })
      .where(eq(complianceObligations.id, obligationId))
  })
  const adapter: FlowSubjectAdapter = {
    subjectType: 'module' as const,
    subjectKey: 'journals',
    subjectId: randomUUID(),
    notifyCategory: 'journal',
    auditEntityType: 'journal_entry',
    deepLink: () => '/journals',
    resolveSubmitter: async () => ({ tenantUserId: null, email: null, userId: null }),
    loadValues: async () => ({}),
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId,
        subjectId: member,
        entityType: 'journal_entry',
        heading: 'Journal',
        values,
      }),
  }
  async function deliver(personId: string, audienceTarget = target) {
    jobs.pdfEmail.mockClear()
    const action: ActionData = {
      action: 'send_email',
      mode: 'inline',
      attachPdf: true,
      pdfFormat: 'summary',
      subject: 'Journal',
      bodyTemplate: 'Journal',
      to: [{ type: 'literal', email: 'company@example.com' }, audienceTarget],
    }
    await executeFlowPlan(ctx, adapter, {
      flowId,
      values: { person_id: personId },
      plan: { actions: [action], actionNodes: [{ nodeId: 'email', action }], gates: [] },
    })
    return (jobs.pdfEmail.mock.calls[0] as unknown as [unknown, { to: string[] }])[1].to
  }
  expect(await deliver(member)).toEqual(['company@example.com', 'manager@example.com'])
  expect(await deliver(outside)).toEqual(['company@example.com'])
  expect(
    await deliver(foreignPerson, { ...target, audience: [{ kind: 'everyone', entityKey: '' }] }),
  ).toEqual(['company@example.com'])
  expect(await deliver(member, { ...target, audience: [] })).toEqual(['company@example.com'])
  expect(
    await deliver(member, {
      ...target,
      audience: [...target.audience, { kind: 'person', entityKey: member, excluded: true }],
    }),
  ).toEqual(['company@example.com'])
  await ctx.db((tx) =>
    tx.insert(personGroupMemberships).values({ tenantId, groupId, personId: outside }),
  )
  expect(await deliver(outside)).toEqual(['company@example.com', 'manager@example.com'])
  expect(await deliver(member, { ...target, workerType: 'contractor' })).toEqual([
    'company@example.com',
  ])
})
