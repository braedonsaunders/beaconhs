// One-time repair: correct PPE custody misread from the legacy import.
//
// The legacy PPEASSIGNED.EmpID means "last assigned to", not "currently
// holds" — 222 of its 226 Retired rows still carry an EmpID. The importer
// read it as current custody and derived status from whether that person is
// still active:
//
//     retired ? 'discarded' : holderActive ? 'issued' : holder ? 'returned' : 'in_stock'
//
// Two things went wrong:
//
//  1. Legacy `Active` rows whose holder has since gone inactive were recorded
//     as 'returned'. Nothing was returned — that gear is still out with people
//     who left. "This person left" was silently rewritten as "the gear came
//     back", hiding it from the register and from their profile.
//
//  2. Legacy `Retired` rows kept the stale EmpID on a terminal status. The
//     app's own discard clears the holder and keeps the person in the ledger,
//     so imported discards contradict how the app behaves natively.
//
// Both corrections come straight from the legacy Status column, via the
// etl.id_map crosswalk. The ledger is untouched: it already records who had
// each item and when.
//
//   pnpm --filter @beaconhs/web exec tsx --env-file=../../.env \
//     scripts/restore-ppe-custody-from-legacy.ts [--apply]
//
// Dry-run by default. Reads the legacy mirror through LEGACY_DATABASE_URL
// (the runtime role cannot see the legacy schema).

import { createClient, createSuperClient } from '@beaconhs/db/client'

function legacyUrl(): string {
  const explicit = process.env.LEGACY_DATABASE_URL
  if (explicit) return explicit
  const base = process.env.SUPERADMIN_DATABASE_URL ?? process.env.DATABASE_URL
  if (!base) throw new Error('Set LEGACY_DATABASE_URL (or DATABASE_URL) to reach the legacy mirror')
  return base.replace(/\/[^/?]+(\?|$)/, '/rassaun$1')
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const { sql } = createSuperClient()
  const { sql: legacy } = createClient({ url: legacyUrl(), max: 2 })

  const legacyRows = await legacy<{ id: number; status: string | null }[]>`
    select id, "Status" as status from beaconhs."PPEASSIGNED"
  `
  const legacyStatusByPk = new Map(legacyRows.map((row) => [String(row.id), row.status ?? '']))

  const mapped = await sql<{ pk: string; itemId: string }[]>`
    select source_pk as pk, new_id as "itemId"
    from etl.id_map
    where source_db = 'beaconhs' and source_table = 'PPEASSIGNED' and entity_type = 'ppe_item'
  `

  const current = new Map(
    (
      await sql<{ id: string; status: string; holder: string | null }[]>`
        select id, status, current_holder_person_id as holder
        from ppe_items where deleted_at is null
      `
    ).map((row) => [row.id, row]),
  )

  const stillOut: string[] = [] // returned → issued, holder kept
  const clearHolder: string[] = [] // discarded → drop the stale holder

  for (const { pk, itemId } of mapped) {
    const item = current.get(itemId)
    if (!item) continue
    const wasRetired = /retire/i.test(legacyStatusByPk.get(pk) ?? '')
    if (!wasRetired && item.status === 'returned' && item.holder) stillOut.push(itemId)
    if (wasRetired && item.status === 'discarded' && item.holder) clearHolder.push(itemId)
  }

  console.log(`legacy assignment rows mapped   : ${mapped.length}`)
  console.log(`  still out (returned → issued) : ${stillOut.length}`)
  console.log(`  discarded, stale holder cleared: ${clearHolder.length}`)

  if (!apply) {
    console.log('\ndry run — re-run with --apply to write these changes')
    await Promise.all([sql.end(), legacy.end()])
    return
  }

  // Deliberately NOT stamping status_changed_at: this corrects how the import
  // read history, it is not a custody event happening today.
  for (const id of stillOut) {
    await sql`update ppe_items set status = 'issued' where id = ${id}::uuid and status = 'returned'`
  }
  for (const id of clearHolder) {
    await sql`
      update ppe_items set current_holder_person_id = null
      where id = ${id}::uuid and status = 'discarded'
    `
  }

  console.log(
    `\napplied — ${stillOut.length} items back to issued, ${clearHolder.length} discarded items unassigned`,
  )
  await Promise.all([sql.end(), legacy.end()])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
