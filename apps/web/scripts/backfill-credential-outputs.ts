/**
 * One-time clean-cutover materialization of the retired
 * tenants.settings.trainingCredentialDesign object into canonical credential
 * outputs with complete Design Studio documents.
 *
 * Audit only (default):
 *   pnpm --filter @beaconhs/web exec tsx scripts/backfill-credential-outputs.ts
 * Apply after migration 0004:
 *   ... backfill-credential-outputs.ts --apply
 */

import { createClient } from '@beaconhs/db'
import {
  createCertificateDesignDocument,
  createWalletDesignDocument,
} from '@beaconhs/design-studio'
import {
  CREDENTIAL_OUTPUTS_SETTINGS_KEY,
  normalizeCredentialOutputs,
  type CredentialOutput,
} from '../src/lib/credential-designs'

const DATABASE_URL = process.env.SUPERADMIN_DATABASE_URL
if (!DATABASE_URL) throw new Error('SUPERADMIN_DATABASE_URL is required')

const APPLY = process.argv.includes('--apply')
const LEGACY_KEY = 'trainingCredentialDesign'
const LOCK_NAME = 'beaconhs:credential-output-cutover:v1'
const { sql } = createClient({ url: DATABASE_URL, max: 1 })

type TenantSettingsRow = {
  id: string
  settings: Record<string, unknown>
}

function rawOutputs(settings: Record<string, unknown>): unknown[] {
  const configured = settings[CREDENTIAL_OUTPUTS_SETTINGS_KEY]
  if (Array.isArray(configured)) return configured
  if (
    configured &&
    typeof configured === 'object' &&
    Array.isArray((configured as { outputs?: unknown }).outputs)
  ) {
    return (configured as { outputs: unknown[] }).outputs
  }
  throw new Error('Canonical credential outputs were not created by migration 0004')
}

function materializeDocuments(settings: Record<string, unknown>): CredentialOutput[] {
  const raw = rawOutputs(settings)
  const normalized = normalizeCredentialOutputs({ [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: raw })
  const withDocuments = normalized.map((output, index) => {
    const original = raw[index]
    const hasDocument =
      original !== null &&
      typeof original === 'object' &&
      (original as Record<string, unknown>).document !== undefined
    if (hasDocument) return output
    return {
      ...output,
      document:
        output.format === 'wallet'
          ? createWalletDesignDocument(output)
          : createCertificateDesignDocument(output),
    }
  })
  return normalizeCredentialOutputs({ [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: withDocuments })
}

async function assertComplete(): Promise<void> {
  const [result] = await sql<{ legacy_settings: number; missing_documents: number }[]>`select
      count(*) filter (where settings ? ${LEGACY_KEY})::int as legacy_settings,
      count(*) filter (
        where exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) = 'array'
                then settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}
              else '[]'::jsonb
            end
          ) output
          where not (output ? 'document')
        )
      )::int as missing_documents
    from tenants`
  if (!result || result.legacy_settings !== 0 || result.missing_documents !== 0) {
    throw new Error(`Credential output cutover assertion failed: ${JSON.stringify(result ?? {})}`)
  }
}

async function main(): Promise<void> {
  const rows = await sql<TenantSettingsRow[]>`
    select id::text, settings
    from tenants
    where settings ? ${LEGACY_KEY}
    order by id
  `
  const materialized = rows.map((row) => ({
    ...row,
    outputs: materializeDocuments(row.settings),
  }))
  console.log(
    `[credential-output-cutover] mode=${APPLY ? 'APPLY' : 'AUDIT-ONLY'} tenants=${rows.length} outputs=${materialized.reduce((count, row) => count + row.outputs.length, 0)}`,
  )
  if (!APPLY) {
    console.log('[credential-output-cutover] audit passed; rerun with --apply after migration 0004')
    return
  }

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${LOCK_NAME}, 0))`
    for (const row of materialized) {
      const [current] = await tx<TenantSettingsRow[]>`
        select id::text, settings
        from tenants
        where id = ${row.id}::uuid
        for update
      `
      if (!current || JSON.stringify(current.settings) !== JSON.stringify(row.settings)) {
        throw new Error('Tenant credential settings changed during the cutover')
      }
      await tx`
        update tenants
        set settings = jsonb_set(
          settings - ${LEGACY_KEY},
          ${`{${CREDENTIAL_OUTPUTS_SETTINGS_KEY}}`}::text[],
          ${JSON.stringify(row.outputs)}::jsonb,
          true
        ),
        updated_at = now()
        where id = ${row.id}::uuid
      `
    }
  })
  await assertComplete()
  console.log('[credential-output-cutover] complete')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end()
  })
