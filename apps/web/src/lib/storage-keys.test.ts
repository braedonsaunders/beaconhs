import { describe, expect, it } from 'vitest'
import { newAttachmentKey, newPendingUploadKey, newTenantObjectKey } from '@beaconhs/storage'

const TENANT_ID = '10000000-0000-4000-8000-000000000001'

describe('tenant storage keys', () => {
  it('keeps final, staging, and transient business objects inside the tenant prefix', () => {
    const attachmentKey = newAttachmentKey({
      tenantId: TENANT_ID,
      kind: 'image',
      filename: '../../photo.png',
    })
    expect(attachmentKey).toMatch(new RegExp(`^t/${TENANT_ID}/image/[0-9a-f-]+-`))
    expect(attachmentKey).not.toContain('/../')
    expect(newPendingUploadKey({ tenantId: TENANT_ID, uploadId: TENANT_ID })).toMatch(
      new RegExp(`^t/${TENANT_ID}/_pending/`),
    )
    expect(
      newTenantObjectKey({
        tenantId: TENANT_ID,
        scope: '_transient/pdfs/report',
        filename: 'report.pdf',
      }),
    ).toMatch(new RegExp(`^t/${TENANT_ID}/_transient/pdfs/report/`))
  })

  it('rejects tenant and scope traversal', () => {
    expect(() =>
      newTenantObjectKey({ tenantId: '../tenant', scope: 'document', filename: 'x' }),
    ).toThrow(/Tenant id/)
    expect(() =>
      newTenantObjectKey({ tenantId: TENANT_ID, scope: 'document/../other', filename: 'x' }),
    ).toThrow(/scope/)
  })
})
