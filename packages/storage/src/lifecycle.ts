import type { LifecycleRule } from '@aws-sdk/client-s3'

const PENDING_RULE_ID = 'expire-unfinalized-uploads'
const TRANSIENT_RULE_ID = 'expire-transient-artifacts'
const STATE_TAG_KEY = 'beaconhs-state'

export type StorageObjectLifecycle = 'durable' | 'transient'

export function storageObjectTagging(
  lifecycle: StorageObjectLifecycle | undefined,
): string | undefined {
  return lifecycle === 'transient' ? `${STATE_TAG_KEY}=transient` : undefined
}

export function withManagedStorageLifecycleRules(
  existingRules: readonly LifecycleRule[],
): LifecycleRule[] {
  return [
    ...existingRules.filter((rule) => rule.ID !== PENDING_RULE_ID && rule.ID !== TRANSIENT_RULE_ID),
    {
      ID: PENDING_RULE_ID,
      Status: 'Enabled',
      Filter: { Tag: { Key: STATE_TAG_KEY, Value: 'pending' } },
      Expiration: { Days: 1 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
    {
      ID: TRANSIENT_RULE_ID,
      Status: 'Enabled',
      Filter: { Tag: { Key: STATE_TAG_KEY, Value: 'transient' } },
      Expiration: { Days: 1 },
    },
  ]
}
