import { isDeepStrictEqual } from 'node:util'
import type { ComplianceRecurrence, ComplianceTargetRef } from '@beaconhs/db/schema'

type AudienceTarget = { kind: string; entityKey: string }

export type ObligationSemanticConfig = {
  targetRef: ComplianceTargetRef
  recurrence: ComplianceRecurrence
  audience: readonly AudienceTarget[]
}

function canonicalAudience(audience: readonly AudienceTarget[]): AudienceTarget[] {
  return audience
    .map(({ kind, entityKey }) => ({ kind, entityKey }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.entityKey.localeCompare(right.entityKey)
        : left.kind.localeCompare(right.kind),
    )
}

function asPersistedJson(value: ComplianceTargetRef | ComplianceRecurrence): unknown {
  // JSONB omits object properties whose in-memory value is undefined. Compare
  // the value that will actually persist, otherwise a cosmetic edit can look
  // semantic and unnecessarily reset status/alerts.
  return JSON.parse(JSON.stringify(value)) as unknown
}

/**
 * Alerts are durable snapshots of an obligation's targeting and schedule.
 * Changing any of those semantics invalidates an unpublished snapshot; display
 * fields such as title and notes deliberately do not participate.
 */
export function obligationSemanticConfigChanged(
  previous: ObligationSemanticConfig,
  next: ObligationSemanticConfig,
): boolean {
  return (
    !isDeepStrictEqual(asPersistedJson(previous.targetRef), asPersistedJson(next.targetRef)) ||
    !isDeepStrictEqual(asPersistedJson(previous.recurrence), asPersistedJson(next.recurrence)) ||
    !isDeepStrictEqual(canonicalAudience(previous.audience), canonicalAudience(next.audience))
  )
}
