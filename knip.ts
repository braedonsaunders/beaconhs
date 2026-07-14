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
        'scripts/backfill-credential-outputs.ts',
        'scripts/backfill-private-attachment-urls.ts',
        'scripts/backfill-signatures-to-storage.ts',
        'scripts/backfill-tenant-storage-keys.ts',
        'scripts/generate-brand-icons.mjs',
        'scripts/materialize-compliance.ts',
      ],
    },
    'apps/worker': {
      entry: ['src/health.ts', 'src/storage-init.ts'],
    },
    'packages/db': {
      entry: ['src/scripts/reseed-lift-plan.ts'],
    },
    'packages/sync': {
      ignoreDependencies: ['mssql'],
    },
  },
}

export default config
