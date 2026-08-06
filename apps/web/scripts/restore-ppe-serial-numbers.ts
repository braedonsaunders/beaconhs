// One-time repair: restore PPE serial numbers the legacy import dropped.
//
// The importer nulls `serial_number` whenever it cannot prove the value is
// unique — `ppe_items` has a tenant-wide UNIQUE (tenant_id, serial_number), so
// a collision would abort the whole batch. It keeps the original text in
// `metadata.sourceSerialSnapshot`, which means most of those serials are
// recoverable after the fact, once the full picture is known.
//
// Restores a serial only when it is unambiguous:
//   - the snapshot is non-empty and not a placeholder
//   - no other item in the tenant already owns that serial
//   - exactly one candidate item claims it (case-insensitive)
// Anything ambiguous is left alone and reported, because guessing which of two
// items owns a serial is worse than leaving it blank.
//
//   pnpm --filter @beaconhs/web exec tsx --env-file=../../.env \
//     scripts/restore-ppe-serial-numbers.ts [--apply]

import { createSuperClient } from '@beaconhs/db/client'

const PLACEHOLDER = /^(n[/\\.]?a\.?|none|nil|tbd|unknown|[-.\s]+)$/i

type Candidate = { id: string; tenantId: string; snapshot: string }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const { sql } = createSuperClient()

  const candidates = await sql<Candidate[]>`
    select id, tenant_id as "tenantId", trim(metadata->>'sourceSerialSnapshot') as snapshot
    from ppe_items
    where serial_number is null
      and deleted_at is null
      and nullif(trim(metadata->>'sourceSerialSnapshot'), '') is not null
  `
  const taken = await sql<{ tenantId: string; serial: string }[]>`
    select tenant_id as "tenantId", serial_number as serial
    from ppe_items
    where serial_number is not null
  `

  const takenKeys = new Set(taken.map((r) => `${r.tenantId}::${r.serial.trim().toLowerCase()}`))
  const claims = new Map<string, Candidate[]>()
  const skippedPlaceholder: Candidate[] = []

  for (const row of candidates) {
    if (PLACEHOLDER.test(row.snapshot)) {
      skippedPlaceholder.push(row)
      continue
    }
    const key = `${row.tenantId}::${row.snapshot.toLowerCase()}`
    const bucket = claims.get(key)
    if (bucket) bucket.push(row)
    else claims.set(key, [row])
  }

  const restore: Candidate[] = []
  const skippedTaken: Candidate[] = []
  const skippedContested: Candidate[] = []
  for (const [key, bucket] of claims) {
    if (takenKeys.has(key)) {
      skippedTaken.push(...bucket)
      continue
    }
    if (bucket.length > 1) {
      skippedContested.push(...bucket)
      continue
    }
    restore.push(bucket[0]!)
  }

  console.log(`candidates with a stored serial : ${candidates.length}`)
  console.log(`  restorable (unambiguous)      : ${restore.length}`)
  console.log(`  skipped — serial already used : ${skippedTaken.length}`)
  console.log(`  skipped — two items claim it  : ${skippedContested.length}`)
  console.log(`  skipped — placeholder text    : ${skippedPlaceholder.length}`)

  if (!apply) {
    console.log('\ndry run — re-run with --apply to write these changes')
    await sql.end()
    return
  }

  let updated = 0
  for (const row of restore) {
    await sql`
      update ppe_items
      set serial_number = ${row.snapshot}
      where id = ${row.id}::uuid and serial_number is null
    `
    updated += 1
  }
  console.log(`\napplied — ${updated} serial numbers restored`)
  await sql.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
