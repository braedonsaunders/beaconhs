// SMS transport factory + provider implementations.
//
// `RawSmsConfig` is what we persist per tenant (and per platform), with the
// single secret AES-sealed. `resolveSmsTransport` unseals it into an
// `SmsTransport` (plaintext secret); `buildSmsTransport` does the same from
// already-plaintext values (the admin "send test" path). `sendSmsVia` performs
// the network send, switching on provider. Every provider goes through `fetch`
// (no SDKs), so the package stays dependency-free and bundles into the worker.

import { decryptSecret } from './crypto'
import type { SmsProvider } from './providers'

export type SendSmsInput = {
  /** Destination phone number, E.164 (e.g. +15551234567). */
  to: string
  /** Message text. */
  body: string
  /** Override the configured sender (phone number / sender ID). */
  from?: string
}

// ---------------------------------------------------------------------------
// Stored config (secret sealed)
// ---------------------------------------------------------------------------

/** Per-tenant / per-platform SMS config persisted in JSON. Secret is sealed. */
export type RawSmsConfig = {
  enabled?: boolean
  provider?: SmsProvider
  /** Universal sender — a phone number (E.164) or alphanumeric sender ID. */
  fromNumber?: string
  // provider-specific, non-secret identifiers
  twilioAccountSid?: string
  vonageApiKey?: string
  plivoAuthId?: string
  telnyxMessagingProfileId?: string
  // single sealed secret (auth token / api secret / api key / access key)
  keyCiphertext?: string
  keyNonce?: string
}

/** Platform-wide SMS policy. */
export type SmsPolicyMode = 'tenant_optional' | 'global_only' | 'disabled'

/**
 * Global config a super-admin manages once for the whole deployment: the
 * platform default provider PLUS the policy that governs tenant overrides and
 * the kill switch.
 */
export type PlatformSmsConfig = RawSmsConfig & {
  mode?: SmsPolicyMode
}

/** Plaintext config (secret already unsealed) — the input to `buildSmsTransport`. */
export type PlainSmsConfig = Omit<RawSmsConfig, 'keyCiphertext' | 'keyNonce'> & {
  secret?: string
}

// ---------------------------------------------------------------------------
// Resolved transport (plaintext secret, ready to send)
// ---------------------------------------------------------------------------

export type SmsTransport =
  | { provider: 'twilio'; accountSid: string; authToken: string; from: string }
  | { provider: 'vonage'; apiKey: string; apiSecret: string; from: string }
  | { provider: 'messagebird'; accessKey: string; from: string }
  | { provider: 'plivo'; authId: string; authToken: string; from: string }
  | { provider: 'telnyx'; apiKey: string; from: string; messagingProfileId?: string }

/** Build a transport from already-plaintext config, or null when incomplete. */
export function buildSmsTransport(c: PlainSmsConfig): SmsTransport | null {
  const from = c.fromNumber?.trim()
  if (!from) return null
  const secret = c.secret?.trim() || undefined
  switch (c.provider) {
    case 'twilio': {
      const accountSid = c.twilioAccountSid?.trim()
      if (!accountSid || !secret) return null
      return { provider: 'twilio', accountSid, authToken: secret, from }
    }
    case 'vonage': {
      const apiKey = c.vonageApiKey?.trim()
      if (!apiKey || !secret) return null
      return { provider: 'vonage', apiKey, apiSecret: secret, from }
    }
    case 'messagebird':
      if (!secret) return null
      return { provider: 'messagebird', accessKey: secret, from }
    case 'plivo': {
      const authId = c.plivoAuthId?.trim()
      if (!authId || !secret) return null
      return { provider: 'plivo', authId, authToken: secret, from }
    }
    case 'telnyx':
      if (!secret) return null
      return {
        provider: 'telnyx',
        apiKey: secret,
        from,
        messagingProfileId: c.telnyxMessagingProfileId?.trim() || undefined,
      }
    default:
      return null
  }
}

/** Unseal a stored config and build its transport, or null when not configured. */
export function resolveSmsTransport(raw: RawSmsConfig | null | undefined): SmsTransport | null {
  if (!raw || !raw.provider || raw.enabled === false) return null
  let secret: string | undefined
  if (raw.keyCiphertext && raw.keyNonce) {
    secret = decryptSecret({ ciphertext: raw.keyCiphertext, nonce: raw.keyNonce }) ?? undefined
  }
  return buildSmsTransport({ ...raw, secret })
}

/** What the worker should do for a given send. */
export type EffectiveSms =
  | { kind: 'suppressed' }
  | { kind: 'transport'; transport: SmsTransport; source: 'tenant' | 'platform' }
  | { kind: 'fallback' }

/**
 * The platform → tenant → env resolution policy, as a pure function so it can be
 * unit-tested without a database. The worker reads the two stored configs and
 * calls this; `tenantScoped` is false for platform sends so a tenant's provider
 * is never used to send a non-tenant message.
 *
 *   mode 'disabled'        → suppressed (kill switch; do not send, do not retry)
 *   mode 'global_only'     → platform provider, else env fallback
 *   mode 'tenant_optional' → tenant provider (if scoped + configured),
 *                            else platform provider, else env fallback
 */
export function resolveEffectiveSmsTransport(
  platform: PlatformSmsConfig | null | undefined,
  tenant: RawSmsConfig | null | undefined,
  opts: { tenantScoped: boolean },
): EffectiveSms {
  const mode: SmsPolicyMode = platform?.mode ?? 'tenant_optional'
  if (mode === 'disabled') return { kind: 'suppressed' }

  const platformTransport = resolveSmsTransport(platform ?? null)
  if (mode === 'global_only') {
    return platformTransport
      ? { kind: 'transport', transport: platformTransport, source: 'platform' }
      : { kind: 'fallback' }
  }

  // tenant_optional
  if (opts.tenantScoped) {
    const tenantTransport = resolveSmsTransport(tenant ?? null)
    if (tenantTransport) return { kind: 'transport', transport: tenantTransport, source: 'tenant' }
  }
  if (platformTransport)
    return { kind: 'transport', transport: platformTransport, source: 'platform' }
  return { kind: 'fallback' }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

function errText(body: unknown, status: number): string {
  if (typeof body === 'string' && body) return body.slice(0, 300)
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    const msg = o.message ?? o.error ?? o.Message ?? o.detail ?? JSON.stringify(o)
    return String(msg).slice(0, 300)
  }
  return `HTTP ${status}`
}

/** Strip a single leading + — providers that want a bare international number. */
function stripPlus(n: string): string {
  return n.startsWith('+') ? n.slice(1) : n
}

/** Send an SMS through a resolved transport. Throws on provider error. */
export async function sendSmsVia(
  transport: SmsTransport,
  input: SendSmsInput,
): Promise<{ id: string }> {
  const from = input.from?.trim() || transport.from
  switch (transport.provider) {
    case 'twilio':
      return sendTwilio(transport, input, from)
    case 'vonage':
      return sendVonage(transport, input, from)
    case 'messagebird':
      return sendMessagebird(transport, input, from)
    case 'plivo':
      return sendPlivo(transport, input, from)
    case 'telnyx':
      return sendTelnyx(transport, input, from)
  }
}

async function sendTwilio(
  t: Extract<SmsTransport, { provider: 'twilio' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const params = new URLSearchParams({ To: input.to, Body: input.body })
  // A Messaging Service SID (starts MG) goes in its own field; a number is `From`.
  if (from.startsWith('MG')) params.set('MessagingServiceSid', from)
  else params.set('From', from)
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    },
  )
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string }
  if (!res.ok) throw new Error(`Twilio: ${errText(json, res.status)}`)
  return { id: json.sid ?? '' }
}

async function sendVonage(
  t: Extract<SmsTransport, { provider: 'vonage' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const params = new URLSearchParams({
    api_key: t.apiKey,
    api_secret: t.apiSecret,
    to: stripPlus(input.to),
    from,
    text: input.body,
  })
  const res = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: params,
  })
  const json = (await res.json().catch(() => ({}))) as {
    messages?: { status?: string; 'message-id'?: string; 'error-text'?: string }[]
  }
  const msg = json.messages?.[0]
  // Vonage returns HTTP 200 even for per-message failures — status '0' is success.
  if (!res.ok || !msg || msg.status !== '0') {
    throw new Error(`Vonage: ${msg?.['error-text'] ?? errText(json, res.status)}`)
  }
  return { id: msg['message-id'] ?? '' }
}

async function sendMessagebird(
  t: Extract<SmsTransport, { provider: 'messagebird' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const res = await fetch('https://rest.messagebird.com/messages', {
    method: 'POST',
    headers: { Authorization: `AccessKey ${t.accessKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [input.to], originator: from, body: input.body }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    id?: string
    errors?: { description?: string }[]
  }
  if (!res.ok || json.errors?.length) {
    throw new Error(`MessageBird: ${json.errors?.[0]?.description ?? errText(json, res.status)}`)
  }
  return { id: json.id ?? '' }
}

async function sendPlivo(
  t: Extract<SmsTransport, { provider: 'plivo' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `https://api.plivo.com/v1/Account/${encodeURIComponent(t.authId)}/Message/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.authId}:${t.authToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ src: from, dst: input.to, text: input.body }),
    },
  )
  const json = (await res.json().catch(() => ({}))) as { message_uuid?: string[]; error?: string }
  if (!res.ok || json.error) throw new Error(`Plivo: ${json.error ?? errText(json, res.status)}`)
  return { id: json.message_uuid?.[0] ?? '' }
}

async function sendTelnyx(
  t: Extract<SmsTransport, { provider: 'telnyx' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: input.to,
      text: input.body,
      messaging_profile_id: t.messagingProfileId,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string }
    errors?: { detail?: string; title?: string }[]
  }
  if (!res.ok || json.errors?.length) {
    const e = json.errors?.[0]
    throw new Error(`Telnyx: ${e?.detail ?? e?.title ?? errText(json, res.status)}`)
  }
  return { id: json.data?.id ?? '' }
}
