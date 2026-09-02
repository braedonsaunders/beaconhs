/**
 * One-shot Rassaun catalog cleanup: drop generic certificate / wallet-card
 * defaults and the Working at Heights field card, then unpin those ids from
 * every course. Does not touch uploaded record attachments.
 *
 * Dry run:
 *   DATABASE_URL=... pnpm --filter @beaconhs/web exec tsx scripts/cleanup-rassaun-credential-designs.ts
 * Apply:
 *   DATABASE_URL=... pnpm --filter @beaconhs/web exec tsx scripts/cleanup-rassaun-credential-designs.ts --apply
 */

import { createClient } from '@beaconhs/db'
import { CREDENTIAL_OUTPUTS_SETTINGS_KEY } from '../src/lib/credential-designs'
import { courseCredentialOutputIds } from '../src/lib/credential-designs'

const APPLY = process.argv.includes('--apply')
const TENANT_SLUG = 'rassaun'
const REMOVE_IDS = new Set(['certificate', 'wallet-card'])

function looksLikeWahFieldCard(output: { id?: unknown; name?: unknown }): boolean {
  const id = typeof output.id === 'string' ? output.id.toLowerCase() : ''
  const name = typeof output.name === 'string' ? output.name.toLowerCase() : ''
  return (
    id.includes('working-at-heights') ||
    id.includes('field-card') ||
    name.includes('working at heights') ||
    (name.includes('field card') && name.includes('height'))
  )
}

function asOutputs(settings: unknown): Array<Record<string, unknown>> {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)[CREDENTIAL_OUTPUTS_SETTINGS_KEY]
      : null
  return Array.isArray(raw)
    ? raw.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
      )
    : []
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const { sql } = createClient({ url: databaseUrl, max: 1 })

const tenants = await sql`
  select id, settings
    from tenants
   where slug = ${TENANT_SLUG}
   limit 1
`
const tenant = tenants[0] as { id: string; settings: Record<string, unknown> } | undefined
if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} was not found`)

const current = asOutputs(tenant.settings)
const removeIds = new Set(
  current
    .filter((output) => REMOVE_IDS.has(String(output.id ?? '')) || looksLikeWahFieldCard(output))
    .map((output) => String(output.id)),
)
const kept = current.filter((output) => !removeIds.has(String(output.id ?? '')))
if (kept.length === 0) {
  throw new Error(
    `Refusing to empty the ${TENANT_SLUG} credential catalog. Remaining designs: ${current.map((o) => o.id).join(', ') || '(none)'}`,
  )
}

const courses = (await sql`
  select id, name, metadata
    from training_courses
   where tenant_id = ${tenant.id}::uuid
`) as Array<{ id: string; name: string; metadata: Record<string, unknown> | null }>

const pinUpdates = courses.flatMap((course) => {
  const pinned = courseCredentialOutputIds(course.metadata)
  if (!pinned.some((id) => removeIds.has(id))) return []
  return [
    {
      id: course.id,
      name: course.name,
      next: pinned.filter((id) => !removeIds.has(id)),
    },
  ]
})

console.log(
  JSON.stringify(
    {
      apply: APPLY,
      tenantId: tenant.id,
      removed: [...removeIds],
      kept: kept.map((output) => output.id),
      coursesUpdated: pinUpdates.length,
    },
    null,
    2,
  ),
)

if (!APPLY) {
  console.log('Dry run. Re-run with --apply to write.')
  await sql.end({ timeout: 5 })
  process.exit(0)
}

await sql.begin(async (tx) => {
  const settings = { ...(tenant.settings ?? {}), [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: kept }
  await tx`
    update tenants
       set settings = ${JSON.stringify(settings)}::jsonb
     where id = ${tenant.id}::uuid
  `
  for (const course of pinUpdates) {
    const current = courses.find((row) => row.id === course.id)?.metadata
    const metadata = {
      ...(current && typeof current === 'object' ? current : {}),
      credentialOutputIds: course.next,
    }
    await tx`
      update training_courses
         set metadata = ${JSON.stringify(metadata)}::jsonb
       where id = ${course.id}::uuid
         and tenant_id = ${tenant.id}::uuid
    `
  }
})

console.log('Applied.')
await sql.end({ timeout: 5 })
