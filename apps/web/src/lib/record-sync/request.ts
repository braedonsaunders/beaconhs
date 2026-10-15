// Validation of a /api/records/sync body, before any module code runs.

import { z } from 'zod'
import { RECORD_SYNC_MODULES } from '@/lib/offline-drafts/record-sync-modules'
import { SYNC_MAX_PATCHES, type RecordSyncRequest } from '@/lib/offline-drafts/protocol'

const requestSchema = z.object({
  scope: z.string().min(1).max(400),
  module: z.enum(RECORD_SYNC_MODULES),
  recordId: z.string().uuid(),
  patches: z
    .array(
      z.object({
        fieldId: z.string().min(1).max(256),
        // JSON drops `undefined`: a missing value or base means "empty".
        value: z.unknown().optional(),
        // The field's server value when the device started editing it.
        base: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(SYNC_MAX_PATCHES),
})

/** The request, or null when it is malformed (unknown module, bad id, duplicate fields…). */
export function parseRecordSyncRequest(input: unknown): RecordSyncRequest | null {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return null
  const { scope, module, recordId, patches } = parsed.data
  if (new Set(patches.map((patch) => patch.fieldId)).size !== patches.length) return null
  return {
    scope,
    module,
    recordId,
    patches: patches.map((patch) => ({
      fieldId: patch.fieldId,
      value: patch.value ?? null,
      base: patch.base ?? null,
    })),
  }
}
