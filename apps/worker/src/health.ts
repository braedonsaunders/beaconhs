import { assertDatabaseConfiguration, createClient, createSuperClient } from '@beaconhs/db'
import { assertRedisReady } from '@beaconhs/jobs/health'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const redisUrl = process.env.REDIS_URL
  if (!databaseUrl || !redisUrl) throw new Error('Required dependency URL is not configured')
  const authSecret = process.env.BETTER_AUTH_SECRET
  if (process.env.NODE_ENV === 'production' && (!authSecret || authSecret.length < 32)) {
    throw new Error('BETTER_AUTH_SECRET is not configured securely')
  }

  assertDatabaseConfiguration({ superAdmin: true })
  const { sql } = createClient({ url: databaseUrl, max: 1 })
  const { sql: superSql } = createSuperClient({ max: 1 })
  try {
    await Promise.all([sql`select 1`, superSql`select 1`, assertRedisReady({ url: redisUrl })])
  } finally {
    await Promise.all([sql.end({ timeout: 1 }), superSql.end({ timeout: 1 })])
  }
}

main().catch(() => {
  console.error('[health] worker dependencies are not ready')
  process.exitCode = 1
})
