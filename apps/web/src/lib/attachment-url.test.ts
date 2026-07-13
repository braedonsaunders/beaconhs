import { describe, expect, it } from 'vitest'
import { attachmentUrl, validateAttachmentCapability } from './attachment-url'

describe('attachmentUrl', () => {
  it('returns the stable authenticated attachment route', () => {
    const id = '10000000-0000-4000-8000-000000000001'
    const url = attachmentUrl(id)
    expect(url).toMatch(
      /^\/api\/attachments\/10000000-0000-4000-8000-000000000001\?cap=[A-Za-z0-9_-]{43}$/,
    )
    expect(
      validateAttachmentCapability(id, new URL(url, 'http://localhost').searchParams.get('cap')!),
    ).toBe(true)
    expect(validateAttachmentCapability(id, '')).toBe(false)
    expect(validateAttachmentCapability(id, 'A'.repeat(43))).toBe(false)
    expect(
      validateAttachmentCapability(
        '20000000-0000-4000-8000-000000000002',
        new URL(url, 'http://localhost').searchParams.get('cap')!,
      ),
    ).toBe(false)
  })
})
