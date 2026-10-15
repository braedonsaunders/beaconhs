// Every module whose record pages queue field edits through the local-first
// layer. Each name has exactly one server-side saver in
// apps/web/src/lib/record-sync/registry.ts (the registry is typed against this
// list, so a module cannot be wired on the client without a saver).

export const RECORD_SYNC_MODULES = [
  'apps',
  'incidents',
  'corrective-actions',
  'hazard-assessments',
  'inspections',
  'equipment-inspections',
  'journals',
  'training-records',
  'training-assessments',
  'training-skills',
  'training-skill-types',
  'training-classes',
  'training-authorities',
  'people',
  'locations',
  'equipment',
  'ppe-items',
  'documents',
] as const

export type RecordSyncModule = (typeof RECORD_SYNC_MODULES)[number]
