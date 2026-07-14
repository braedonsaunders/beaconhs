import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sealSecret } from '@beaconhs/crypto'
import { isValidEmailAddress } from '@beaconhs/email-render/delivery-input'
import { isEmailProvider } from './providers'
import {
  resolveEffectiveTransport,
  resolveEmailTransport,
  sendVia,
  validateStoredEmailConfig,
  type EmailTransport,
  type PlatformEmailConfig,
  type RawEmailConfig,
  type SendEmailInput,
} from './transport'

const nodemailerMock = vi.hoisted(() => ({
  createTransport: vi.fn(),
  resolvePublicHost: vi.fn(),
  sendMail: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: nodemailerMock.createTransport },
}))
vi.mock('@beaconhs/sync/egress', () => ({ resolvePublicHost: nodemailerMock.resolvePublicHost }))

const originalNodeEnv = process.env.NODE_ENV

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

describe('isValidEmailAddress', () => {
  it('accepts provider-compatible ASCII mailboxes and rejects malformed domains/local parts', () => {
    expect(isValidEmailAddress('safety.alerts+dev@example-site.com')).toBe(true)
    for (const value of [
      'a,b@example.com',
      'a@a..com',
      'a@-bad.com',
      'a@bad-.com',
      '.a@example.com',
      'a..b@example.com',
      'safety@localhost',
      'safety@192.0.2.1',
      'sáfety@example.com',
    ]) {
      expect(isValidEmailAddress(value), value).toBe(false)
    }
  })
})

describe('isEmailProvider', () => {
  it('accepts only catalogue entries and rejects inherited object properties', () => {
    expect(isEmailProvider('sendgrid')).toBe(true)
    expect(isEmailProvider('toString')).toBe(false)
    expect(isEmailProvider('constructor')).toBe(false)
    expect(isEmailProvider('__proto__')).toBe(false)
  })
})

beforeEach(() => {
  nodemailerMock.resolvePublicHost.mockResolvedValue({
    hostname: 'smtp.example.com',
    address: '93.184.216.34',
    family: 4,
    ipLiteral: false,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  nodemailerMock.createTransport.mockReset()
  nodemailerMock.resolvePublicHost.mockReset()
  nodemailerMock.sendMail.mockReset()
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
})

describe('resolveEmailTransport', () => {
  it('formats the sender and unseals credentials for each provider', () => {
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'resend',
        fromName: 'BeaconHS',
        fromEmail: 'no-reply@b.io',
        ...sealed('re_x'),
      }),
    ).toEqual({
      provider: 'resend',
      apiKey: 're_x',
      from: 'BeaconHS <no-reply@b.io>',
      replyTo: undefined,
    })

    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'mailgun',
        fromEmail: 'no-reply@b.io',
        ...sealed('k'),
        mailgunDomain: 'mg.b.io',
        mailgunRegion: 'eu',
      }),
    ).toMatchObject({ provider: 'mailgun', domain: 'mg.b.io', region: 'eu', from: 'no-reply@b.io' })

    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'no-reply@b.io',
        smtpHost: 'smtp.b.io',
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: 'u',
        ...sealed('p'),
      }),
    ).toMatchObject({
      provider: 'smtp',
      mode: 'database',
      host: 'smtp.b.io',
      port: 465,
      secure: true,
      username: 'u',
      password: 'p',
    })
  })

  it('returns null when required pieces are missing', () => {
    expect(resolveEmailTransport({ provider: 'resend', fromEmail: 'a@b.io' })).toBeNull()
    expect(resolveEmailTransport({ provider: 'resend', ...sealed('x') })).toBeNull()
    expect(
      resolveEmailTransport({ provider: 'mailgun', fromEmail: 'a@b.io', ...sealed('x') }),
    ).toBeNull()
    expect(resolveEmailTransport({ provider: 'smtp', fromEmail: 'a@b.io' })).toBeNull()
  })

  it('rejects malformed provider fields instead of resolving a transport', () => {
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'sendgrid',
        fromEmail: 'not-an-email',
        ...sealed('SG.secret'),
      }),
    ).toBeNull()
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'mailgun',
        fromEmail: 'a@b.io',
        ...sealed('key'),
        mailgunDomain: 'https://mg.b.io',
      }),
    ).toBeNull()
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'a@b.io',
        smtpHost: 'smtp://b.io',
        smtpPort: 70_000,
      }),
    ).toBeNull()
  })

  it('allows SMTP without a secret (unauthenticated relay)', () => {
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'a@b.io',
        smtpHost: 'localhost',
        smtpPort: 1025,
      }),
    ).toMatchObject({
      provider: 'smtp',
      mode: 'database',
      host: 'localhost',
      port: 1025,
      password: undefined,
    })
  })

  it('requires SMTP username and password together', () => {
    const usernameOnly: RawEmailConfig = {
      enabled: true,
      provider: 'smtp',
      fromEmail: 'sender@example.com',
      smtpHost: 'smtp.example.com',
      smtpUsername: 'smtp-user',
    }
    const passwordOnly: RawEmailConfig = {
      enabled: true,
      provider: 'smtp',
      fromEmail: 'sender@example.com',
      smtpHost: 'smtp.example.com',
      ...sealed('smtp-password'),
    }

    expect(() => validateStoredEmailConfig(usernameOnly, { requireComplete: true })).toThrow(
      'SMTP username and password must both be provided',
    )
    expect(() => validateStoredEmailConfig(passwordOnly, { requireComplete: true })).toThrow(
      'SMTP username and password must both be provided',
    )
    expect(resolveEmailTransport(usernameOnly)).toBeNull()
    expect(resolveEmailTransport(passwordOnly)).toBeNull()
  })

  it('defaults SMTP ports from its TLS mode', () => {
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'sender@example.com',
        smtpHost: 'smtp.example.com',
        smtpSecure: true,
      }),
    ).toMatchObject({ port: 465, secure: true })
    expect(
      resolveEmailTransport({
        enabled: true,
        provider: 'smtp',
        fromEmail: 'sender@example.com',
        smtpHost: 'smtp.example.com',
        smtpSecure: false,
      }),
    ).toMatchObject({ port: 587, secure: false })
  })
})

describe('resolveEmailTransport (unseal)', () => {
  it('unseals the stored secret and builds the transport', () => {
    const raw: RawEmailConfig = {
      enabled: true,
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
    const legacyImplicitConfig: RawEmailConfig = {
      provider: 'sendgrid',
      fromEmail: 'a@b.io',
      ...sealed('SG.legacy'),
    }
    expect(() => validateStoredEmailConfig(legacyImplicitConfig)).not.toThrow()
    expect(() =>
      validateStoredEmailConfig(legacyImplicitConfig, { requireComplete: true }),
    ).toThrow('Enable email delivery before selecting a live email policy.')
    expect(resolveEmailTransport(legacyImplicitConfig)).toBeNull()
  })

  it('returns null for a decryptable but malformed stored provider', () => {
    const raw: RawEmailConfig = {
      enabled: true,
      provider: 'sendgrid',
      fromEmail: 'not-an-email',
      ...sealed('SG.secret'),
    }
    expect(() => validateStoredEmailConfig(raw, { requireComplete: true })).toThrow(
      'Enter a valid From email address.',
    )
    expect(resolveEmailTransport(raw)).toBeNull()
  })

  it('requires an enabled provider when deployment requests a complete live config', () => {
    const disabled: RawEmailConfig = {
      enabled: false,
      provider: 'sendgrid',
      fromEmail: 'a@b.io',
      ...sealed('SG.secret'),
    }
    expect(() => validateStoredEmailConfig(disabled)).not.toThrow()
    expect(() => validateStoredEmailConfig(disabled, { requireComplete: true })).toThrow(
      'Enable email delivery before selecting a live email policy.',
    )
  })
})

describe('resolveEffectiveTransport (platform → tenant precedence)', () => {
  const platform: PlatformEmailConfig = {
    enabled: true,
    provider: 'postmark',
    fromEmail: 'platform@b.io',
    ...sealed('pm-token'),
  }
  const tenant: RawEmailConfig = {
    enabled: true,
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

  it('tenant_optional fails closed when an explicitly enabled override is corrupt', () => {
    expect(
      resolveEffectiveTransport(
        { ...platform, mode: 'tenant_optional' },
        {
          enabled: true,
          provider: 'sendgrid',
          fromEmail: 'tenant@b.io',
          keyCiphertext: 'corrupt',
          keyNonce: 'corrupt',
        },
        { tenantScoped: true },
      ),
    ).toEqual({ kind: 'unconfigured' })
  })

  it('tenant_optional with nothing configured → unconfigured', () => {
    expect(resolveEffectiveTransport(null, null, { tenantScoped: true })).toEqual({
      kind: 'unconfigured',
    })
  })

  it('platform send (not tenant-scoped) never uses a tenant provider', () => {
    expect(
      resolveEffectiveTransport({ ...platform, mode: 'tenant_optional' }, tenant, {
        tenantScoped: false,
      }),
    ).toMatchObject({ kind: 'transport', source: 'platform' })
  })

  it('rejects an unknown platform policy instead of failing open', () => {
    const invalid = { ...platform, mode: 'unexpected' } as unknown as PlatformEmailConfig
    expect(() => validateStoredEmailConfig(invalid, { requireComplete: true })).toThrow(
      'Select a valid platform email policy.',
    )
    expect(resolveEffectiveTransport(invalid, tenant, { tenantScoped: true })).toEqual({
      kind: 'unconfigured',
    })
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

  it('sendgrid → uses transport addresses and reads the id from the response header', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 202, headers: { 'x-message-id': 'sg-9' } }))
    const t: EmailTransport = {
      provider: 'sendgrid',
      apiKey: 'SG.k',
      from: 'A <a@b.io>',
      replyTo: 'Support <support@b.io>',
    }
    expect(await sendVia(t, INPUT)).toEqual({ id: 'sg-9' })
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toMatchObject({
      from: { email: 'a@b.io', name: 'A' },
      reply_to: { email: 'support@b.io', name: 'Support' },
    })
  })

  it('normalizes transport-significant subject whitespace before provider delivery', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 202, headers: { 'x-message-id': 'sg-safe' } }))
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }

    await expect(
      sendVia(t, { ...INPUT, subject: '  Safety\r\nBcc: victim@example.com  ' }),
    ).resolves.toEqual({ id: 'sg-safe' })
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init!.body as string).subject).toBe('Safety Bcc: victim@example.com')
  })

  it('rejects an empty normalized subject before contacting a provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }

    await expect(sendVia(t, { ...INPUT, subject: '\r\n\t' })).rejects.toThrow(
      'Email subject is required',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sendgrid → sends the complete single-recipient payload using configured addresses', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 202, headers: { 'x-message-id': 'sg-full' } }))
    const t: EmailTransport = {
      provider: 'sendgrid',
      apiKey: 'SG.full',
      from: 'Default <default@b.io>',
      replyTo: 'default-reply@b.io',
    }
    const input: SendEmailInput = {
      to: 'one@example.com',
      subject: 'Safety report',
      text: 'Plain report',
      html: '<p>HTML report</p>',
      attachments: [
        {
          filename: 'report.pdf',
          content: 'cGRm',
          contentType: 'application/pdf',
        },
      ],
    }

    await expect(sendVia(t, input)).resolves.toEqual({ id: 'sg-full' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer SG.full')
    expect(init!.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init!.body as string)).toEqual({
      personalizations: [{ to: [{ email: 'one@example.com' }] }],
      from: { email: 'default@b.io', name: 'Default' },
      reply_to: { email: 'default-reply@b.io' },
      subject: 'Safety report',
      content: [
        { type: 'text/plain', value: 'Plain report' },
        { type: 'text/html', value: '<p>HTML report</p>' },
      ],
      attachments: [
        {
          filename: 'report.pdf',
          content: 'cGRm',
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    })
  })

  it('rejects a multi-recipient provider payload before contacting SendGrid', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }

    await expect(
      sendVia(t, { ...INPUT, to: ['one@example.com', 'two@example.com'] }),
    ).rejects.toThrow('exactly one recipient')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sendgrid → sanitizes structured API errors and redacts its credential', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [
            { message: 'Sender is not verified\n' },
            { message: 'Rejected credential SG.private' },
          ],
        }),
        { status: 401 },
      ),
    )
    const t: EmailTransport = {
      provider: 'sendgrid',
      apiKey: 'SG.private',
      from: 'a@b.io',
    }

    const error = await sendVia(t, INPUT).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      'SendGrid: HTTP 401 — Sender is not verified; Rejected credential [redacted]',
    )
    expect((error as Error).message).not.toContain('SG.private')
  })

  it('sendgrid → rejects an unexpected successful HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }

    await expect(sendVia(t, INPUT)).rejects.toThrow(
      'SendGrid: invalid success response — expected HTTP 202, received HTTP 200',
    )
  })

  it('sendgrid → rejects an accepted response without its tracking id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 202 }))
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }

    await expect(sendVia(t, INPUT)).rejects.toThrow(
      'SendGrid: invalid success response — missing x-message-id header',
    )
  })

  it('sendgrid → distinguishes a timeout from other network failures', async () => {
    const timeout = Object.assign(new Error('request aborted'), { name: 'TimeoutError' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout)
    const t: EmailTransport = { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }

    const error = await sendVia(t, INPUT).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('SendGrid: request timed out after 30 seconds')
    expect((error as Error).cause).toBeUndefined()
  })

  it.each([
    ['Resend', { provider: 'resend', apiKey: 're_k', from: 'a@b.io' }],
    ['SendGrid', { provider: 'sendgrid', apiKey: 'SG.k', from: 'a@b.io' }],
    [
      'Mailgun',
      { provider: 'mailgun', apiKey: 'mg_k', domain: 'mg.b.io', region: 'us', from: 'a@b.io' },
    ],
    ['Postmark', { provider: 'postmark', serverToken: 'pm_k', from: 'a@b.io' }],
  ] as const)(
    '%s → wraps network failures without leaking low-level details',
    async (provider, t) => {
      const networkError = new TypeError('socket failed with a sensitive URL')
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkError)

      const error = await sendVia(t, INPUT).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`${provider}: network request failed`)
      expect((error as Error).message).not.toContain('sensitive URL')
      expect((error as Error).cause).toBeUndefined()
    },
  )

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
    await expect(sendVia(t, INPUT)).rejects.toThrow(/Postmark: HTTP 200 — bad token/)
  })

  it('throws with the provider error body on HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'nope' }), { status: 401 }),
    )
    const t: EmailTransport = { provider: 'resend', apiKey: 'bad', from: 'a@b.io' }
    await expect(sendVia(t, INPUT)).rejects.toThrow(/Resend: HTTP 401 — nope/)
  })

  it.each([
    [
      'Resend',
      { provider: 'resend', apiKey: 're_k', from: 'a@b.io' },
      new Response('{}', { status: 200 }),
      'Resend: invalid success response — missing id',
    ],
    [
      'Mailgun',
      { provider: 'mailgun', apiKey: 'mg_k', domain: 'mg.b.io', region: 'us', from: 'a@b.io' },
      new Response(JSON.stringify({ message: 'Queued' }), { status: 200 }),
      'Mailgun: invalid success response — missing id',
    ],
    [
      'Postmark',
      { provider: 'postmark', serverToken: 'pm_k', from: 'a@b.io' },
      new Response(JSON.stringify({ ErrorCode: 0, Message: 'OK' }), { status: 200 }),
      'Postmark: invalid success response — missing MessageID',
    ],
  ] as const)(
    '%s → rejects a documented success response without its provider id',
    async (_provider, t, response, expected) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
      await expect(sendVia(t, INPUT)).rejects.toThrow(expected)
    },
  )
})

describe('sendVia (SMTP)', () => {
  it('rejects mismatched direct SMTP auth before DNS or network access', async () => {
    const transport: EmailTransport = {
      provider: 'smtp',
      mode: 'database',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'smtp-user',
      from: 'sender@example.com',
    }

    await expect(sendVia(transport, INPUT)).rejects.toThrow(
      'username and password must both be provided',
    )
    expect(nodemailerMock.resolvePublicHost).not.toHaveBeenCalled()
    expect(nodemailerMock.createTransport).not.toHaveBeenCalled()
  })

  it('sets bounded connection timeouts and requires Nodemailer acceptance', async () => {
    nodemailerMock.sendMail.mockResolvedValue({ messageId: ' smtp-1 ' })
    nodemailerMock.createTransport.mockReturnValue({ sendMail: nodemailerMock.sendMail })
    const t: EmailTransport = {
      provider: 'smtp',
      mode: 'database',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'smtp-user',
      password: 'smtp-secret',
      from: 'BeaconHS <sender@example.com>',
      replyTo: 'support@example.com',
    }

    await expect(
      sendVia(t, {
        ...INPUT,
        attachments: [{ filename: 'report.txt', content: 'cmVwb3J0', contentType: 'text/plain' }],
      }),
    ).resolves.toEqual({ id: 'smtp-1' })
    expect(nodemailerMock.resolvePublicHost).toHaveBeenCalledWith('smtp.example.com', {
      timeoutMs: 30_000,
    })
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: '93.184.216.34',
      family: 4,
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'smtp-user', pass: 'smtp-secret' },
      tls: { rejectUnauthorized: true, servername: 'smtp.example.com' },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 30_000,
    })
    expect(nodemailerMock.sendMail).toHaveBeenCalledWith({
      from: 'BeaconHS <sender@example.com>',
      to: ['dest@example.com'],
      subject: 'Hi',
      text: 'Hi',
      html: '<p>Hi</p>',
      replyTo: 'support@example.com',
      attachments: [
        {
          filename: 'report.txt',
          content: Buffer.from('report'),
          contentType: 'text/plain',
        },
      ],
    })
  })

  it('redacts longest credentials first and does not expose the original error as a cause', async () => {
    const providerError = new Error('Auth failed for secret-long using secret\n')
    nodemailerMock.sendMail.mockRejectedValue(providerError)
    nodemailerMock.createTransport.mockReturnValue({ sendMail: nodemailerMock.sendMail })
    const t: EmailTransport = {
      provider: 'smtp',
      mode: 'database',
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'secret',
      password: 'secret-long',
      from: 'sender@example.com',
    }

    const error = await sendVia(t, INPUT).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('SMTP: Auth failed for [redacted] using [redacted]')
    expect((error as Error).message).not.toContain('secret')
    expect((error as Error).cause).toBeUndefined()
  })

  it('rejects an SMTP success response without a message id', async () => {
    nodemailerMock.sendMail.mockResolvedValue({})
    nodemailerMock.createTransport.mockReturnValue({ sendMail: nodemailerMock.sendMail })
    const t: EmailTransport = {
      provider: 'smtp',
      mode: 'database',
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      from: 'sender@example.com',
    }

    await expect(sendVia(t, INPUT)).rejects.toThrow(
      'SMTP: invalid success response — missing messageId',
    )
  })

  it('uses implicit TLS while preserving DNS certificate verification', async () => {
    nodemailerMock.sendMail.mockResolvedValue({ messageId: 'smtp-tls' })
    nodemailerMock.createTransport.mockReturnValue({ sendMail: nodemailerMock.sendMail })
    const t: EmailTransport = {
      provider: 'smtp',
      mode: 'database',
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      from: 'sender@example.com',
    }

    await expect(sendVia(t, INPUT)).resolves.toEqual({ id: 'smtp-tls' })
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '93.184.216.34',
        port: 465,
        secure: true,
        requireTLS: false,
        tls: { rejectUnauthorized: true, servername: 'smtp.example.com' },
      }),
    )
  })

  it('rejects public IP literals because they cannot provide a verified DNS identity', async () => {
    nodemailerMock.resolvePublicHost.mockResolvedValue({
      hostname: '93.184.216.34',
      address: '93.184.216.34',
      family: 4,
      ipLiteral: true,
    })
    const t: EmailTransport = {
      provider: 'smtp',
      mode: 'database',
      host: '93.184.216.34',
      port: 465,
      secure: true,
      from: 'sender@example.com',
    }

    await expect(sendVia(t, INPUT)).rejects.toThrow(
      'SMTP: External SMTP host must be a DNS name so its TLS identity can be verified.',
    )
    expect(nodemailerMock.createTransport).not.toHaveBeenCalled()
  })

  it('allows explicit local development delivery only on a pinned loopback address', async () => {
    process.env.NODE_ENV = 'development'
    nodemailerMock.sendMail.mockResolvedValue({ messageId: 'mailpit-1' })
    nodemailerMock.createTransport.mockReturnValue({ sendMail: nodemailerMock.sendMail })
    const t: EmailTransport = {
      provider: 'smtp',
      mode: 'local-dev',
      host: 'localhost',
      port: 1025,
      secure: false,
      from: 'sender@example.com',
    }

    await expect(sendVia(t, INPUT)).resolves.toEqual({ id: 'mailpit-1' })
    expect(nodemailerMock.resolvePublicHost).not.toHaveBeenCalled()
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 1025,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 30_000,
    })
  })

  it('rejects local development SMTP in production, on a non-loopback host, or with auth', async () => {
    const local = {
      provider: 'smtp' as const,
      mode: 'local-dev' as const,
      host: 'localhost',
      port: 1025,
      secure: false as const,
      from: 'sender@example.com',
    }

    process.env.NODE_ENV = 'production'
    await expect(sendVia(local, INPUT)).rejects.toThrow('forbidden outside development mode')

    process.env.NODE_ENV = 'development'
    await expect(sendVia({ ...local, host: 'mail.example.com' }, INPUT)).rejects.toThrow(
      'requires a loopback host',
    )
    await expect(
      sendVia({ ...local, username: 'user', password: 'password' } as EmailTransport, INPUT),
    ).rejects.toThrow('does not permit authentication')
    expect(nodemailerMock.createTransport).not.toHaveBeenCalled()
  })
})
