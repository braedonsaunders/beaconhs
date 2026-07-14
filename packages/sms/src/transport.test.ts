import { afterEach, describe, expect, it, vi } from 'vitest'

const secureFetchMock = vi.hoisted(() =>
  vi.fn(
    async (
      url: string,
      options: {
        method?: string
        headers?: Record<string, string>
        body?: string | URLSearchParams | ArrayBuffer | Uint8Array | null
      },
    ) =>
      globalThis.fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
      }),
  ),
)

vi.mock('@beaconhs/sync/egress', () => ({ secureFetch: secureFetchMock }))

import { sealSecret } from '@beaconhs/crypto'
import { isSmsProvider } from './providers'
import {
  buildSmsTransport,
  resolveEffectiveSmsTransport,
  resolveSmsTransport,
  sendSmsVia,
  validateStoredSmsConfig,
  type PlatformSmsConfig,
  type RawSmsConfig,
  type SendSmsInput,
  type SmsTransport,
} from './transport'

const INPUT: SendSmsInput = { to: '+15551234567', body: 'Hello' }

function sealed(secret: string) {
  const s = sealSecret(secret)
  return { keyCiphertext: s.ciphertext, keyNonce: s.nonce }
}

afterEach(() => {
  vi.restoreAllMocks()
  secureFetchMock.mockClear()
})

describe('isSmsProvider', () => {
  it('accepts catalogue entries without accepting object prototype properties', () => {
    expect(isSmsProvider('twilio')).toBe(true)
    expect(isSmsProvider('toString')).toBe(false)
    expect(isSmsProvider('__proto__')).toBe(false)
  })
})

describe('buildSmsTransport', () => {
  it('carries the sender + secret + identifiers per provider', () => {
    expect(
      buildSmsTransport({
        provider: 'twilio',
        fromNumber: '+1999',
        twilioAccountSid: 'AC1',
        secret: 'tok',
      }),
    ).toEqual({ provider: 'twilio', accountSid: 'AC1', authToken: 'tok', from: '+1999' })

    expect(
      buildSmsTransport({
        provider: 'telnyx',
        fromNumber: '+1999',
        secret: 'KEY1',
        telnyxMessagingProfileId: 'mp1',
      }),
    ).toMatchObject({ provider: 'telnyx', apiKey: 'KEY1', messagingProfileId: 'mp1' })
  })

  it('returns null when required pieces are missing', () => {
    expect(buildSmsTransport({ provider: 'twilio', fromNumber: '+1', secret: 'x' })).toBeNull() // no sid
    expect(
      buildSmsTransport({ provider: 'twilio', twilioAccountSid: 'AC', secret: 'x' }),
    ).toBeNull() // no from
    expect(buildSmsTransport({ provider: 'messagebird', fromNumber: '+1' })).toBeNull() // no secret
    expect(buildSmsTransport({ provider: 'vonage', fromNumber: '+1', secret: 'x' })).toBeNull() // no api key
  })
})

describe('resolveSmsTransport (unseal)', () => {
  it('unseals the stored secret and builds the transport', () => {
    const raw: RawSmsConfig = {
      enabled: true,
      provider: 'messagebird',
      fromNumber: 'BeaconHS',
      ...sealed('live_key'),
    }
    expect(resolveSmsTransport(raw)).toMatchObject({
      provider: 'messagebird',
      accessKey: 'live_key',
      from: 'BeaconHS',
    })
  })

  it('returns null when disabled or unconfigured', () => {
    expect(resolveSmsTransport(null)).toBeNull()
    expect(
      resolveSmsTransport({
        provider: 'messagebird',
        enabled: false,
        fromNumber: 'X',
        ...sealed('x'),
      }),
    ).toBeNull()
    expect(resolveSmsTransport({ fromNumber: 'X' })).toBeNull()
    expect(
      resolveSmsTransport({ provider: 'messagebird', fromNumber: 'X', ...sealed('x') }),
    ).toBeNull()
  })
})

describe('validateStoredSmsConfig', () => {
  it('requires complete provider fields and a paired sealed credential when live', () => {
    expect(() =>
      validateStoredSmsConfig({
        enabled: true,
        provider: 'twilio',
        fromNumber: '+15551234567',
        ...sealed('token'),
      }),
    ).toThrow('Twilio account SID')

    expect(() =>
      validateStoredSmsConfig({
        enabled: true,
        provider: 'messagebird',
        fromNumber: 'BeaconHS',
        keyCiphertext: 'ciphertext',
      }),
    ).toThrow('credential is incomplete')
  })

  it('validates fields in disabled drafts and rejects unknown platform policies', () => {
    expect(() =>
      validateStoredSmsConfig({ enabled: false, provider: 'messagebird', fromNumber: 'bad\nfrom' }),
    ).toThrow('SMS sender')
    expect(() =>
      validateStoredSmsConfig({ mode: 'unknown' } as unknown as PlatformSmsConfig),
    ).toThrow('platform SMS policy')
  })
})

describe('resolveEffectiveSmsTransport (platform → tenant precedence)', () => {
  const platform: PlatformSmsConfig = {
    enabled: true,
    provider: 'twilio',
    fromNumber: '+1platform',
    twilioAccountSid: 'ACplatform',
    ...sealed('pm-token'),
  }
  const tenant: RawSmsConfig = {
    enabled: true,
    provider: 'messagebird',
    fromNumber: 'Tenant',
    ...sealed('tenant-key'),
  }

  it('disabled → suppressed (kill switch)', () => {
    expect(
      resolveEffectiveSmsTransport({ ...platform, mode: 'disabled' }, tenant, {
        tenantScoped: true,
      }),
    ).toEqual({ kind: 'suppressed' })
  })

  it('global_only → platform provider, ignoring the tenant', () => {
    const r = resolveEffectiveSmsTransport({ ...platform, mode: 'global_only' }, tenant, {
      tenantScoped: true,
    })
    expect(r).toMatchObject({ kind: 'transport', source: 'platform' })
    expect((r as { transport: SmsTransport }).transport.provider).toBe('twilio')
  })

  it('tenant_optional → tenant provider when the tenant has one', () => {
    const r = resolveEffectiveSmsTransport({ ...platform, mode: 'tenant_optional' }, tenant, {
      tenantScoped: true,
    })
    expect(r).toMatchObject({ kind: 'transport', source: 'tenant' })
    expect((r as { transport: SmsTransport }).transport.provider).toBe('messagebird')
  })

  it('tenant_optional → platform when the tenant has none', () => {
    expect(
      resolveEffectiveSmsTransport({ ...platform, mode: 'tenant_optional' }, null, {
        tenantScoped: true,
      }),
    ).toMatchObject({ kind: 'transport', source: 'platform' })
  })

  it('reports missing configuration instead of pretending to send', () => {
    expect(resolveEffectiveSmsTransport(null, null, { tenantScoped: true })).toEqual({
      kind: 'unconfigured',
    })
  })

  it('global_only requires a configured platform provider', () => {
    expect(
      resolveEffectiveSmsTransport({ mode: 'global_only' }, tenant, { tenantScoped: true }),
    ).toEqual({ kind: 'unconfigured' })
  })

  it('platform send (not tenant-scoped) never uses a tenant provider', () => {
    expect(
      resolveEffectiveSmsTransport({ ...platform, mode: 'tenant_optional' }, tenant, {
        tenantScoped: false,
      }),
    ).toMatchObject({ kind: 'transport', source: 'platform' })
  })

  it('fails closed for an unknown policy and a corrupt explicitly enabled override', () => {
    expect(
      resolveEffectiveSmsTransport(
        { ...platform, mode: 'unknown' } as unknown as PlatformSmsConfig,
        tenant,
        { tenantScoped: true },
      ),
    ).toEqual({ kind: 'unconfigured' })
    expect(
      resolveEffectiveSmsTransport(
        { ...platform, mode: 'tenant_optional' },
        { enabled: true, provider: 'messagebird', fromNumber: 'Tenant' },
        { tenantScoped: true },
      ),
    ).toEqual({ kind: 'unconfigured' })
  })
})

describe('sendSmsVia (HTTP providers)', () => {
  it('twilio → POSTs form-encoded with basic auth, reads the sid', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }))
    const t: SmsTransport = { provider: 'twilio', accountSid: 'AC9', authToken: 'k', from: '+1999' }
    expect(await sendSmsVia(t, INPUT)).toEqual({ id: 'SM1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC9/Messages.json')
    expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
    expect(String(init!.body)).toContain('From=%2B1999')
    expect(secureFetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        maxRedirects: 0,
        maxRequestBytes: 16 * 1_024,
        maxResponseBytes: 64 * 1_024,
        timeoutMs: 15_000,
      }),
    )
  })

  it('twilio → routes a Messaging Service SID into MessagingServiceSid', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ sid: 'SM2' }), { status: 201 }))
    const t: SmsTransport = { provider: 'twilio', accountSid: 'AC9', authToken: 'k', from: 'MG123' }
    await sendSmsVia(t, INPUT)
    expect(String(fetchMock.mock.calls[0]![1]!.body)).toContain('MessagingServiceSid=MG123')
  })

  it('vonage → throws when the message status is non-zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ status: '4', 'error-text': 'bad key' }] }), {
        status: 200,
      }),
    )
    const t: SmsTransport = {
      provider: 'vonage',
      apiKey: 'vonage-api-key',
      apiSecret: 'vonage-api-secret',
      from: 'B',
    }
    await expect(sendSmsVia(t, INPUT)).rejects.toThrow(/Vonage: bad key/)
  })

  it('telnyx → throws with the provider error detail on HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ detail: 'nope' }] }), { status: 422 }),
    )
    const t: SmsTransport = { provider: 'telnyx', apiKey: 'bad', from: '+1' }
    await expect(sendSmsVia(t, INPUT)).rejects.toThrow(/Telnyx: nope/)
  })

  it('rejects malformed input and provider success without a durable message id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }))
    const t: SmsTransport = { provider: 'twilio', accountSid: 'AC9', authToken: 'k', from: '+1999' }
    await expect(sendSmsVia(t, { to: '5551234', body: 'Hello' })).rejects.toThrow(/E\.164/)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(sendSmsVia(t, INPUT)).rejects.toThrow(/without a message id/)
  })

  it('redacts provider credentials echoed in an error response', async () => {
    const token = 'super-secret-twilio-token'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: `Rejected credential ${token}` }), { status: 401 }),
    )
    const transport: SmsTransport = {
      provider: 'twilio',
      accountSid: 'AC9',
      authToken: token,
      from: '+1999',
    }

    await expect(sendSmsVia(transport, INPUT)).rejects.toThrow(
      'Twilio: Rejected credential [redacted]',
    )
  })
})
