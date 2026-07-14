import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/deploy-dev.yml', import.meta.url)),
  'utf8',
)
const directDatabaseUrlScript = fileURLToPath(
  new URL('../../../scripts/cluster/direct-maintenance-database-url.mjs', import.meta.url),
)

function requiredPosition(haystack: string, needle: string): number {
  const position = haystack.indexOf(needle)
  if (position < 0) throw new Error(`Deployment workflow is missing ${needle}`)
  return position
}

describe('dev deployment cutover order', () => {
  const drainStepStart = requiredPosition(
    workflow,
    '- name: Drain writers, run storage prerequisites, and migrate',
  )
  const postSchemaStepStart = requiredPosition(
    workflow,
    '- name: Run audited one-time dev data cutover',
  )
  const updateComposeStepStart = requiredPosition(
    workflow,
    '- name: Update compose environment on Dokploy',
  )
  const drainStep = workflow.slice(drainStepStart, postSchemaStepStart)
  const postSchemaStep = workflow.slice(postSchemaStepStart, updateComposeStepStart)

  it('installs Node 24 before pnpm on the self-hosted deploy runner', () => {
    expect(requiredPosition(workflow, 'uses: actions/setup-node@')).toBeLessThan(
      requiredPosition(workflow, 'uses: pnpm/action-setup@'),
    )
  })

  it('uses retry flags supported by the self-hosted runner curl', () => {
    expect(workflow).not.toContain('--retry-all-errors')
  })

  it('normalizes the registry field removed by newer Dokploy releases', () => {
    expect(workflow).toContain('existing_registry_id_json="$(jq -c \'')
    expect(workflow).not.toContain('existing_registry_id_json="$(jq -ce \'')
    expect(workflow).toContain('if (has("registryId") | not) or .registryId == null then null')
    expect(workflow).not.toContain('then error("missing registryId")')
  })

  it('converges external-storage prerequisites before schema migration', () => {
    const signatures = requiredPosition(
      drainStep,
      'run_pre_schema_cutover "Stored signatures" scripts/backfill-signatures-to-storage.ts',
    )
    const tenantKeys = requiredPosition(
      drainStep,
      'run_pre_schema_cutover "Tenant storage keys" scripts/backfill-tenant-storage-keys.ts',
    )
    const migration = requiredPosition(
      drainStep,
      'pnpm --filter @beaconhs/db exec tsx src/migrate.ts',
    )

    expect(signatures).toBeLessThan(tenantKeys)
    expect(tenantKeys).toBeLessThan(migration)
    expect(requiredPosition(drainStep, 'BEACONHS_PRE_SCHEMA_CUTOVER_COMMITTED=true')).toBeLessThan(
      migration,
    )
    expect(requiredPosition(drainStep, 'BEACONHS_SCHEMA_CUTOVER_STARTED=true')).toBeGreaterThan(
      tenantKeys,
    )
  })

  it('keeps prerequisites behind both writer fences and a direct maintenance credential', () => {
    const swarmFence = requiredPosition(
      drainStep,
      'scripts/cluster/acquire-swarm-scheduling-fence.sh',
    )
    const drained = requiredPosition(drainStep, 'export BEACONHS_CUTOVER_WRITERS_DRAINED=true')
    const directCredential = requiredPosition(
      drainStep,
      'node scripts/cluster/direct-maintenance-database-url.mjs',
    )
    const signatures = requiredPosition(
      drainStep,
      'run_pre_schema_cutover "Stored signatures" scripts/backfill-signatures-to-storage.ts',
    )

    expect(swarmFence).toBeLessThan(drained)
    expect(drained).toBeLessThan(directCredential)
    expect(directCredential).toBeLessThan(signatures)
    expect(drainStep).toContain('assert_pre_schema_cutover_fence')
    expect(drainStep).toContain('scripts/cluster/assert-cutover-isolation.sh')
  })

  it('derives the unpooled maintenance URL without changing its database identity', () => {
    const result = spawnSync(process.execPath, [directDatabaseUrlScript], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        DEV_SUPERADMIN_DATABASE_URL:
          'postgresql://beaconhs_super:secret@db.internal:6432/beaconhs?sslmode=require',
      },
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      'postgresql://beaconhs_super:secret@db.internal:5432/beaconhs?sslmode=require',
    )

    const invalid = spawnSync(process.execPath, [directDatabaseUrlScript], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        DEV_SUPERADMIN_DATABASE_URL: 'redis://db.internal:6432/beaconhs',
      },
    })
    expect(invalid.status).not.toBe(0)
    expect(invalid.stderr).toContain('must be a PostgreSQL URL')
    expect(invalid.stdout).toBe('')
  })

  it('runs canonical-content URL rewrites only after migration', () => {
    expect(postSchemaStep).not.toContain('backfill-signatures-to-storage.ts')
    expect(postSchemaStep).not.toContain('backfill-tenant-storage-keys.ts')
    expect(postSchemaStep).toContain(
      'run_cutover "Credential outputs" scripts/backfill-credential-outputs.ts',
    )
    expect(postSchemaStep).toContain(
      'run_cutover "Private attachment URLs" scripts/backfill-private-attachment-urls.ts',
    )
    expect(postSchemaStep).toContain('BEACONHS_SCHEMA_CUTOVER_COMMITTED')
  })
})
