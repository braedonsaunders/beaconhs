// Proves the per-user record-visibility model on REAL data: a self-tier user
// sees ONLY their own records (a strict subset), a manager (read.all) sees every
// row, and canSeeRecord() refuses a record owned by someone else. Read-only.
//
//   cd apps/web && DATABASE_URL=… npx tsx scripts/verify-visibility.ts

import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { createClient, withTenant } from '@beaconhs/db'
import * as s from '@beaconhs/db/schema'
import { canSeeRecord, moduleScopeWhere } from '../src/lib/visibility'

// Minimal RequestContext stand-ins (moduleScopeWhere/canSeeRecord only read
// isSuperAdmin, scopes, membership.id, userId, permissions).
const mkCtx = (o: Partial<any>): any => ({
  isSuperAdmin: false,
  scopes: [],
  membership: null,
  userId: '00000000-0000-0000-0000-000000000000',
  permissions: new Set<string>(),
  ...o,
})

let failures = 0
function check(name: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name} — ${detail}`)
  if (!ok) failures++
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
  const { db, sql: pg } = createClient({ url: process.env.DATABASE_URL, max: 1 })

  const [tenant] = await db
    .select({ id: s.tenants.id, name: s.tenants.name })
    .from(s.tenants)
    .where(eq(s.tenants.name, 'Rassaun Services Inc.'))
    .limit(1)
  const tid = tenant!.id
  const T = <R>(fn: (tx: typeof db) => Promise<R>) => withTenant(db, tid, fn)
  console.log(`tenant "${tenant!.name}"`)

  // Pick a self-tier user: the heaviest hazard-assessment reporter (so their own
  // subset is non-empty and clearly smaller than the whole tenant).
  const [reporter] = await T((tx) =>
    tx
      .select({ tu: s.hazidAssessments.reportedByTenantUserId, c: count() })
      .from(s.hazidAssessments)
      .where(isNull(s.hazidAssessments.deletedAt))
      .groupBy(s.hazidAssessments.reportedByTenantUserId)
      .orderBy(desc(count()))
      .limit(1),
  )
  const workerTu = reporter!.tu!
  const [tuRow] = await T((tx) =>
    tx
      .select({ userId: s.tenantUsers.userId })
      .from(s.tenantUsers)
      .where(eq(s.tenantUsers.id, workerTu))
      .limit(1),
  )
  const workerUserId = tuRow!.userId!

  const worker = mkCtx({ membership: { id: workerTu }, userId: workerUserId })
  const manager = mkCtx({
    permissions: new Set([
      'incidents.read.all',
      'ca.read.all',
      'inspections.read.all',
      'hazid.read.all',
      'forms.response.read.all',
    ]),
    scopes: [{ type: 'tenant' }],
  })

  // ── Per-module: manager count == total; worker count == own subset (< total). ──
  const modules = [
    {
      name: 'hazid',
      table: s.hazidAssessments,
      notDeleted: isNull(s.hazidAssessments.deletedAt),
      cols: {
        prefix: 'hazid',
        ownerCols: [s.hazidAssessments.reportedByTenantUserId],
        siteCol: s.hazidAssessments.siteOrgUnitId,
      },
      ownEq: eq(s.hazidAssessments.reportedByTenantUserId, workerTu),
    },
    {
      name: 'incidents',
      table: s.incidents,
      notDeleted: isNull(s.incidents.deletedAt),
      cols: {
        prefix: 'incidents',
        ownerCols: [s.incidents.reportedByTenantUserId],
        siteCol: s.incidents.siteOrgUnitId,
      },
      ownEq: eq(s.incidents.reportedByTenantUserId, workerTu),
    },
    {
      name: 'inspections',
      table: s.inspectionRecords,
      notDeleted: sql`true`,
      cols: {
        prefix: 'inspections',
        ownerCols: [
          s.inspectionRecords.inspectorTenantUserId,
          s.inspectionRecords.submittedByTenantUserId,
        ],
        siteCol: s.inspectionRecords.siteOrgUnitId,
      },
      ownEq: eq(s.inspectionRecords.inspectorTenantUserId, workerTu),
    },
  ] as const

  for (const m of modules) {
    const cnt = (where: any) =>
      T(async (tx) => {
        const rows = await tx
          .select({ c: count() })
          .from(m.table as any)
          .where(where)
        return Number(rows[0]?.c ?? 0)
      })
    const visMgr = await T((tx) => moduleScopeWhere(manager, tx, m.cols as any))
    const visSelf = await T((tx) => moduleScopeWhere(worker, tx, m.cols as any))
    const total = await cnt(m.notDeleted)
    const mgr = await cnt(and(m.notDeleted, visMgr))
    const self = await cnt(and(m.notDeleted, visSelf))
    const own = await cnt(and(m.notDeleted, m.ownEq))
    check(`${m.name}: manager sees all`, mgr === total, `manager=${mgr} total=${total}`)
    check(
      `${m.name}: worker sees only own subset`,
      self === own && self < total,
      `worker=${self} own=${own} total=${total}`,
    )
  }

  // ── canSeeRecord: worker may see a record they reported, not one they didn't. ──
  const [mine] = await T((tx) =>
    tx
      .select({
        id: s.hazidAssessments.id,
        owner: s.hazidAssessments.reportedByTenantUserId,
        site: s.hazidAssessments.siteOrgUnitId,
      })
      .from(s.hazidAssessments)
      .where(eq(s.hazidAssessments.reportedByTenantUserId, workerTu))
      .limit(1),
  )
  const [theirs] = await T((tx) =>
    tx
      .select({
        id: s.hazidAssessments.id,
        owner: s.hazidAssessments.reportedByTenantUserId,
        site: s.hazidAssessments.siteOrgUnitId,
      })
      .from(s.hazidAssessments)
      .where(
        sql`${s.hazidAssessments.reportedByTenantUserId} <> ${workerTu} and ${s.hazidAssessments.reportedByTenantUserId} is not null`,
      )
      .limit(1),
  )
  const canMine = await T((tx) =>
    canSeeRecord(worker, tx, { prefix: 'hazid', ownerIds: [mine!.owner], siteId: mine!.site }),
  )
  const canTheirs = await T((tx) =>
    canSeeRecord(worker, tx, { prefix: 'hazid', ownerIds: [theirs!.owner], siteId: theirs!.site }),
  )
  const mgrTheirs = await T((tx) =>
    canSeeRecord(manager, tx, { prefix: 'hazid', ownerIds: [theirs!.owner], siteId: theirs!.site }),
  )
  check('canSeeRecord: worker → own record', canMine === true, `got ${canMine}`)
  check(
    'canSeeRecord: worker → someone else’s record BLOCKED',
    canTheirs === false,
    `got ${canTheirs}`,
  )
  check('canSeeRecord: manager → any record', mgrTheirs === true, `got ${mgrTheirs}`)

  console.log(
    failures === 0 ? '\n✔ all visibility assertions passed' : `\n✗ ${failures} assertion(s) FAILED`,
  )
  await pg.end()
  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
