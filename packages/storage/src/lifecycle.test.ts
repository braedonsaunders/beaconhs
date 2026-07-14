import { describe, expect, it } from 'vitest'
import type { LifecycleRule } from '@aws-sdk/client-s3'
import { storageObjectTagging, withManagedStorageLifecycleRules } from './lifecycle'

describe('storage lifecycle policy', () => {
  it('preserves operator rules and idempotently replaces BeaconHS-managed rules', () => {
    const existing: LifecycleRule[] = [
      { ID: 'operator-archive', Status: 'Enabled', Expiration: { Days: 365 } },
      { ID: 'expire-unfinalized-uploads', Status: 'Disabled', Expiration: { Days: 7 } },
      { ID: 'expire-transient-artifacts', Status: 'Disabled', Expiration: { Days: 7 } },
    ]

    const rules = withManagedStorageLifecycleRules(existing)
    expect(rules.map((rule) => rule.ID)).toEqual([
      'operator-archive',
      'expire-unfinalized-uploads',
      'expire-transient-artifacts',
    ])
    expect(rules[1]).toMatchObject({
      Status: 'Enabled',
      Filter: { Tag: { Key: 'beaconhs-state', Value: 'pending' } },
      Expiration: { Days: 1 },
    })
    expect(rules[2]).toMatchObject({
      Status: 'Enabled',
      Filter: { Tag: { Key: 'beaconhs-state', Value: 'transient' } },
      Expiration: { Days: 1 },
    })
  })

  it('tags only explicitly transient objects and leaves durable objects untagged', () => {
    expect(storageObjectTagging('transient')).toBe('beaconhs-state=transient')
    expect(storageObjectTagging('durable')).toBeUndefined()
    expect(storageObjectTagging(undefined)).toBeUndefined()
  })
})
