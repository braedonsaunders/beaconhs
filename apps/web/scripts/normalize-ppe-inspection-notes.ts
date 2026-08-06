// One-time repair: legacy PPE inspection notes imported from the old Laravel
// app carry rich-text HTML (`<p>Model - 1161571C</p><p>serial - 3303972</p>`),
// but `ppe_inspections.notes` is a plain-text column everywhere else — the app
// writes it from a <Textarea>, searches it with ILIKE, and renders it as text.
// The markup therefore showed up verbatim in the inspection-history table.
//
// Converts those rows with the same helper the rest of the app uses for legacy
// rich text, so exports, search, and PDFs agree with the screen.
//
//   pnpm --filter @beaconhs/web exec tsx --env-file=../../.env \
//     scripts/normalize-ppe-inspection-notes.ts [--apply]
//
// Without --apply it reports what would change and writes nothing.

import { htmlToText } from '@beaconhs/forms-core'
import { createSuperClient } from '@beaconhs/db/client'

// A real tag, not a stray comparison like "torque < 50 Nm".
const LOOKS_LIKE_HTML = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const { sql } = createSuperClient()

  const rows = await sql<{ id: string; notes: string }[]>`
    select id, notes
    from ppe_inspections
    where notes is not null and notes <> ''
  `

  const changes: { id: string; before: string; after: string }[] = []
  for (const row of rows) {
    if (!LOOKS_LIKE_HTML.test(row.notes)) continue
    const after = htmlToText(row.notes)
    if (after === row.notes) continue
    changes.push({ id: row.id, before: row.notes, after })
  }

  console.log(`scanned ${rows.length} notes · ${changes.length} contain HTML markup`)
  for (const change of changes.slice(0, 5)) {
    console.log(`  ${JSON.stringify(change.before.slice(0, 90))}`)
    console.log(`   → ${JSON.stringify(change.after.slice(0, 90))}`)
  }
  if (changes.length > 5) console.log(`  … and ${changes.length - 5} more`)

  // An emptied note means the source held markup and nothing else; null it out
  // rather than leaving an empty string the UI would render as a blank cell.
  if (!apply) {
    console.log('\ndry run — re-run with --apply to write these changes')
    await sql.end()
    return
  }

  let updated = 0
  for (const change of changes) {
    const value = change.after.trim() === '' ? null : change.after
    await sql`update ppe_inspections set notes = ${value} where id = ${change.id}::uuid`
    updated += 1
  }
  console.log(`\napplied — ${updated} rows updated`)
  await sql.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
