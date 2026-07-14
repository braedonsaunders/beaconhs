import { describe, expect, it } from 'vitest'
import { assertTenantObjectKey } from './index'

const TENANT_A = '10000000-0000-4000-8000-000000000001'
const TENANT_B = '10000000-0000-4000-8000-000000000002'

describe('tenant object key validation', () => {
  it('accepts canonical tenant keys including nested scopes', () => {
    expect(() =>
      assertTenantObjectKey({
        tenantId: TENANT_A,
        key: `t/${TENANT_A}/document/rendered/10000000-0000-4000-8000-000000000003-file.pdf`,
      }),
    ).not.toThrow()
  })

  it('rejects cross-tenant, traversal, malformed, and oversized keys', () => {
    for (const key of [
      `t/${TENANT_B}/image/file.png`,
      `t/${TENANT_A}/../file.png`,
      `t/${TENANT_A}/image//file.png`,
      `t/${TENANT_A}/image/file name.png`,
      `t\\${TENANT_A}\\image\\file.png`,
      `t/${TENANT_A}/image/${'x'.repeat(1_100)}`,
    ]) {
      expect(() => assertTenantObjectKey({ tenantId: TENANT_A, key }), key).toThrow()
    }
  })
})
