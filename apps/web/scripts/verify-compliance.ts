// Runtime smoke-test for the unified compliance engine against the live cluster.
// Inserts real obligations, runs the evaluation adapters, prints results, cleans
// up. Proves schema + RLS + adapter SQL actually execute end-to-end.
//
//   cd apps/web && DATABASE_URL='postgresql://…@10.0.0.85:5432/beaconhs?sslmode=disable' \
//     npx tsx scripts/verify-compliance.ts

import { and, eq, isNull, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import * as s from '@beaconhs/db/schema'
import { evaluateObligation, materializeObligation } from '@beaconhs/compliance'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const { db, sql: pg } = createClient({ url: process.env.DATABASE_URL, max: 1 })

  // Pick a tenant with active people (so per_person audiences resolve). RLS is
  // enforced, so every tenant-scoped query runs inside withTenant.
  const tenants = await db.select({ id: s.tenants.id }).from(s.tenants)
  let tenantId = tenants[0]?.id
  for (const t of tenants) {
    const rows = await withTenant(db, t.id, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.people)
        .where(and(eq(s.people.status, 'active'), isNull(s.people.deletedAt))),
    )
    if (Number(rows[0]?.n ?? 0) > 0) {
      tenantId = t.id
      break
    }
  }
  if (!tenantId) throw new Error('no tenant')
  const tid = tenantId
  const T = <R>(fn: (tx: typeof db) => Promise<R>) => withTenant(db, tid, fn)
  console.log(`tenant ${tid}`)

  const made: string[] = []
  const create = async (
    sourceModule: string,
    subjectKind: string,
    targetRef: object,
    recurrence: object,
    recurrenceKind: string,
  ) => {
    const id = await T(async (tx) => {
      const [ob] = await tx
        .insert(s.complianceObligations)
        .values({
          tenantId: tid,
          sourceModule: sourceModule as never,
          subjectKind: subjectKind as never,
          title: `__verify ${sourceModule}`,
          targetRef: targetRef as never,
          recurrence: recurrence as never,
          recurrenceKind: recurrenceKind as never,
        })
        .returning({ id: s.complianceObligations.id })
      return ob!.id
    })
    made.push(id)
    return id
  }

  // 1) per_person journal (everyone) — audience resolver + journal adapter
  const jId = await create('journal', 'per_person', {}, { kind: 'frequency', frequency: 'week', quantity: 1, compliantPercentage: 100 }, 'frequency')
  await T((tx) => tx.insert(s.complianceAudience).values({ tenantId: tid, obligationId: jId, kind: 'everyone' as never, entityKey: '' }))

  // 2) per_record equipment policy — per_record adapter
  const eId = await create('equipment_inspection', 'per_record', {}, { kind: 'expiry', remindBeforeDays: 30 }, 'expiry')

  // 3) per_task job-title sign-off (if a title exists)
  const [title] = await T((tx) => tx.select({ id: s.personTitles.id }).from(s.personTitles).limit(1))
  let tjId: string | null = null
  if (title) tjId = await create('job_title_signoff', 'per_task', { jobTitleId: title.id }, { kind: 'one_time' }, 'one_time')

  const cases: [string, string, { kind: 'everyone'; entityKey: string }[]][] = [
    ['journal/per_person', jId, [{ kind: 'everyone', entityKey: '' }]],
    ['equipment/per_record', eId, []],
    ...(tjId ? ([['job_title/per_task', tjId, []]] as [string, string, never[]][]) : []),
  ]
  for (const [label, id, audience] of cases) {
    const [ob] = await T((tx) => tx.select().from(s.complianceObligations).where(eq(s.complianceObligations.id, id)).limit(1))
    try {
      const r = await T((tx) => evaluateObligation(tx, tid, ob as never, audience as never))
      console.log(`✔ ${label}: ${r.totals.completed}/${r.totals.total} completed · ${r.totals.overdue} overdue · ${r.percent}% · ${r.rows.length} subject rows`)
    } catch (e) {
      console.log(`✗ ${label}: ${e instanceof Error ? e.message : e}`)
    }
  }

  // Materialise the journal obligation + read it back from compliance_status.
  await T(async (tx) => {
    const [ob] = await tx.select().from(s.complianceObligations).where(eq(s.complianceObligations.id, jId)).limit(1)
    await materializeObligation(tx, tid, ob!)
  })
  const statusRows = await T((tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(s.complianceStatus).where(eq(s.complianceStatus.obligationId, jId)),
  )
  console.log(`✔ materialize: compliance_status has ${statusRows[0]?.n ?? 0} rows for the journal obligation`)

  for (const id of made) {
    await T(async (tx) => {
      await tx.delete(s.complianceStatus).where(eq(s.complianceStatus.obligationId, id))
      await tx.delete(s.complianceAudience).where(eq(s.complianceAudience.obligationId, id))
      await tx.delete(s.complianceObligations).where(eq(s.complianceObligations.id, id))
    })
  }
  console.log(`cleaned up ${made.length} test obligations`)
  await pg.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
