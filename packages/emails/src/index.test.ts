import { afterEach, describe, expect, it } from 'vitest'
import { sendEmail } from './index'

const originalResendKey = process.env.RESEND_API_KEY

afterEach(() => {
  if (originalResendKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalResendKey
})

describe('sendEmail provider boundary', () => {
  it('fails explicitly when no provider is configured', async () => {
    delete process.env.RESEND_API_KEY

    await expect(
      sendEmail({
        to: 'worker@example.test',
        subject: 'Test delivery',
        html: '<p>This must not report fake success.</p>',
        text: 'This must not report fake success.',
      }),
    ).rejects.toThrow('Email delivery is not configured')
  })
})
