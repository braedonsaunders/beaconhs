import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@beaconhs/crypto'
import {
  buildTransport,
  resolveEffectiveTransport,
  resolveEmailTransport,
  sendVia,
  type EmailTransport,
  type PlatformEmailConfig,
  type RawEmailConfig,
  type SendEmailInput,
} from './transport'

const INPUT: SendEmailInput = {
  to: 'dest@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
}

function sealed(secret: string) {
  const s = sealSecret(secret)
  return { keyCiphertext: s.ciphertext, keyNonce: s.nonce }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildTransport', () => {
  it('formats the sender and carries the secret per provider', () => {
    expect(
      buildTransport({
        provider: 'resend',
        fromName: 'BeaconHS',
        fromEmail: 'no-reply@b.io',
        secret: 're_x',
      }),
    ).toEqual({
      provider: 'resend',
      apiKey: 're_x',
      from: 'BeaconHS <no-reply@b.io>',
      replyTo: undefined,
    })

    expect(
      buildTransport({
        provider: 'mailgun',
        fromEmail: 'no-reply@b.io',
        secret: 'k',
        mailgunDomain: 'mg.b.io',
        mailgunRegion: 'eu',
      }),
    ).toMatchObject({ provider: 'mailgun', domain: 'mg.b.io', region: 'eu', from: 'no-reply@b.io' })

    expect(
      buildTransport({
        provider: 'smtp',
        fromEmail: 'no-reply@b.io',
        smtpHost: 'smtp.b.io',
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: 'u',
        secret: 'p',
      }),
    ).toMatchObject({
      provider: 'smtp',
      host: 'smtp.b.io',
      port: 465,
      secure: true,
      username: 'u',
      password: 'p',
    })
  })

  it('returns null when required pieces are missing', () => {
    expect(buildTransport({ provider: 'resend', fromEmail: 'a@b.io' })).toBeNull() // no secret
    expect(buildTransport({ provider: 'resend', secret: 'x' })).toBeNull() // no from
    expect(buildTransport({ provider: 'mailgun', fromEmail: 'a@b.io', secret: 'x' })).toBeNull() // no domain
    expect(buildTransport({ provider: 'smtp', fromEmail: 'a@b.io' })).toBeNull() // no host
  })

  it('allows SMTP without a secret (unauthenticated relay)', () => {
    expect(
      buildTransport({
        provider: 'smtp',
        fromEmail: 'a@b.io',
        smtpHost: 'localhost',
        smtpPort: 1025,
      }),
    ).toMatchObject({ provider: 'smtp', host: 'localhost', port: 1025, password: undefined })
  })
})

describe('resolveEmailTransport (unseal)', () => {
  it('unseals the stored secret and builds the transport', () => {
    const raw: RawEmailConfig = {
      provider: 'sendgrid',
      fromEmail: 'a@b.io',
      ...sealed('SG.secret'),
    }
    expect(resolveEmailTransport(raw)).toMatchObject({ provider: 'sendgrid', apiKey: 'SG.secret' })
  })

  it('returns null when disabled or unconfigured', () => {
    expect(resolveEmailTransport(null)).toBeNull()
    expect(
      resolveEmailTransport({
        provider: 'resend',
        enabled: false,
        fromEmail: 'a@b.io',
        ...sealed('x'),
      }),
    ).toBeNull()
    expect(resolveEmailTransport({ fromEmail: 'a@b.io' })).toBeNull()
  })
})

describe('resolveEffectiveTransport (platform → tenant → env precedence)', () => {
  const platform: PlatformEmailConfig = {
    provider: 'postmark',
    fromEmail: 'platform@b.io',
    ...sealed('pm-token'),
  }
  const tenant: RawEmailConfig = {
    provider: 'resend',
    fromEmail: 'tenant@b.io',
    ...sealed('re_tenant'),
  }

  it('disabled → suppressed (kill switch)', () => {
    expect(
      resolveEffectiveTransport({ ...platform, mode: 'disabled' }, tenant, { tenantScoped: true }),
    ).toEqual({ kind: 'suppressed' })
  })

  it('global_only → platform provider, ignoring the tenant', () => {
    const r = resolveEffectiveTransport({ ...platform, mode: 'global_only' }, tenant, {
      tenantScoped: true,
    })
    expect(r).toMatchObject({ kind: 'transport', source: 'platform' })
    expect((r as { transport: EmailTransport }).transport.provider).toBe('postmark')
  })

  it('tenant_optional → tenant provider when the tenant has one', () => {
    const r = resolveEffectiveTransport({ ...platform, mode: 'tenant_optional' }, tenant, {
      tenantScoped: true,
    })
    expect(r).toMatchObject({ kind: 'transport', source: 'tenant' })
    expect((r as { transport: EmailTransport }).transport.provider).toBe('resend')
  })

  it('tenant_optional → platform when the tenant has none', () => {
    expect(
      resolveEffectiveTransport({ ...platform, mode: 'tenant_optional' }, null, {
        tenantScoped: true,
      }),
    ).toMatchObject({ kind: 'transport', source: 'platform' })
  })

  it('tenant_optional with nothing configured → env fallback', () => {
    expect(resolveEffectiveTransport(null, null, { tenantScoped: true })).toEqual({
      kind: 'fallback',
    })
  })

  it('platform send (not tenant-scoped) never uses a tenant provider', () => {
    expect(
      resolveEffectiveTransport({ ...platform, mode: 'tenant_optional' }, tenant, {
        tenantScoped: false,
      }),
    ).toMatchObject({ kind: 'transport', source: 'platform' })
  })
})

describe('sendVia (HTTP providers)', () => {
  it('resend → POSTs to the API with a bearer token', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'rs-1' }), { status: 200 }))
    const t: EmailTransport = { provider: 'resend', apiKey: 're_k', from: 'a@b.io' }
    expect(await sendVia(t, INPUT)).toEqual({ id: 'rs-1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer re_k')
    expect(JSON.parse(init!.body as string)).toMatchObject({ from: 'a@b.io', subject: 'Hi' })
  })

  it('sendgrid → reads the id from the response header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 202, headers: { 'x-message-id': 'sg-9' } }),
    )
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'A <a@b.io>' }
    expect(await sendVia(t, INPUT)).toEqual({ id: 'sg-9' })
  })

  it('mailgun → POSTs to the regional endpoint with basic auth', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'mg-1' }), { status: 200 }))
    const t: EmailTransport = {
      provider: 'mailgun',
      apiKey: 'k',
      domain: 'mg.b.io',
      region: 'eu',
      from: 'a@b.io',
    }
    expect(await sendVia(t, INPUT)).toEqual({ id: 'mg-1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.eu.mailgun.net/v3/mg.b.io/messages')
    expect((init!.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
  })

  it('postmark → throws on a non-zero ErrorCode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ErrorCode: 10, Message: 'bad token' }), { status: 200 }),
    )
    const t: EmailTransport = { provider: 'postmark', serverToken: 'x', from: 'a@b.io' }
    await expect(sendVia(t, INPUT)).rejects.toThrow(/Postmark: bad token/)
  })

  it('throws with the provider error body on HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), { status: 401 }),
    )
    const t: EmailTransport = { provider: 'resend', apiKey: 'bad', from: 'a@b.io' }
    await expect(sendVia(t, INPUT)).rejects.toThrow(/Resend: nope/)
  })
})
