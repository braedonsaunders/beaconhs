import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import {
  tenants,
  people,
  complianceObligations,
  complianceStatus,
  correctiveActions,
  ppeItems,
  ppeTypes,
  personTitles,
  jobTitleTasks,
} from '@beaconhs/db/schema'
import { BEACON_REPORT_CATALOG, type ReportCustomQuery } from '@beaconhs/reports'
import { runBeaconReport } from '@beaconhs/reports/server'
import { renderReportDocumentBodyHtml } from '@beaconhs/reports/document'

for (const url of [process.env.DATABASE_URL, process.env.SUPERADMIN_DATABASE_URL])
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Isolated localhost database required')
const app = createClient({ url: process.env.DATABASE_URL, max: 2 })
const admin = createClient({ url: process.env.SUPERADMIN_DATABASE_URL, max: 2 })
const tenantId = randomUUID(),
  otherTenant = randomUUID()
const personIds = Array.from({ length: 5 }, () => randomUUID())
const journal = randomUUID(),
  ppe = randomUUID(),
  action = randomUUID(),
  signoff = randomUUID()
const ppeId = randomUUID(),
  actionId = randomUUID(),
  foreignAction = randomUUID()
const titleId = randomUUID(),
  taskId = randomUUID()
const query: ReportCustomQuery = {
  entity: 'compliance_status',
  mode: 'rows',
  columns: ['obligation_title', 'subject_key', 'person_name', 'status'],
  groupBy: 'obligation_title',
  sorts: [{ column: 'subject_key', direction: 'asc' }],
}
const run = (q = query) =>
  withTenant(app.db, tenantId, (tx) => runBeaconReport(tx, tenantId, q, BEACON_REPORT_CATALOG))
beforeAll(async () => {
  await admin.db
    .insert(tenants)
    .values(
      [tenantId, otherTenant].map((id) => ({ id, slug: id, name: 'Compliance report labels QA' })),
    )
  await withTenant(app.db, otherTenant, (tx) =>
    tx.insert(correctiveActions).values({
      id: foreignAction,
      tenantId: otherTenant,
      reference: 'CA-PRIVATE',
      title: 'Other tenant confidential title',
    }),
  )
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(people).values([
      { id: personIds[0], tenantId, firstName: 'Alex', lastName: 'Foreman' },
      { id: personIds[1], tenantId, firstName: 'Blair', lastName: '', deletedAt: new Date() },
      { id: personIds[2], tenantId, firstName: '', lastName: 'Manager' },
      { id: personIds[3], tenantId, firstName: ' ', lastName: ' ' },
      { id: personIds[4], tenantId, firstName: 'Alex', lastName: 'Foreman' },
    ])
    await tx.insert(personTitles).values({ id: titleId, tenantId, name: 'Foreman' })
    await tx
      .insert(jobTitleTasks)
      .values({ id: taskId, tenantId, titleId, task: 'Review shop procedure' })
    const typeId = randomUUID()
    await tx.insert(ppeTypes).values({ id: typeId, tenantId, name: 'Harness' })
    await tx.insert(ppeItems).values({ id: ppeId, tenantId, typeId, serialNumber: 'HARNESS-12' })
    await tx
      .insert(correctiveActions)
      .values({ id: actionId, tenantId, reference: 'CA-100', title: 'Repair guard' })
    await tx.insert(complianceObligations).values(
      [
        {
          id: journal,
          tenantId,
          title: 'Weekly journals',
          sourceModule: 'journal' as const,
          subjectKind: 'per_person' as const,
        },
        {
          id: ppe,
          tenantId,
          title: 'PPE inspections',
          sourceModule: 'ppe_inspection' as const,
          subjectKind: 'per_record' as const,
        },
        {
          id: action,
          tenantId,
          title: 'Corrective actions',
          sourceModule: 'corrective_action' as const,
          subjectKind: 'per_record' as const,
        },
        {
          id: signoff,
          tenantId,
          title: 'Task sign-offs',
          sourceModule: 'job_title_signoff' as const,
          subjectKind: 'per_task' as const,
        },
      ].map((ob) => ({
        ...ob,
        recurrenceKind: 'frequency' as const,
        recurrence: { kind: 'frequency' as const, frequency: 'week' as const },
      })),
    )
    await tx.insert(complianceStatus).values([
      ...personIds.map((personId) => ({
        tenantId,
        obligationId: journal,
        personId,
        subjectKey: `person:${personId}`,
        status: 'overdue' as const,
      })),
      {
        tenantId,
        obligationId: ppe,
        subjectKey: `record:${ppeId}`,
        subjectRef: { recordId: ppeId },
        status: 'overdue' as const,
      },
      {
        tenantId,
        obligationId: action,
        subjectKey: `record:${actionId}`,
        subjectRef: { caId: actionId },
        status: 'overdue' as const,
      },
      {
        tenantId,
        obligationId: action,
        subjectKey: `record:${foreignAction}`,
        subjectRef: { caId: foreignAction },
        status: 'overdue' as const,
      },
      {
        tenantId,
        obligationId: signoff,
        personId: personIds[0],
        subjectKey: `task:${taskId}:${personIds[0]}`,
        subjectRef: { taskId },
        status: 'overdue' as const,
      },
    ])
  })
})
afterAll(async () => {
  await admin.db.delete(tenants).where(eq(tenants.id, tenantId))
  await admin.db.delete(tenants).where(eq(tenants.id, otherTenant))
  await app.sql.end()
  await admin.sql.end()
})
it('resolves the unchanged scheduled report subject column to human names and record labels', async () => {
  const result = await run()
  const rows = result.groups.flatMap((group) => group.rows)
  expect(rows.map((row) => row.subject_key)).toEqual(
    expect.arrayContaining([
      'Foreman, Alex',
      'Blair',
      'Manager',
      'Person unavailable',
      'Harness · HARNESS-12',
      'CA-100 — Repair guard',
      'Record unavailable',
      'Foreman, Alex — Review shop procedure',
    ]),
  )
  expect(rows).toHaveLength(9)
  expect(rows.find((row) => row.subject_key === 'Blair')?.person_name).toBe('Blair')
  const rendered = renderReportDocumentBodyHtml({
    tenantName: 'QA',
    dateRangeLabel: 'Current compliance',
    reportName: 'Scheduled weekly journal report',
    generatedAt: new Date(),
    groups: result.groups,
    summary: result.summary,
  })
  expect(rendered).toContain('Foreman, Alex')
  expect(rendered).toContain('Harness · HARNESS-12')
  expect(rendered).not.toContain('Other tenant confidential title')
  for (const id of [...personIds, ppeId, actionId, foreignAction, taskId])
    expect(rendered).not.toContain(id)
})
it('keeps saved raw-subject filters working while displaying only the resolved name', async () => {
  const result = await run({
    ...query,
    filters: {
      combinator: 'and',
      rules: [{ field: 'subject_key', op: 'eq', value: `person:${personIds[0]}` }],
    },
  })
  const rows = result.groups.flatMap((group) => group.rows)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.subject_key).toBe('Foreman, Alex')
})

it('counts distinct people by identity even when they have identical displayed names', async () => {
  const result = await run({
    ...query,
    mode: 'summarize',
    columns: [],
    groupBy: null,
    measures: [{ fn: 'count_distinct', column: 'subject_key' }],
    filters: { combinator: 'and', rules: [{ field: 'obligation_id', op: 'eq', value: journal }] },
  })
  expect(Number(result.groups.flatMap((group) => group.rows)[0]?.m0)).toBe(5)
})

it('continues to reject internal fields rather than turning them into readable count projections', async () => {
  const catalog = {
    entities: BEACON_REPORT_CATALOG.entities.map((source) =>
      source.key === query.entity
        ? {
            ...source,
            columns: source.columns.map((column) =>
              column.key === 'subject_key' ? { ...column, hidden: true } : column,
            ),
          }
        : source,
    ),
  }
  await expect(
    withTenant(app.db, tenantId, (tx) =>
      runBeaconReport(
        tx,
        tenantId,
        {
          ...query,
          mode: 'summarize',
          columns: [],
          groupBy: null,
          measures: [{ fn: 'count_distinct', column: 'subject_key' }],
        },
        catalog,
      ),
    ),
  ).rejects.toThrow('internal column')
})
