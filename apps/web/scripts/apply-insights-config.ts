// Surgical dev-DB apply for the AI/metric card foundation: the `ai` card-kind
// enum value + the insight_cards.config column. Idempotent; no RLS impact
// (plain ADD COLUMN / ADD VALUE), so no db:migrate re-apply needed.
//   pnpm --filter @beaconhs/worker exec tsx --env-file=../../.env ../web/scripts/apply-insights-config.ts
import { sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'

async function main() {
  await db.execute(sql.raw(`ALTER TYPE insight_card_kind ADD VALUE IF NOT EXISTS 'ai'`))
  await db.execute(sql.raw(`ALTER TABLE insight_cards ADD COLUMN IF NOT EXISTS config jsonb`))
  console.log('Applied: insight_card_kind += ai, insight_cards.config column.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Apply FAILED:', err)
  process.exit(1)
})
