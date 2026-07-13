import { describe, expect, it } from 'vitest'
import {
  inspectPersistedValue,
  rewritePersistedValue,
  type AttachmentReference,
} from './private-attachment-url-cutover'

const TENANT = '10000000-0000-4000-8000-000000000001'
const OTHER_TENANT = '20000000-0000-4000-8000-000000000002'
const ATTACHMENT = '30000000-0000-4000-8000-000000000003'
const CAP = 'A'.repeat(43)

function canonical(reference: AttachmentReference): string {
  const id = reference.kind === 'route' ? reference.attachmentId : ATTACHMENT
  return `/api/attachments/${id}?cap=${'Z'.repeat(43)}`
}

describe('private attachment URL cutover inspection', () => {
  it('finds bare, stale, and absolute attachment routes at every JSON depth', () => {
    const value = {
      nested: [
        `/api/attachments/${ATTACHMENT}`,
        { html: `<img src="/api/attachments/${ATTACHMENT}?cap=${CAP}">` },
        `https://beacon.example/api/attachments/${ATTACHMENT}?cap=${CAP}`,
      ],
    }
    const result = inspectPersistedValue(value, TENANT)
    expect(result.invalid).toEqual([])
    expect(result.references).toHaveLength(3)
    expect(result.references.every((reference) => reference.kind === 'route')).toBe(true)

    const rewritten = rewritePersistedValue(value, TENANT, canonical)
    expect(rewritten).toEqual({
      nested: [
        canonical(result.references[0]!),
        { html: `<img src="${canonical(result.references[1]!)}">` },
        canonical(result.references[2]!),
      ],
    })
  })

  it('extracts an exact tenant object key and rewrites the whole public URL', () => {
    const publicUrl = `https://objects.example/bucket/t/${TENANT}/image/file%20name.png`
    const result = inspectPersistedValue({ value: publicUrl }, TENANT)
    expect(result.invalid).toEqual([])
    expect(result.references).toEqual([
      {
        kind: 'public-object',
        raw: publicUrl,
        tenantId: TENANT,
        key: `t/${TENANT}/image/file name.png`,
        path: '$.value',
      },
    ])
    expect(rewritePersistedValue(publicUrl, TENANT, canonical)).toBe(
      `/api/attachments/${ATTACHMENT}?cap=${'Z'.repeat(43)}`,
    )
  })

  it.each([
    `/api/attachments/not-a-uuid`,
    `/api/attachments/30000000-0000-0000-0000-000000000003`,
    `/api/attachments/${ATTACHMENT}?cap=short`,
    `/api/attachments/${ATTACHMENT}?cap=${CAP}&cap=${CAP}`,
    `/api/attachments/${ATTACHMENT}?cap=${CAP}?cap=${CAP}`,
    `/api/attachments/${ATTACHMENT}?cap=${CAP}&download=1`,
  ])('rejects malformed or doubled attachment route %s', (value) => {
    const result = inspectPersistedValue(value, TENANT)
    expect(result.references).toEqual([])
    expect(result.invalid).toHaveLength(1)
  })

  it('rejects an absolute attachment route mounted below an unexpected base path', () => {
    const result = inspectPersistedValue(
      `https://beacon.example/base/api/attachments/${ATTACHMENT}?cap=${CAP}`,
      TENANT,
    )
    expect(result.references).toEqual([])
    expect(result.invalid).toHaveLength(1)
  })

  it('rejects a relative attachment route mounted below an unexpected base path', () => {
    const value = `/base/api/attachments/${ATTACHMENT}?cap=${CAP}`
    const result = inspectPersistedValue(value, TENANT)
    expect(result.references).toEqual([])
    expect(result.invalid).toHaveLength(1)
  })

  it('rejects public URLs scoped to another tenant', () => {
    const value = `https://objects.example/t/${OTHER_TENANT}/image/file.png`
    const result = inspectPersistedValue(value, TENANT)
    expect(result.references).toEqual([])
    expect(result.invalid[0]?.reason).toMatch(/row tenant/)
  })

  it.each([
    `https://objects.example/t/${TENANT}/image/file.png?download=1`,
    `https://objects.example/t/${TENANT}/image/file.png#fragment`,
    `https://user:password@objects.example/t/${TENANT}/image/file.png`,
    `https://objects.example/t/${TENANT}/../file.png`,
    `https://objects.example/t/${TENANT}/image//file.png`,
    `https://objects.example/t/10000000-0000-4000-8000-00000000001/image/file.png`,
    `https://objects.example/t/${TENANT}/image/file%ZZ.png`,
  ])('rejects unsafe public object URL %s', (value) => {
    const result = inspectPersistedValue(value, TENANT)
    expect(result.references).toEqual([])
    expect(result.invalid).toHaveLength(1)
  })

  it('ignores unrelated URLs and preserves primitive JSON values', () => {
    const value = {
      external: 'https://example.com/training/topic',
      values: [null, true, 42],
    }
    expect(inspectPersistedValue(value, TENANT)).toEqual({ references: [], invalid: [] })
    expect(rewritePersistedValue(value, TENANT, canonical)).toEqual(value)
  })
})
