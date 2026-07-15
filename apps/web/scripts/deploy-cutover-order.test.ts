import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/deploy-dev.yml', import.meta.url)),
  'utf8',
)
const localCompose = readFileSync(
  fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)),
  'utf8',
)
const devCompose = readFileSync(
  fileURLToPath(new URL('../../../deploy/dokploy-dev.compose.yaml', import.meta.url)),
  'utf8',
)
const directDatabaseUrlScript = fileURLToPath(
  new URL('../../../scripts/cluster/direct-maintenance-database-url.mjs', import.meta.url),
)
const restoreVerifyScript = readFileSync(
  fileURLToPath(new URL('../../../scripts/cluster/restore-verify.sh', import.meta.url)),
  'utf8',
)
const webPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const databasePackage = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../packages/db/package.json', import.meta.url)),
    'utf8',
  ),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

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

  it('installs the TypeScript cutover runtime in production mode', () => {
    expect(webPackage.scripts?.['cutover:run']).toBe('tsx')
    expect(webPackage.dependencies?.tsx).toBe('^4.23.1')
    expect(databasePackage.dependencies?.tsx).toBe('^4.23.1')
    expect(webPackage.devDependencies?.tsx).toBeUndefined()
    expect(databasePackage.devDependencies?.tsx).toBeUndefined()
    expect(workflow).toContain('pnpm --filter @beaconhs/web run cutover:run "$script"')
    expect(workflow).not.toContain('pnpm --filter @beaconhs/web exec tsx')
  })

  it('uses retry flags supported by the self-hosted runner curl', () => {
    expect(workflow).not.toContain('--retry-all-errors')
  })

  it('pins Collabora WOPI loads to the exact 1 GiB PowerPoint ceiling', () => {
    const override = '--o:storage.wopi.max_file_size=1073741824'

    expect(localCompose).toContain(override)
    expect(devCompose).toContain(override)
    expect(workflow).toContain(override)
    expect(localCompose).not.toContain('--o:storage.wopi.max_file_size=0')
    expect(devCompose).not.toContain('--o:storage.wopi.max_file_size=0')
    expect(workflow).not.toContain('--o:storage.wopi.max_file_size=0')
  })

  it('recreates an archive-owned public schema during a disposable restore', () => {
    const archiveValidationAt = requiredPosition(
      restoreVerifyScript,
      'pg_restore --list "$archive" >/dev/null',
    )
    const archiveSchemaCheckAt = requiredPosition(
      restoreVerifyScript,
      '$4 == "SCHEMA" && $5 == "-" && $6 == "public"',
    )
    const databaseCreateAt = requiredPosition(
      restoreVerifyScript,
      'createdb --maintenance-db="$admin_database" --template=template0',
    )
    const conditionalDropAt = requiredPosition(
      restoreVerifyScript,
      'if [ "$archive_creates_public_schema" = \'true\' ]; then',
    )
    const publicDropAt = requiredPosition(restoreVerifyScript, 'DROP SCHEMA public;')
    const restoreAt = requiredPosition(restoreVerifyScript, 'PGDATABASE="$database" pg_restore')
    const orderedPositions = [
      archiveValidationAt,
      archiveSchemaCheckAt,
      databaseCreateAt,
      conditionalDropAt,
      publicDropAt,
      restoreAt,
    ]

    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
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
    expect(drainStep).toContain('BEACONHS_SWARM_FENCE_NODE_SET_SHA256')
    expect(workflow).not.toContain('BEACONHS_SWARM_FENCE_NODE_ID')
  })

  it('uses a portable task-state drain counter on the deployment runner', () => {
    const match = drainStep.match(
      /nonterminal="\$\(printf '%s\\n' "\$task_states" \| awk '\n([\s\S]*?)'\)"/u,
    )
    const program = match?.[1]
    if (!program) throw new Error('Deployment workflow is missing its task-state awk program')

    const result = spawnSync('awk', [program], {
      encoding: 'utf8',
      input: [
        'Complete 1 second ago',
        'Shutdown 1 second ago',
        'Failed 1 second ago',
        'Rejected 1 second ago',
        'Remove 1 second ago',
        'Orphaned 1 second ago',
        'Running 1 second ago',
      ].join('\n'),
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('1\n')
  })

  it('releases the complete workflow-owned Swarm node set only after final proofs', () => {
    const releaseStepStart = requiredPosition(
      workflow,
      '- name: Verify exact deployment specs and resume Swarm scheduling',
    )
    const convergenceStepStart = requiredPosition(
      workflow,
      '- name: Wait for Swarm convergence and external readiness',
    )
    const releaseStep = workflow.slice(releaseStepStart, convergenceStepStart)
    const finalIsolation = releaseStep.lastIndexOf('scripts/cluster/assert-cutover-isolation.sh')
    const finalStackProof = releaseStep.lastIndexOf('assert_exact_stack')
    const release = requiredPosition(
      releaseStep,
      'scripts/cluster/release-swarm-scheduling-fence.sh',
    )

    expect(finalIsolation).toBeGreaterThanOrEqual(0)
    expect(finalStackProof).toBeGreaterThanOrEqual(0)
    expect(finalIsolation).toBeLessThan(release)
    expect(finalStackProof).toBeLessThan(release)
    expect(releaseStep).not.toContain('docker node update --availability active')
  })

  it('allows only explicitly materialized, scheduler-fenced Pending writers before release', () => {
    const deployStepStart = requiredPosition(
      workflow,
      '- name: Redeploy reconciled compose on Dokploy',
    )
    const releaseStepStart = requiredPosition(
      workflow,
      '- name: Verify exact deployment specs and resume Swarm scheduling',
    )
    const convergenceStepStart = requiredPosition(
      workflow,
      '- name: Wait for Swarm convergence and external readiness',
    )
    const deployStep = workflow.slice(deployStepStart, releaseStepStart)
    const releaseStep = workflow.slice(releaseStepStart, convergenceStepStart)
    const pendingProof = requiredPosition(
      releaseStep,
      'BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS=true',
    )
    const exactPendingWait = requiredPosition(releaseStep, "grep -Eq '^Pending '")
    const release = requiredPosition(
      releaseStep,
      'scripts/cluster/release-swarm-scheduling-fence.sh',
    )

    expect(deployStep).not.toContain('BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS')
    expect(deployStep.trimEnd()).toMatch(
      /assert_final_compose_state\n\s+scripts\/cluster\/assert-swarm-scheduling-paused\.sh\n\s+echo/u,
    )
    expect(exactPendingWait).toBeLessThan(pendingProof)
    expect(pendingProof).toBeLessThan(release)
    expect(releaseStep.match(/BEACONHS_CUTOVER_MATERIALIZED_PENDING_WRITERS=true/gu)).toHaveLength(
      1,
    )
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
