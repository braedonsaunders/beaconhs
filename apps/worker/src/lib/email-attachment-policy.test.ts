import { describe, expect, it } from 'vitest'
import { EMAIL_DELIVERY_LIMITS } from '@beaconhs/email-render/delivery-input'
import { assertEmailAttachmentSize } from './email-attachment-policy'

describe('email attachment policy', () => {
  it('accepts the exact delivery boundary', () => {
    expect(() => assertEmailAttachmentSize(EMAIL_DELIVERY_LIMITS.attachmentBytes)).not.toThrow()
  })

  it.each([-1, Number.NaN, 1.5])('rejects invalid size %s', (size) => {
    expect(() => assertEmailAttachmentSize(size)).toThrow('invalid size')
  })

  it('rejects a rendered PDF above the provider-safe boundary', () => {
    expect(() => assertEmailAttachmentSize(EMAIL_DELIVERY_LIMITS.attachmentBytes + 1)).toThrow(
      'email attachment limit',
    )
  })
})
