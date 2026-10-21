import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  people,
  personGroups,
  personGroupMemberships,
  complianceObligations,
  complianceStatus,
} from '@beaconhs/db/schema'
import { REPORT_ENTITIES, type ReportEntityCatalog } from '@beaconhs/reports/entities'
import { loadBeaconReportCatalog, runBeaconReport } from '@beaconhs/reports/server'
import type { ReportCustomQuery } from '@beaconhs/db/schema'

const url = process.env.DATABASE_URL
const adminUrl = process.env.SUPERADMIN_DATABASE_URL
for (const value of [url, adminUrl]) {
  if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
    throw new Error('Report audience integration tests require an isolated localhost database')
}
const app = createClient({ url, max: 2 })
const admin = createClient({ url: adminUrl, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID(),
  groupId = randomUUID()
const member = randomUUID(),
  individual = randomUUID(),
  outside = randomUUID(),
  foreign = randomUUID()
const obligationId = randomUUID(),
  otherObligation = randomUUID()
let catalog: ReportEntityCatalog

beforeAll(async () => {
  await admin.db.insert(tenants).values([
    { id: tenantId, slug: tenantId, name: 'Report audience' },
    { id: otherTenant, slug: otherTenant, name: 'Other report tenant' },
  ])
  for (const [tenant, ids, obligation] of [
    [tenantId, [member, individual, outside], obligationId],
    [otherTenant, [foreign], otherObligation],
  ] as const) {
    await withTenant(app.db, tenant, async (tx) => {
      await tx.insert(people).values(
        ids.map((id) => ({
          id,
          tenantId: tenant,
          firstName: id,
          lastName: 'Employee',
        })),
      )
      await tx.insert(complianceObligations).values({
        id: obligation,
        tenantId: tenant,
        title: 'Daily journals',
        sourceModule: 'journal',
        subjectKind: 'per_person',
        recurrenceKind: 'frequency',
        recurrence: { kind: 'frequency', frequency: 'week', quantity: 5 },
      })
      await tx.insert(complianceStatus).values(
        ids.map((id) => ({
          tenantId: tenant,
          obligationId: obligation,
          personId: id,
          subjectKey: `person:${id}`,
          status: 'overdue' as const,
          expected: 5,
        })),
      )
    })
  }
  await withTenant(app.db, tenantId, async (tx) => {
    await tx
      .insert(personGroups)
      .values({ id: groupId, tenantId, name: 'Original journal audience' })
    await tx.insert(personGroupMemberships).values({ tenantId, groupId, personId: member })
    catalog = await loadBeaconReportCatalog(tx, [
      REPORT_ENTITIES.find((e) => e.key === 'compliance_status')!,
    ])
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

it('keeps a report narrower than a merged obligation, follows group membership, and respects tenant and archive boundaries', async () => {
  const query: ReportCustomQuery = {
    entity: 'compliance_status',
    mode: 'rows',
    columns: ['person_name', 'obligation_id'],
    filters: {
      combinator: 'and',
      rules: [
        { field: 'obligation_id', op: 'in', value: [obligationId] },
        {
          combinator: 'or',
          rules: [
            { field: 'person_uuid', op: 'in', value: [individual] },
            { field: 'group_id_list', op: 'in', value: [groupId] },
          ],
        },
      ],
    },
  }
  // Use the bypass client deliberately: the compiled query and all joins must
  // still enforce the requested tenant, independently of RLS.
  const run = () => runBeaconReport(admin.db, tenantId, query, catalog)
  const names = async () =>
    (await run()).groups.flatMap((g) => g.rows.map((row) => row.person_name))
  expect(await names()).toEqual(
    expect.arrayContaining([`Employee, ${individual}`, `Employee, ${member}`]),
  )
  expect(await names()).toHaveLength(2)
  const options = catalog.entities[0]!.columns.find((c) => c.key === 'obligation_id')!.filterOptions
  expect(options).toContainEqual({ value: obligationId, label: 'Daily journals' })
  expect(options?.some((o) => o.value === otherObligation)).toBe(false)
  await withTenant(app.db, tenantId, async (tx) => {
    await tx
      .delete(personGroupMemberships)
      .where(
        and(
          eq(personGroupMemberships.groupId, groupId),
          eq(personGroupMemberships.personId, member),
        ),
      )
    await tx.insert(personGroupMemberships).values({ tenantId, groupId, personId: outside })
  })
  expect(await names()).toEqual(
    expect.arrayContaining([`Employee, ${individual}`, `Employee, ${outside}`]),
  )
  expect(await names()).toHaveLength(2)
  await withTenant(app.db, tenantId, (tx) =>
    tx
      .update(complianceObligations)
      .set({ status: 'archived' })
      .where(eq(complianceObligations.id, obligationId)),
  )
  expect(await names()).toEqual([])
})
