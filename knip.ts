import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  $schema: 'https://unpkg.com/knip@5/schema.json',
  workspaces: {
    '.': {
      entry: ['deploy/collabora-branding.js'],
    },
    'apps/web': {
      entry: [
        'public/sw.js',
        'scripts/start-standalone.mjs',
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
        'build.mjs',
        'src/health.ts',
        'src/scheduler.ts',
        'src/scripts/check-email-config.ts',
        'src/storage-init.ts',
      ],
    },
    'packages/db': {
      entry: ['src/migrate.ts', 'src/scripts/reseed-lift-plan.ts', 'src/seed.ts'],
    },
    'packages/sync': {
      ignoreDependencies: ['mssql'],
    },
  },
}

export default config
