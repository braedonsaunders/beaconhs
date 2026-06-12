import type { Loader } from './orchestrator'

/**
 * Public ETL loader registry.
 *
 * BeaconHS keeps the orchestration/crosswalk utilities public, but concrete
 * source-system mappings are deployment-specific and often contain private
 * tenant names, source table names, row counts, and data-shape notes. Add
 * loaders in a private package or branch and pass them to `runImport`.
 */
export const ALL_LOADERS: Loader[] = []
