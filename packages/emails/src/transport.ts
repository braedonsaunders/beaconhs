// Email transport factory + provider implementations.
//
// `RawEmailConfig` is what we persist per tenant (and per platform), with the
// single secret AES-sealed. `resolveEmailTransport` unseals it into an
// `EmailTransport` (plaintext secret); `buildTransport` does the same from
// already-plaintext values (the admin "send test" path). `sendVia` performs the
// network send, switching on provider. HTTP providers go through `fetch` (no
// SDKs); SMTP uses nodemailer (dynamically imported so it never loads unless an
// SMTP transport is actually used).

import { decryptSecret } from './crypto'
import type { EmailProvider } from './providers'

export type EmailAttachment = {
  filename: string
  /** base64-encoded file contents. */
  content: string
  contentType?: string
}

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  text: string
  from?: string
  replyTo?: string
  attachments?: EmailAttachment[]
}

// ---------------------------------------------------------------------------
// Stored config (secret sealed)
// ---------------------------------------------------------------------------

/** Per-tenant / per-platform email config persisted in JSON. Secret is sealed. */
export type RawEmailConfig = {
  enabled?: boolean
  provider?: EmailProvider
  fromName?: string
  fromEmail?: string
  replyTo?: string
  // provider-specific, non-secret
  mailgunDomain?: string
  mailgunRegion?: 'us' | 'eu'
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  smtpUsername?: string
  // single sealed secret (api key / server token / smtp password)
  keyCiphertext?: string
  keyNonce?: string
}

/** Platform-wide email policy. */
export type EmailPolicyMode = 'tenant_optional' | 'global_only' | 'disabled'

/**
 * Global config a super-admin manages once for the whole deployment: the
 * platform default provider PLUS the policy that governs tenant overrides and
 * the kill switch.
 */
export type PlatformEmailConfig = RawEmailConfig & {
  mode?: EmailPolicyMode
}

/** Plaintext config (secret already unsealed) — the input to `buildTransport`. */
export type PlainEmailConfig = Omit<RawEmailConfig, 'keyCiphertext' | 'keyNonce'> & {
  secret?: string
}

// ---------------------------------------------------------------------------
// Resolved transport (plaintext secret, ready to send)
// ---------------------------------------------------------------------------

export type EmailTransport =
  | { provider: 'resend'; apiKey: string; from: string; replyTo?: string }
  | { provider: 'sendgrid'; apiKey: string; from: string; replyTo?: string }
  | {
      provider: 'mailgun'
      apiKey: string
      domain: string
      region: 'us' | 'eu'
      from: string
      replyTo?: string
    }
  | { provider: 'postmark'; serverToken: string; from: string; replyTo?: string }
  | {
      provider: 'smtp'
      host: string
      port: number
      secure: boolean
      username?: string
      password?: string
      from: string
      replyTo?: string
    }

/** Format a `Name <email>` sender, or null when no email is set. */
export function formatFrom(name?: string, email?: string): string | null {
  const e = email?.trim()
  if (!e) return null
  const n = name?.trim()
  return n ? `${n} <${e}>` : e
}

/** Build a transport from already-plaintext config, or null when incomplete. */
export function buildTransport(c: PlainEmailConfig): EmailTransport | null {
  const from = formatFrom(c.fromName, c.fromEmail)
  if (!from) return null
  const replyTo = c.replyTo?.trim() || undefined
  const secret = c.secret?.trim() || undefined
  switch (c.provider) {
    case 'resend':
      return secret ? { provider: 'resend', apiKey: secret, from, replyTo } : null
    case 'sendgrid':
      return secret ? { provider: 'sendgrid', apiKey: secret, from, replyTo } : null
    case 'mailgun':
      if (!secret || !c.mailgunDomain?.trim()) return null
      return {
        provider: 'mailgun',
        apiKey: secret,
        domain: c.mailgunDomain.trim(),
        region: c.mailgunRegion === 'eu' ? 'eu' : 'us',
        from,
        replyTo,
      }
    case 'postmark':
      return secret ? { provider: 'postmark', serverToken: secret, from, replyTo } : null
    case 'smtp':
      if (!c.smtpHost?.trim()) return null
      return {
        provider: 'smtp',
        host: c.smtpHost.trim(),
        port: c.smtpPort && c.smtpPort > 0 ? c.smtpPort : 587,
        secure: c.smtpSecure ?? false,
        username: c.smtpUsername?.trim() || undefined,
        password: secret,
        from,
        replyTo,
      }
    default:
      return null
  }
}

/** Unseal a stored config and build its transport, or null when not configured. */
export function resolveEmailTransport(
  raw: RawEmailConfig | null | undefined,
): EmailTransport | null {
  if (!raw || !raw.provider || raw.enabled === false) return null
  let secret: string | undefined
  if (raw.keyCiphertext && raw.keyNonce) {
    secret = decryptSecret({ ciphertext: raw.keyCiphertext, nonce: raw.keyNonce }) ?? undefined
  }
  return buildTransport({ ...raw, secret })
}

/** What the worker should do for a given send. */
export type EffectiveEmail =
  | { kind: 'suppressed' }
  | { kind: 'transport'; transport: EmailTransport; source: 'tenant' | 'platform' }
  | { kind: 'fallback' }

/**
 * The platform → tenant → env resolution policy, as a pure function so it can be
 * unit-tested without a database. The worker reads the two stored configs and
 * calls this; `tenantScoped` is false for platform sends (auth magic-links) so a
 * tenant's provider is never used to send a non-tenant email.
 *
 *   mode 'disabled'        → suppressed (kill switch; do not send, do not retry)
 *   mode 'global_only'     → platform provider, else env fallback
 *   mode 'tenant_optional' → tenant provider (if scoped + configured),
 *                            else platform provider, else env fallback
 */
export function resolveEffectiveTransport(
  platform: PlatformEmailConfig | null | undefined,
  tenant: RawEmailConfig | null | undefined,
  opts: { tenantScoped: boolean },
): EffectiveEmail {
  const mode: EmailPolicyMode = platform?.mode ?? 'tenant_optional'
  if (mode === 'disabled') return { kind: 'suppressed' }

  const platformTransport = resolveEmailTransport(platform ?? null)
  if (mode === 'global_only') {
    return platformTransport
      ? { kind: 'transport', transport: platformTransport, source: 'platform' }
      : { kind: 'fallback' }
  }

  // tenant_optional
  if (opts.tenantScoped) {
    const tenantTransport = resolveEmailTransport(tenant ?? null)
    if (tenantTransport) return { kind: 'transport', transport: tenantTransport, source: 'tenant' }
  }
  if (platformTransport)
    return { kind: 'transport', transport: platformTransport, source: 'platform' }
  return { kind: 'fallback' }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

function toArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v]
}

/** Split a `Name <email>` address into its parts (SendGrid/Postmark want them apart). */
function parseAddress(addr: string): { email: string; name?: string } {
  const m = addr.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { email: m[2]!.trim(), name: m[1] ? m[1].trim() : undefined }
  return { email: addr.trim() }
}

function errText(body: unknown, status: number): string {
  if (typeof body === 'string' && body) return body.slice(0, 300)
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    const msg = o.message ?? o.error ?? o.Message ?? JSON.stringify(o)
    return String(msg).slice(0, 300)
  }
  return `HTTP ${status}`
}

/** Send an email through a resolved transport. Throws on provider error. */
export async function sendVia(
  transport: EmailTransport,
  input: SendEmailInput,
): Promise<{ id: string }> {
  const from = input.from || transport.from
  const replyTo = input.replyTo || transport.replyTo
  switch (transport.provider) {
    case 'resend':
      return sendResend(transport, input, from, replyTo)
    case 'sendgrid':
      return sendSendgrid(transport, input, from, replyTo)
    case 'mailgun':
      return sendMailgun(transport, input, from, replyTo)
    case 'postmark':
      return sendPostmark(transport, input, from, replyTo)
    case 'smtp':
      return sendSmtp(transport, input, from, replyTo)
  }
}

async function sendResend(
  t: Extract<EmailTransport, { provider: 'resend' }>,
  input: SendEmailInput,
  from: string,
  replyTo?: string,
): Promise<{ id: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: toArray(input.to),
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: replyTo,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
      })),
    }),
  })
  const json = (await res.json().catch(() => ({}))) as { id?: string }
  if (!res.ok) throw new Error(`Resend: ${errText(json, res.status)}`)
  return { id: json.id ?? '' }
}

async function sendSendgrid(
  t: Extract<EmailTransport, { provider: 'sendgrid' }>,
  input: SendEmailInput,
  from: string,
  replyTo?: string,
): Promise<{ id: string }> {
  const content: { type: string; value: string }[] = []
  // SendGrid requires a non-empty text/plain part to precede text/html.
  content.push({ type: 'text/plain', value: input.text || ' ' })
  if (input.html) content.push({ type: 'text/html', value: input.html })
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: toArray(input.to).map((email) => ({ email })) }],
      from: parseAddress(from),
      reply_to: replyTo ? parseAddress(replyTo) : undefined,
      subject: input.subject,
      content,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        type: a.contentType,
        disposition: 'attachment',
      })),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SendGrid: ${errText(body, res.status)}`)
  }
  // 202 Accepted with an empty body; the id rides in a response header.
  return { id: res.headers.get('x-message-id') ?? '' }
}

async function sendMailgun(
  t: Extract<EmailTransport, { provider: 'mailgun' }>,
  input: SendEmailInput,
  from: string,
  replyTo?: string,
): Promise<{ id: string }> {
  const form = new FormData()
  form.set('from', from)
  for (const to of toArray(input.to)) form.append('to', to)
  form.set('subject', input.subject)
  if (input.text) form.set('text', input.text)
  if (input.html) form.set('html', input.html)
  if (replyTo) form.set('h:Reply-To', replyTo)
  for (const a of input.attachments ?? []) {
    const blob = new Blob([Buffer.from(a.content, 'base64')], {
      type: a.contentType || 'application/octet-stream',
    })
    form.append('attachment', blob, a.filename)
  }
  const base = t.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
  const res = await fetch(`${base}/v3/${t.domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`api:${t.apiKey}`).toString('base64')}` },
    body: form,
  })
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
  if (!res.ok) throw new Error(`Mailgun: ${errText(json, res.status)}`)
  return { id: json.id ?? '' }
}

async function sendPostmark(
  t: Extract<EmailTransport, { provider: 'postmark' }>,
  input: SendEmailInput,
  from: string,
  replyTo?: string,
): Promise<{ id: string }> {
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': t.serverToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: from,
      To: toArray(input.to).join(', '),
      Subject: input.subject,
      HtmlBody: input.html || undefined,
      TextBody: input.text || undefined,
      ReplyTo: replyTo,
      Attachments: input.attachments?.map((a) => ({
        Name: a.filename,
        Content: a.content,
        ContentType: a.contentType || 'application/octet-stream',
      })),
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    MessageID?: string
    ErrorCode?: number
    Message?: string
  }
  if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
    throw new Error(`Postmark: ${json.Message ?? errText(json, res.status)}`)
  }
  return { id: json.MessageID ?? '' }
}

async function sendSmtp(
  t: Extract<EmailTransport, { provider: 'smtp' }>,
  input: SendEmailInput,
  from: string,
  replyTo?: string,
): Promise<{ id: string }> {
  // Dynamic import keeps nodemailer out of the load path unless SMTP is used.
  const nodemailer = (await import('nodemailer')).default
  const tx = nodemailer.createTransport({
    host: t.host,
    port: t.port,
    secure: t.secure,
    auth: t.username ? { user: t.username, pass: t.password ?? '' } : undefined,
  })
  const info = await tx.sendMail({
    from,
    to: toArray(input.to),
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
      contentType: a.contentType,
    })),
  })
  return { id: info.messageId ?? '' }
}
