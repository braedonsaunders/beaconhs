// Runtime smoke-test for obligation EDIT semantics against a configured database.
// Mirrors what `updateObligation` / `setObligationEnabled` / `deleteObligation`
// do (update + audience replace + re-materialize + scoreboard purge) and
// asserts the compliance_status scoreboard tracks every transition. Inserts a
// throwaway obligation, mutates it, cleans up.
//
//   cd apps/web && DATABASE_URL='postgresql://beaconhs:beaconhs@localhost:5433/beaconhs' \
//     npx tsx scripts/verify-obligation-edit.ts

import { and, eq, isNull, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import * as s from '@beaconhs/db/schema'
import { materializeObligation } from '@beaconhs/compliance'

function assert(cond: boolean, label: string) {
  if (cond) console.log(`✔ ${label}`)
  else {
    console.error(`✗ FAILED: ${label}`)
    process.exitCode = 1
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const { db, sql: pg } = createClient({ url: process.env.DATABASE_URL, max: 1 })

  // Pick a tenant with at least 2 active people so audience changes are visible.
  const tenants = await db.select({ id: s.tenants.id }).from(s.tenants)
  let tenantId: string | undefined
  let peopleCount = 0
  for (const t of tenants) {
    const rows = await withTenant(db, t.id, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.people)
        .where(and(eq(s.people.status, 'active'), isNull(s.people.deletedAt))),
    )
    const n = Number(rows[0]?.n ?? 0)
    if (n >= 2) {
      tenantId = t.id
      peopleCount = n
      break
    }
  }
  if (!tenantId) throw new Error('no tenant with ≥2 active people')
  const tid = tenantId
  const T = <R>(fn: (tx: typeof db) => Promise<R>) => withTenant(db, tid, fn)
  console.log(`tenant ${tid} · ${peopleCount} active people`)

  // Create a journal/everyone obligation (the broadest audience) + materialize.
  const obId = await T(async (tx) => {
    const [ob] = await tx
      .insert(s.complianceObligations)
      .values({
        tenantId: tid,
        sourceModule: 'journal' as never,
        subjectKind: 'per_person' as never,
        title: '__verify edit (before)',
        targetRef: {},
        recurrence: { kind: 'frequency', frequency: 'week', quantity: 1 } as never,
        recurrenceKind: 'frequency' as never,
      })
      .returning({ id: s.complianceObligations.id })
    await tx
      .insert(s.complianceAudience)
      .values({ tenantId: tid, obligationId: ob!.id, kind: 'everyone' as never, entityKey: '' })
    return ob!.id
  })
  const remat = () =>
    T(async (tx) => {
      const [ob] = await tx
        .select()
        .from(s.complianceObligations)
        .where(eq(s.complianceObligations.id, obId))
        .limit(1)
      return materializeObligation(tx, tid, ob!)
    })
  const statusCount = async () => {
    const rows = await T((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.complianceStatus)
        .where(eq(s.complianceStatus.obligationId, obId)),
    )
    return Number(rows[0]?.n ?? 0)
  }

  await remat()
  const before = await statusCount()
  assert(
    before === peopleCount,
    `create+materialize: ${before} status rows == ${peopleCount} people`,
  )

  // EDIT 1 — what updateObligation does: title/recurrence update + audience
  // replaced wholesale (everyone → one person) + re-materialize. The scoreboard
  // must shrink to exactly 1 via materialize's delete-stale.
  const [person] = await T((tx) =>
    tx
      .select({ id: s.people.id })
      .from(s.people)
      .where(and(eq(s.people.status, 'active'), isNull(s.people.deletedAt)))
      .limit(1),
  )
  await T(async (tx) => {
    await tx
      .update(s.complianceObligations)
      .set({
        title: '__verify edit (after)',
        recurrence: { kind: 'frequency', frequency: 'month', quantity: 2 } as never,
      })
      .where(eq(s.complianceObligations.id, obId))
    await tx.delete(s.complianceAudience).where(eq(s.complianceAudience.obligationId, obId))
    await tx.insert(s.complianceAudience).values({
      tenantId: tid,
      obligationId: obId,
      kind: 'person' as never,
      entityKey: person!.id,
    })
  })
  await remat()
  const afterShrink = await statusCount()
  assert(afterShrink === 1, `edit (everyone→1 person): status rows ${afterShrink} == 1`)
  const [row] = await T((tx) =>
    tx
      .select({
        title: s.complianceObligations.title,
        recurrence: s.complianceObligations.recurrence,
      })
      .from(s.complianceObligations)
      .where(eq(s.complianceObligations.id, obId))
      .limit(1),
  )
  assert(row?.title === '__verify edit (after)', 'edit: title persisted')
  assert(
    (row?.recurrence as { quantity?: number } | null)?.quantity === 2,
    'edit: recurrence persisted',
  )

  // EDIT 2 — grow back (1 person → everyone): scoreboard re-expands.
  await T(async (tx) => {
    await tx.delete(s.complianceAudience).where(eq(s.complianceAudience.obligationId, obId))
    await tx
      .insert(s.complianceAudience)
      .values({ tenantId: tid, obligationId: obId, kind: 'everyone' as never, entityKey: '' })
  })
  await remat()
  const afterGrow = await statusCount()
  assert(
    afterGrow === peopleCount,
    `edit (1 person→everyone): status rows ${afterGrow} == ${peopleCount}`,
  )

  // PAUSE — the hub's scoreboard reads filter status='active', so a paused
  // obligation must drop out of rollups without touching its status rows.
  await T((tx) =>
    tx
      .update(s.complianceObligations)
      .set({ status: 'paused' })
      .where(eq(s.complianceObligations.id, obId)),
  )
  const visible = await T((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.complianceStatus)
      .innerJoin(
        s.complianceObligations,
        eq(s.complianceObligations.id, s.complianceStatus.obligationId),
      )
      .where(
        and(
          eq(s.complianceStatus.obligationId, obId),
          eq(s.complianceObligations.status, 'active'),
          isNull(s.complianceObligations.deletedAt),
        ),
      ),
  )
  assert(Number(visible[0]?.n) === 0, 'pause: hub-style active filter hides all status rows')

  // DELETE — what deleteObligation does: soft delete + purge the scoreboard.
  await T(async (tx) => {
    await tx
      .update(s.complianceObligations)
      .set({ deletedAt: new Date(), status: 'archived' })
      .where(eq(s.complianceObligations.id, obId))
    await tx.delete(s.complianceStatus).where(eq(s.complianceStatus.obligationId, obId))
  })
  const afterDelete = await statusCount()
  assert(afterDelete === 0, 'delete: scoreboard purged')

  // Cleanup (hard delete the throwaway obligation + audience).
  await T(async (tx) => {
    await tx.delete(s.complianceAudience).where(eq(s.complianceAudience.obligationId, obId))
    await tx.delete(s.complianceObligations).where(eq(s.complianceObligations.id, obId))
  })
  console.log('cleaned up')
  await pg.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
