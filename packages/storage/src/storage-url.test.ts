import { describe, expect, it } from 'vitest'
import { assertTenantLogoObjectKey, objectKeyFromStorageUrl } from './index'

const endpoint = 'https://s3.example.test/minio'
const tenantId = '10000000-0000-4000-8000-000000000001'

describe('objectKeyFromStorageUrl', () => {
  it('extracts an encoded object key from the configured path-style bucket', () => {
    expect(
      objectKeyFromStorageUrl({
        url: `${endpoint}/beaconhs/tenants/tenant-id/branding/company%20logo.png`,
        endpoint,
        bucket: 'beaconhs',
      }),
    ).toBe('tenants/tenant-id/branding/company logo.png')
  })

  it('recognizes an existing presigned URL without retaining its query', () => {
    expect(
      objectKeyFromStorageUrl({
        url: `${endpoint}/beaconhs/t/tenant-id/branding/logo.png?X-Amz-Signature=old`,
        endpoint,
        bucket: 'beaconhs',
      }),
    ).toBe('t/tenant-id/branding/logo.png')
  })

  it('rejects other origins, buckets, endpoint paths, credentials, and encoded separators', () => {
    for (const url of [
      'https://public.example.test/logo.png',
      'https://s3.example.test/minio/other/logo.png',
      'https://s3.example.test/other/beaconhs/logo.png',
      'https://user:password@s3.example.test/minio/beaconhs/logo.png',
      'https://s3.example.test/minio/beaconhs/branding%2Flogo.png',
    ]) {
      expect(objectKeyFromStorageUrl({ url, endpoint, bucket: 'beaconhs' }), url).toBeNull()
    }
  })
})

describe('assertTenantLogoObjectKey', () => {
  it('accepts only branding keys owned by the active tenant', () => {
    expect(() =>
      assertTenantLogoObjectKey({
        tenantId,
        key: `tenants/${tenantId}/branding/company-logo.png`,
      }),
    ).not.toThrow()
    expect(() =>
      assertTenantLogoObjectKey({ tenantId, key: `t/${tenantId}/branding/company-logo.png` }),
    ).not.toThrow()
  })

  it('rejects cross-tenant, non-branding, malformed, and traversal keys', () => {
    for (const key of [
      'tenants/10000000-0000-4000-8000-000000000002/branding/logo.png',
      `tenants/${tenantId}/documents/logo.png`,
      `tenants/${tenantId}/branding/../secret.png`,
      `tenants/${tenantId}/branding/company logo.png`,
      `tenants\\${tenantId}\\branding\\logo.png`,
    ]) {
      expect(() => assertTenantLogoObjectKey({ tenantId, key }), key).toThrow()
    }
  })
})
