// Carry the legacy BeaconHS bcrypt password hashes across so migrated people
// sign in with the password they already know, instead of 200+ users each
// needing a reset link on cutover day.
//
// The legacy app (Laravel) stored `$2y$` bcrypt hashes in `beaconhs.users`.
// Better-Auth writes scrypt, but accepts a custom verifier: see
// `@beaconhs/auth` → `legacy-password.ts`, which dispatches on the stored
// hash's own prefix. Both formats therefore live in `account.password` at once,
// and nothing here needs to re-hash anything.
//
// Idempotent, and deliberately non-destructive: a user who ALREADY has a
// credential account is skipped, never overwritten. Anyone who has already set
// a password in the new app keeps it — re-running after a data reload only
// fills in the accounts that are missing.
//
// Run with:
//   pnpm --filter @beaconhs/db exec tsx --env-file=../../.env \
//     src/scripts/import-legacy-passwords.ts [--apply]
//
// Without --apply it reports what it would do and writes nothing.

import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createSuperClient } from '../client'

const BCRYPT_PREFIX = /^\$2[axyb]\$/

type LegacyRow = { email: string; password: string }

async function main() {
  const apply = process.argv.includes('--apply')
  const legacyUrl = process.env.ETL_SOURCE_URL
  if (!legacyUrl) {
    throw new Error(
      'ETL_SOURCE_URL is required — it points at the landing database holding beaconhs.users.',
    )
  }

  const legacy = postgres(legacyUrl, { max: 1 })
  const { sql } = createSuperClient({ max: 1 })

  try {
    const legacyRows = (await legacy`
      select lower(btrim(email)) as email, password
        from beaconhs.users
       where email is not null
         and btrim(email) <> ''
         and password is not null
         and password like '$2%'
    `) as unknown as LegacyRow[]

    // Last row wins on duplicate emails; legacy allowed case variants.
    const hashByEmail = new Map<string, string>()
    for (const row of legacyRows) {
      if (BCRYPT_PREFIX.test(row.password)) hashByEmail.set(row.email, row.password)
    }

    const targets = (await sql`
      select u.id, lower(btrim(u.email)) as email
        from "user" u
       where not exists (
         select 1 from account a
          where a."userId" = u.id and a."providerId" = 'credential'
       )
    `) as unknown as { id: string; email: string }[]

    const toInsert = targets.flatMap((user) => {
      const password = hashByEmail.get(user.email)
      return password ? [{ userId: user.id, email: user.email, password }] : []
    })
    const unmatched = targets.filter((u) => !hashByEmail.has(u.email))

    console.log(`legacy bcrypt hashes:      ${hashByEmail.size}`)
    console.log(`users lacking a password:  ${targets.length}`)
    console.log(`  → will be given one:     ${toInsert.length}`)
    console.log(`  → no legacy hash:        ${unmatched.length}`)
    for (const u of unmatched) console.log(`      ${u.email}`)

    if (!apply) {
      console.log('\nDRY RUN — pass --apply to write.')
      return
    }

    let inserted = 0
    for (const row of toInsert) {
      // accountId mirrors userId for credential accounts, matching the rows
      // Better-Auth creates itself.
      const result = await sql`
        insert into account ("id", "userId", "accountId", "providerId", "password",
                             "createdAt", "updatedAt")
        values (${randomUUID()}, ${row.userId}, ${row.userId}, 'credential', ${row.password},
                now(), now())
        on conflict do nothing
      `
      inserted += result.count ?? 0
    }
    console.log(`\ninserted ${inserted} credential account(s).`)
  } finally {
    await legacy.end({ timeout: 5 })
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
