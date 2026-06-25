// Proves the dashboard widget gate: a self-tier viewer sees ONLY personal
// widgets (no org/aggregate cards, no Insights library cards, no tenant summary)
// while a manager sees everything. Pure (no DB) — `canSeeWidget` reads only
// ctx.permissions + isSuperAdmin.
//
//   cd apps/web && npx tsx scripts/verify-widget-access.ts

import { WIDGETS } from '../src/app/(app)/dashboard/_widget-registry'
import { canSeeOrgAggregates, canSeeWidget } from '../src/app/(app)/dashboard/_widget-access'

const mkCtx = (perms: string[], isSuperAdmin = false): any => ({
  isSuperAdmin,
  permissions: new Set(perms),
})

// A field worker: only `*.read.self` (the resolver default) — no org access.
const worker = mkCtx([
  'incidents.read.self',
  'ca.read.self',
  'journals.read.self',
  'forms.response.read.self',
  'inspections.read.self',
  'hazid.read.self',
  'training.read.self',
  'documents.read',
])
// A manager: broad reads across modules + analytics.
const manager = mkCtx([
  'incidents.read.all',
  'ca.read.all',
  'training.read.all',
  'ppe.read.all',
  'forms.response.read.all',
  'inspections.read.all',
  'documents.manage',
  'admin.org.manage',
  'reports.read',
])
const FAKE_CARD_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) {
    failures++
    console.log(`  ✗ FAIL ${name} ${detail}`)
  }
}

// Every registry widget: worker sees it IFF it's personal; manager sees all.
let personalSeen = 0
let orgHiddenFromWorker = 0
for (const id of Object.keys(WIDGETS)) {
  const isPersonal = id.startsWith('personal-')
  const workerSees = canSeeWidget(worker, id)
  check(`worker ${id}`, workerSees === isPersonal, `expected ${isPersonal} got ${workerSees}`)
  check(`manager ${id}`, canSeeWidget(manager, id) === true, `manager should see ${id}`)
  if (isPersonal && workerSees) personalSeen++
  if (!isPersonal && !workerSees) orgHiddenFromWorker++
}

// Placed Insights library card (UUID, not a registry widget) → analytics access only.
check('worker library card hidden', canSeeWidget(worker, FAKE_CARD_UUID) === false)
check('manager library card visible', canSeeWidget(manager, FAKE_CARD_UUID) === true)

// Header tenant summary gate.
check('worker org aggregates hidden', canSeeOrgAggregates(worker) === false)
check('manager org aggregates visible', canSeeOrgAggregates(manager) === true)

// Super-admin sees everything regardless of permissions.
const sa = mkCtx([], true)
check('super-admin sees an org widget', canSeeWidget(sa, 'kpi-open-cas') === true)
check('super-admin sees a library card', canSeeWidget(sa, FAKE_CARD_UUID) === true)

console.log(
  `worker: ${personalSeen} personal widgets visible, ${orgHiddenFromWorker} org widgets hidden`,
)
console.log(
  failures === 0
    ? '\n✔ all widget-access assertions passed'
    : `\n✗ ${failures} assertion(s) FAILED`,
)
if (failures > 0) process.exit(1)
