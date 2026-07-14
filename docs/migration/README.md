# Migration Adapters

BeaconHS supports project-specific migration work, but concrete legacy mappings
are intentionally not part of the public repository. Real migrations often
contain customer names, source table names, row counts, infrastructure details,
and data-shape notes that should stay private to the organization doing the
cutover.

Use this folder for sanitized migration design notes only. Keep live source
extracts, generated inventories, credentials, and tenant-specific loader code in
private workspaces or ignored local folders.

No ETL package is shipped in the public repository. Authorized maintainers keep
the company-specific package in the ignored local `packages/etl` directory. It
is deliberately excluded from the public pnpm workspace and lockfile so a local
migration checkout cannot change public dependency resolution or CI behavior.
Install and validate that package independently:

```bash
pnpm install
pnpm --dir packages/etl install --ignore-workspace --no-lockfile
```

Follow its private runbook for any source or target access.
