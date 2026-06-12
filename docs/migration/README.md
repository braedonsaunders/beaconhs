# Migration Adapters

BeaconHS supports project-specific migration work, but concrete legacy mappings
are intentionally not part of the public repository. Real migrations often
contain customer names, source table names, row counts, infrastructure details,
and data-shape notes that should stay private to the organization doing the
cutover.

Use this folder for sanitized migration design notes only. Keep live source
extracts, generated inventories, credentials, and tenant-specific loader code in
private workspaces or ignored local folders.

The public ETL package is a scaffold for custom adapters:

- connection helpers live in `packages/etl/src/source`
- id crosswalk helpers live in `packages/etl/src/crosswalk.ts`
- loader orchestration lives in `packages/etl/src/orchestrator.ts`

To build a private migration, add loaders in a private branch or package and
wire them into the ETL runner through environment-controlled configuration.
