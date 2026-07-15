import type { KnipConfig } from 'knip'

// Knip 5.88 resolves package-script entrypoints on Linux, but not on macOS.
// Keep the same strict dead-code result on both developer machines and CI
// without making Linux report the inferred entries as redundant hints.
const needsExplicitPackageScriptEntries = process.platform === 'darwin'

const config: KnipConfig = {
  $schema: 'https://unpkg.com/knip@5/schema.json',
  workspaces: {
    '.': {
      entry: ['deploy/collabora-branding.js'],
    },
    'apps/web': {
      entry: [
        'public/sw.js',
        ...(needsExplicitPackageScriptEntries ? ['scripts/start-standalone.mjs'] : []),
        'scripts/backfill-credential-outputs.ts',
        'scripts/backfill-private-attachment-urls.ts',
        'scripts/backfill-signatures-to-storage.ts',
        'scripts/backfill-tenant-storage-keys.ts',
        'scripts/generate-brand-icons.mjs',
        'scripts/materialize-compliance.ts',
      ],
    },
    'apps/worker': {
      entry: [
        ...(needsExplicitPackageScriptEntries
          ? ['build.mjs', 'src/scheduler.ts', 'src/scripts/check-email-config.ts']
          : []),
        'src/health.ts',
        'src/storage-init.ts',
      ],
    },
    'packages/db': {
      entry: [
        ...(needsExplicitPackageScriptEntries ? ['src/migrate.ts', 'src/seed.ts'] : []),
        'src/scripts/reseed-lift-plan.ts',
      ],
    },
    'packages/sync': {
      ignoreDependencies: ['mssql'],
    },
  },
}

export default config
