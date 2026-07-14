import { createECDH, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import webpush from 'web-push'

const mocks = vi.hoisted(() => ({
  resolvePublicHost: vi.fn(async (hostname: string) => ({
    hostname,
    address: '203.0.113.10',
    family: 4 as const,
    ipLiteral: false,
  })),
  secureFetch: vi.fn(async (..._args: unknown[]) => new Response(null, { status: 201 })),
}))

vi.mock('@beaconhs/sync/egress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@beaconhs/sync/egress')>()),
  resolvePublicHost: mocks.resolvePublicHost,
  secureFetch: mocks.secureFetch,
}))

import {
  buildWebPushPayload,
  sendWebPushNotification,
  validateWebPushSubscription,
  validateWebPushSubscriptionForPersistence,
} from './web-push'

function subscription() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    endpoint: 'https://push.example.com/subscriptions/private-token',
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.secureFetch.mockResolvedValue(new Response(null, { status: 201 }))
})

describe('Web Push delivery policy', () => {
  it('rejects unsafe endpoints and malformed browser keys before delivery', () => {
    const valid = subscription()
    expect(() =>
      validateWebPushSubscription({ ...valid, endpoint: 'http://push.example.com/token' }),
    ).toThrow(/HTTPS/)
    expect(() =>
      validateWebPushSubscription({ ...valid, keys: { ...valid.keys, auth: 'not valid' } }),
    ).toThrow(/base64url/)
  })

  it('checks public DNS before persistence', async () => {
    const valid = subscription()
    await expect(validateWebPushSubscriptionForPersistence(valid)).resolves.toEqual(valid)
    expect(mocks.resolvePublicHost).toHaveBeenCalledWith('push.example.com', { timeoutMs: 5_000 })
  })

  it('keeps the encrypted request and provider response bounded', async () => {
    const vapid = webpush.generateVAPIDKeys()
    await sendWebPushNotification({
      subscription: subscription(),
      payload: { title: 'Alert', body: 'x'.repeat(20_000), linkPath: '/notifications' },
      vapid: { subject: 'mailto:ops@example.com', ...vapid },
    })

    expect(mocks.secureFetch).toHaveBeenCalledTimes(1)
    const [endpoint, options] = mocks.secureFetch.mock.calls[0]! as [
      string,
      Record<string, unknown>,
    ]
    expect(endpoint).toBe('https://push.example.com/subscriptions/private-token')
    expect(options).toMatchObject({
      method: 'POST',
      maxRequestBytes: 16 * 1_024,
      maxResponseBytes: 16 * 1_024,
      maxRedirects: 0,
      timeoutMs: 15_000,
    })
    expect(Object.keys(options.headers as Record<string, string>)).not.toContain('Content-Length')
    expect(
      Buffer.byteLength(buildWebPushPayload({ title: 'Alert', body: 'x'.repeat(20_000) })),
    ).toBeLessThanOrEqual(3_072)
  })

  it('preserves terminal provider status for dead-subscription cleanup', async () => {
    mocks.secureFetch.mockResolvedValueOnce(new Response('gone', { status: 410 }))
    const vapid = webpush.generateVAPIDKeys()
    await expect(
      sendWebPushNotification({
        subscription: subscription(),
        payload: { title: 'Alert' },
        vapid: { subject: 'mailto:ops@example.com', ...vapid },
      }),
    ).rejects.toMatchObject({ statusCode: 410 })
  })
})
