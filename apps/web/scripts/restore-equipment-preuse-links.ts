// One-time repair: reconnect imported equipment to its inspection checklists.
//
// The legacy toolCRIB EQUIPMENT table records, per unit, which inspection bank
// is its pre-use checklist (PreUseInspectionID) and which is its annual one
// (AnnualInspectionID). The importer mapped neither, and it derived a type's
// `is_pre_use` flag purely from the bank's free-text Interval column — which
// reads "Daily" for every pre-use checklist, so nothing was ever flagged.
//
// The consequences compound: with no type flagged pre-use, the picker that
// sets a unit's pre-use checklist returns nothing, so no unit can have one,
// so the pre-use section never appears and its checklist is empty.
//
// Restores three things from the legacy source, via the etl.id_map crosswalk:
//   1. equipment_inspection_types.is_pre_use for banks actually used as a
//      unit's pre-use checklist (or named "…pre-use")
//   2. equipment_items.pre_use_inspection_type_id
//   3. equipment_inspection_schedules.inspection_type_id for the migrated
//      annual schedules, so a schedule can drive which inspection to start
//
//   pnpm --filter @beaconhs/web exec tsx --env-file=../../.env \
//     scripts/restore-equipment-preuse-links.ts [--apply]
//
// Without --apply it reports what would change and writes nothing. Reads the
// legacy mirror through LEGACY_DATABASE_URL (defaults to the `rassaun` DB on
// the same cluster as DATABASE_URL).

import { createClient, createSuperClient } from '@beaconhs/db/client'

function legacyUrl(): string {
  const explicit = process.env.LEGACY_DATABASE_URL
  if (explicit) return explicit
  const base = process.env.SUPERADMIN_DATABASE_URL ?? process.env.DATABASE_URL
  if (!base) throw new Error('Set LEGACY_DATABASE_URL (or DATABASE_URL) to reach the legacy mirror')
  return base.replace(/\/[^/?]+(\?|$)/, '/rassaun$1')
}

type LegacyRow = { id: number; preUseBankId: number | null; annualBankId: number | null }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const { sql } = createSuperClient()
  const { sql: legacy } = createClient({ url: legacyUrl(), max: 2 })

  const legacyRows = await legacy<LegacyRow[]>`
    select id,
           nullif("PreUseInspectionID", 0) as "preUseBankId",
           nullif("AnnualInspectionID", 0) as "annualBankId"
    from toolcrib."EQUIPMENT"
    where "PreUseInspectionID" is not null or "AnnualInspectionID" is not null
  `

  // Crosswalk legacy pk → the uuid the importer created.
  const itemMap = new Map<string, string>()
  const typeMap = new Map<string, string>()
  for (const row of await sql<{ pk: string; id: string; entity: string }[]>`
    select source_pk as pk, new_id as id, entity_type as entity
    from etl.id_map
    where source_db = 'toolcrib'
      and entity_type in ('equipment_item', 'equipment_inspection_type')
  `) {
    ;(row.entity === 'equipment_item' ? itemMap : typeMap).set(row.pk, row.id)
  }

  const preUseTypeIds = new Set<string>()
  const itemUpdates: { itemId: string; typeId: string }[] = []
  const scheduleUpdates: { itemId: string; typeId: string }[] = []
  let unresolved = 0

  for (const row of legacyRows) {
    const itemId = itemMap.get(String(row.id))
    if (!itemId) {
      unresolved += 1
      continue
    }
    const preUseTypeId = row.preUseBankId ? typeMap.get(String(row.preUseBankId)) : undefined
    if (preUseTypeId) {
      preUseTypeIds.add(preUseTypeId)
      itemUpdates.push({ itemId, typeId: preUseTypeId })
    }
    const annualTypeId = row.annualBankId ? typeMap.get(String(row.annualBankId)) : undefined
    if (annualTypeId) scheduleUpdates.push({ itemId, typeId: annualTypeId })
  }

  // A bank a unit points at IS a pre-use checklist regardless of its Interval
  // text; also catch the ones whose name says so but that no unit references.
  const namedPreUse = await sql<{ id: string }[]>`
    select id from equipment_inspection_types
    where name ~* '(pre[ -]?use|pre[ -]?op)'
  `
  for (const row of namedPreUse) preUseTypeIds.add(row.id)

  console.log(`legacy rows with an inspection link : ${legacyRows.length}`)
  console.log(`  units to link to a pre-use type   : ${itemUpdates.length}`)
  console.log(`  schedules to link to annual type  : ${scheduleUpdates.length}`)
  console.log(`  types to flag as pre-use          : ${preUseTypeIds.size}`)
  console.log(`  legacy units not in the crosswalk : ${unresolved}`)

  if (!apply) {
    console.log('\ndry run — re-run with --apply to write these changes')
    await Promise.all([sql.end(), legacy.end()])
    return
  }

  for (const typeId of preUseTypeIds) {
    await sql`update equipment_inspection_types set is_pre_use = true where id = ${typeId}::uuid`
  }
  for (const { itemId, typeId } of itemUpdates) {
    await sql`
      update equipment_items
      set pre_use_inspection_type_id = ${typeId}::uuid,
          requires_pre_use_inspection = true
      where id = ${itemId}::uuid
    `
  }
  // Only the importer's own annual schedules; a schedule someone set up in the
  // app is left exactly as they configured it.
  let schedulesLinked = 0
  for (const { itemId, typeId } of scheduleUpdates) {
    const updated = await sql`
      update equipment_inspection_schedules
      set inspection_type_id = ${typeId}::uuid
      where equipment_item_id = ${itemId}::uuid
        and inspection_type_id is null
        and notes = 'migrated:EQUIPMENT'
      returning id
    `
    schedulesLinked += updated.length
  }

  console.log(
    `\napplied — ${preUseTypeIds.size} types flagged, ${itemUpdates.length} units linked, ${schedulesLinked} schedules linked`,
  )
  await Promise.all([sql.end(), legacy.end()])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
