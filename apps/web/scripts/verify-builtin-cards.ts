// Offline verification: every built-in Insights card query validates + compiles
// against the live schema-discovered registry (no DB connection needed).
//   pnpm --filter @beaconhs/worker exec tsx ../web/scripts/verify-builtin-cards.ts
import { compileBhql, validateBhql } from '@beaconhs/analytics/server'
import { BUILTIN_QUERIES } from '../src/app/(app)/insights/_widgets'

let ok = 0
const fails: string[] = []
for (const [key, b] of Object.entries(BUILTIN_QUERIES)) {
  try {
    const q = validateBhql(b.query)
    compileBhql(q)
    ok++
  } catch (e) {
    fails.push(`${key}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
console.log(`${ok} compiled OK, ${fails.length} failed`)
for (const f of fails) console.log('  FAIL', f)
process.exit(fails.length ? 1 : 0)
