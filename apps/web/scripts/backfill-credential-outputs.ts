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
  isDesignDocument,
} from '@beaconhs/design-studio'
import {
  CREDENTIAL_OUTPUTS_SETTINGS_KEY,
  normalizeCredentialOutputs,
  type CredentialOutput,
} from '../src/lib/credential-designs'
import { assertCutoverDatabaseSession, requireCutoverDatabaseTarget } from './cutover-target'

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = requireCutoverDatabaseTarget(APPLY)
const LEGACY_KEY = 'trainingCredentialDesign'
const LOCK_NAME = 'beaconhs:credential-output-cutover:v1'
const { sql } = createClient({ url: DATABASE_URL, max: 1 })

type TenantSettingsRow = {
  id: string
  settings: Record<string, unknown>
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Credential output contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  throw new Error(`Credential output contains unsupported ${typeof value}`)
}

function rawOutputs(settings: Record<string, unknown>): unknown[] {
  const configured = settings[CREDENTIAL_OUTPUTS_SETTINGS_KEY]
  if (!Array.isArray(configured) || configured.length === 0) {
    throw new Error('Migration 0004 did not create a non-empty credential output array')
  }
  return configured
}

function materializeDocuments(settings: Record<string, unknown>): CredentialOutput[] {
  const raw = rawOutputs(settings)
  const normalized = normalizeCredentialOutputs({ [CREDENTIAL_OUTPUTS_SETTINGS_KEY]: raw })
  const withDocuments = normalized.map((output, index) => {
    const original = raw[index]
    const hasDocument =
      original !== null &&
      typeof original === 'object' &&
      isDesignDocument((original as Record<string, unknown>).document)
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
  const [result] = await sql<
    {
      tenants: number
      legacy_settings: number
      invalid_outputs: number
      missing_documents: number
      duplicate_ids: number
    }[]
  >`select
      count(*)::int as tenants,
      count(*) filter (where settings ? ${LEGACY_KEY})::int as legacy_settings,
      count(*) filter (
        where settings ? ${CREDENTIAL_OUTPUTS_SETTINGS_KEY} and case
          when jsonb_typeof(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) = 'array'
            then jsonb_array_length(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) = 0
          else true
        end
      )::int as invalid_outputs,
      count(*) filter (
        where settings ? ${CREDENTIAL_OUTPUTS_SETTINGS_KEY} and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) = 'array'
                then settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}
              else '[]'::jsonb
            end
          ) output
          where jsonb_typeof(output) <> 'object'
             or jsonb_typeof(output->'document') <> 'object'
        )
      )::int as missing_documents,
      count(*) filter (
        where settings ? ${CREDENTIAL_OUTPUTS_SETTINGS_KEY} and case
          when jsonb_typeof(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) = 'array'
            then (
              select count(*)
              from jsonb_array_elements(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) output
            ) <> (
              select count(distinct output->>'id')
              from jsonb_array_elements(settings->${CREDENTIAL_OUTPUTS_SETTINGS_KEY}) output
            )
          else false
        end
      )::int as duplicate_ids
    from tenants`
  if (
    !result ||
    result.tenants === 0 ||
    result.legacy_settings !== 0 ||
    result.invalid_outputs !== 0 ||
    result.missing_documents !== 0 ||
    result.duplicate_ids !== 0
  ) {
    throw new Error(`Credential output cutover assertion failed: ${JSON.stringify(result ?? {})}`)
  }
  const rows = await sql<TenantSettingsRow[]>`
    select id::text, settings from tenants
    where settings ? ${CREDENTIAL_OUTPUTS_SETTINGS_KEY}
    order by id
  `
  for (const row of rows) {
    for (const [index, output] of rawOutputs(row.settings).entries()) {
      if (
        output === null ||
        typeof output !== 'object' ||
        !isDesignDocument((output as Record<string, unknown>).document)
      ) {
        throw new Error(`Tenant ${row.id} credential output ${index} has an invalid document`)
      }
    }
  }
}

async function main(): Promise<void> {
  await assertCutoverDatabaseSession(sql)
  const rows = await sql<TenantSettingsRow[]>`
    select id::text, settings
    from tenants
    where settings ? ${LEGACY_KEY} or settings ? ${CREDENTIAL_OUTPUTS_SETTINGS_KEY}
    order by id
  `
  const materialized = rows.map((row) => {
    const outputs = materializeDocuments(row.settings)
    return {
      ...row,
      outputs,
      changed:
        Object.hasOwn(row.settings, LEGACY_KEY) ||
        canonicalJson(rawOutputs(row.settings)) !== canonicalJson(outputs),
    }
  })
  console.log(
    `[credential-output-cutover] mode=${APPLY ? 'APPLY' : 'AUDIT-ONLY'} tenants=${rows.length} changes=${materialized.filter((row) => row.changed).length} outputs=${materialized.reduce((count, row) => count + row.outputs.length, 0)}`,
  )
  if (!APPLY) {
    console.log('[credential-output-cutover] audit passed; rerun with --apply after migration 0004')
    return
  }

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${LOCK_NAME}, 0))`
    for (const row of materialized) {
      if (!row.changed) continue
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
  console.log(
    `[credential-output-cutover] complete: changed=${materialized.filter((row) => row.changed).length}`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end()
  })
