// SMS transport factory + provider implementations.
//
// `RawSmsConfig` is what we persist per tenant (and per platform), with the
// single secret AES-sealed. `resolveSmsTransport` unseals it into an
// `SmsTransport` (plaintext secret); `buildSmsTransport` does the same from
// already-plaintext values (the admin "send test" path). `sendSmsVia` performs
// the network send, switching on provider. Every provider goes through `fetch`
// (no SDKs), so the package stays dependency-free and bundles into the worker.

import { unsealSecret } from '@beaconhs/crypto'
import { secureFetch } from '@beaconhs/sync/egress'
import { isSmsProvider, type SmsProvider } from './providers'

const SMS_TIMEOUT_MS = 15_000
const MAX_SMS_REQUEST_BYTES = 16 * 1_024
const MAX_SMS_RESPONSE_BYTES = 64 * 1_024
const MAX_SMS_BODY_CHARS = 1_600

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

export function isSmsPolicyMode(value: unknown): value is SmsPolicyMode {
  return value === 'tenant_optional' || value === 'global_only' || value === 'disabled'
}

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

const MAX_SMS_SENDER_LENGTH = 100
const MAX_PROVIDER_IDENTIFIER_LENGTH = 320
const MAX_SEALED_SECRET_LENGTH = 8_192

function isSafeConfigText(value: string, maxLength: number): boolean {
  return Boolean(value.trim()) && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)
}

/** Strict E.164 validation used for every outbound destination. */
export function isValidSmsDestination(value: string): boolean {
  return /^\+[1-9][0-9]{7,14}$/.test(value)
}

function validateSmsConfigFields(
  raw: PlainSmsConfig | RawSmsConfig,
  requireComplete: boolean,
): void {
  if (raw.provider !== undefined && !isSmsProvider(raw.provider)) {
    throw new Error('Select a valid SMS provider.')
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new Error('SMS enabled state must be a boolean.')
  }
  if (raw.fromNumber !== undefined && !isSafeConfigText(raw.fromNumber, MAX_SMS_SENDER_LENGTH)) {
    throw new Error('SMS sender must contain 1 to 100 characters without control characters.')
  }
  for (const [label, value] of [
    ['Twilio account SID', raw.twilioAccountSid],
    ['Vonage API key', raw.vonageApiKey],
    ['Plivo auth ID', raw.plivoAuthId],
    ['Telnyx messaging profile ID', raw.telnyxMessagingProfileId],
  ] as const) {
    if (value !== undefined && !isSafeConfigText(value, MAX_PROVIDER_IDENTIFIER_LENGTH)) {
      throw new Error(`${label} is invalid or too long.`)
    }
  }

  if (!requireComplete) return
  if (!raw.provider) throw new Error('Select an SMS provider before enabling SMS delivery.')
  if (!raw.fromNumber) throw new Error('Enter an SMS sender before enabling SMS delivery.')
  if (raw.provider === 'twilio' && !raw.twilioAccountSid) {
    throw new Error('Enter the Twilio account SID before enabling SMS delivery.')
  }
  if (raw.provider === 'vonage' && !raw.vonageApiKey) {
    throw new Error('Enter the Vonage API key before enabling SMS delivery.')
  }
  if (raw.provider === 'plivo' && !raw.plivoAuthId) {
    throw new Error('Enter the Plivo auth ID before enabling SMS delivery.')
  }
  if ('secret' in raw && !raw.secret?.trim()) {
    throw new Error("Enter this provider's credential before enabling SMS delivery.")
  }
}

/** Validate a persisted SMS provider before save or runtime resolution. */
export function validateStoredSmsConfig(
  raw: RawSmsConfig | PlatformSmsConfig,
  options: { requireComplete?: boolean } = {},
): void {
  if ('mode' in raw && raw.mode !== undefined && !isSmsPolicyMode(raw.mode)) {
    throw new Error('Select a valid platform SMS policy.')
  }
  const requireComplete = options.requireComplete ?? raw.enabled === true
  validateSmsConfigFields(raw, requireComplete)

  const hasCiphertext = Boolean(raw.keyCiphertext?.trim())
  const hasNonce = Boolean(raw.keyNonce?.trim())
  if (hasCiphertext !== hasNonce) {
    throw new Error('The stored SMS credential is incomplete; replace it before enabling SMS.')
  }
  if (
    (raw.keyCiphertext && raw.keyCiphertext.length > MAX_SEALED_SECRET_LENGTH) ||
    (raw.keyNonce && raw.keyNonce.length > MAX_SEALED_SECRET_LENGTH)
  ) {
    throw new Error('The stored SMS credential is invalid; replace it before enabling SMS.')
  }
  if (requireComplete && raw.enabled !== true) {
    throw new Error('Enable SMS delivery before selecting a live SMS policy.')
  }
  if (requireComplete && !(hasCiphertext && hasNonce)) {
    throw new Error("Enter this provider's credential before enabling SMS delivery.")
  }
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
  try {
    validateSmsConfigFields(c, true)
  } catch {
    return null
  }
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
  if (!raw || !raw.provider || raw.enabled !== true) return null
  try {
    validateStoredSmsConfig(raw, { requireComplete: true })
  } catch {
    return null
  }
  let secret: string | undefined
  if (raw.keyCiphertext && raw.keyNonce) {
    secret = unsealSecret({ ciphertext: raw.keyCiphertext, nonce: raw.keyNonce }) ?? undefined
  }
  return buildSmsTransport({ ...raw, secret })
}

/** What the worker should do for a given send. */
export type EffectiveSms =
  | { kind: 'suppressed' }
  | { kind: 'transport'; transport: SmsTransport; source: 'tenant' | 'platform' }
  | { kind: 'unconfigured' }

/**
 * The platform → tenant → env resolution policy, as a pure function so it can be
 * unit-tested without a database. The worker reads the two stored configs and
 * calls this; `tenantScoped` is false for platform sends so a tenant's provider
 * is never used to send a non-tenant message.
 *
 *   mode 'disabled'        → suppressed (kill switch; do not send, do not retry)
 *   mode 'global_only'     → platform provider, else configuration error
 *   mode 'tenant_optional' → tenant provider (if scoped + configured),
 *                            else platform provider, else configuration error
 */
export function resolveEffectiveSmsTransport(
  platform: PlatformSmsConfig | null | undefined,
  tenant: RawSmsConfig | null | undefined,
  opts: { tenantScoped: boolean },
): EffectiveSms {
  const rawMode: unknown = platform?.mode
  if (rawMode !== undefined && !isSmsPolicyMode(rawMode)) return { kind: 'unconfigured' }
  const mode: SmsPolicyMode = rawMode ?? 'tenant_optional'
  if (mode === 'disabled') return { kind: 'suppressed' }

  const platformTransport = resolveSmsTransport(platform ?? null)
  if (mode === 'global_only') {
    return platformTransport
      ? { kind: 'transport', transport: platformTransport, source: 'platform' }
      : { kind: 'unconfigured' }
  }

  // tenant_optional
  if (opts.tenantScoped && tenant?.enabled === true) {
    const tenantTransport = resolveSmsTransport(tenant ?? null)
    if (tenantTransport) return { kind: 'transport', transport: tenantTransport, source: 'tenant' }
    // An explicitly enabled tenant override must not silently fail over to a
    // different sender/provider when its credential becomes corrupt.
    return { kind: 'unconfigured' }
  }
  if (platformTransport)
    return { kind: 'transport', transport: platformTransport, source: 'platform' }
  return { kind: 'unconfigured' }
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

function sanitizedText(value: string, redactions: readonly string[]): string {
  let printable = value.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  for (const sensitiveValue of [...redactions]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    printable = printable.split(sensitiveValue).join('[redacted]')
  }
  return printable.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function errText(body: unknown, status: number, redactions: readonly string[]): string {
  if (typeof body === 'string' && body) return sanitizedText(body, redactions)
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const message = record.message ?? record.error ?? record.Message ?? record.detail
    if (typeof message === 'string') return sanitizedText(message, redactions)
    if (Array.isArray(record.errors)) {
      const details = record.errors
        .map((item) => {
          if (!item || typeof item !== 'object') return ''
          const error = item as Record<string, unknown>
          const detail = error.detail ?? error.title ?? error.description ?? error.message
          return typeof detail === 'string' ? detail : ''
        })
        .filter(Boolean)
      if (details.length > 0) return sanitizedText(details.join('; '), redactions)
    }
  }
  return `HTTP ${status}`
}

/** Strip a single leading + — providers that want a bare international number. */
function stripPlus(n: string): string {
  return n.startsWith('+') ? n.slice(1) : n
}

function validateSendInput(input: SendSmsInput, from: string): void {
  if (!isValidSmsDestination(input.to)) {
    throw new Error('SMS recipient must be a valid E.164 phone number.')
  }
  if (!input.body.trim() || input.body.length > MAX_SMS_BODY_CHARS) {
    throw new Error(`SMS body must contain 1 to ${MAX_SMS_BODY_CHARS} characters.`)
  }
  if (!from || from.length > 100 || /[\u0000-\u001f\u007f]/.test(from)) {
    throw new Error('SMS sender is invalid or too long.')
  }
}

async function requestJson(
  url: string,
  options: {
    headers: Record<string, string>
    body: string | URLSearchParams
  },
): Promise<{ response: Response; body: unknown }> {
  const response = await secureFetch(url, {
    method: 'POST',
    headers: options.headers,
    body: options.body,
    timeoutMs: SMS_TIMEOUT_MS,
    maxRequestBytes: MAX_SMS_REQUEST_BYTES,
    maxResponseBytes: MAX_SMS_RESPONSE_BYTES,
    maxRedirects: 0,
  })
  const text = await response.text()
  if (!text) return { response, body: null }
  try {
    return { response, body: JSON.parse(text) as unknown }
  } catch {
    return { response, body: text }
  }
}

function responseRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

function requiredProviderId(value: unknown, provider: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${provider}: provider returned success without a message id`)
  }
  return value
}

/** Send an SMS through a resolved transport. Throws on provider error. */
export async function sendSmsVia(
  transport: SmsTransport,
  input: SendSmsInput,
): Promise<{ id: string }> {
  const from = input.from?.trim() || transport.from
  validateSendInput(input, from)
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
  const { response, body } = await requestJson(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Messages.json`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    },
  )
  const json = responseRecord(body)
  if (!response.ok) throw new Error(`Twilio: ${errText(body, response.status, [t.authToken])}`)
  return { id: requiredProviderId(json?.sid, 'Twilio') }
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
  const { response, body } = await requestJson('https://rest.nexmo.com/sms/json', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: params,
  })
  const json = responseRecord(body) as {
    messages?: { status?: string; 'message-id'?: string; 'error-text'?: string }[]
  } | null
  const msg = json?.messages?.[0]
  // Vonage returns HTTP 200 even for per-message failures — status '0' is success.
  if (!response.ok || !msg || msg.status !== '0') {
    const detail = msg?.['error-text']
      ? sanitizedText(msg['error-text'], [t.apiKey, t.apiSecret])
      : errText(body, response.status, [t.apiKey, t.apiSecret])
    throw new Error(`Vonage: ${detail}`)
  }
  return { id: requiredProviderId(msg['message-id'], 'Vonage') }
}

async function sendMessagebird(
  t: Extract<SmsTransport, { provider: 'messagebird' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const { response, body } = await requestJson('https://rest.messagebird.com/messages', {
    headers: { Authorization: `AccessKey ${t.accessKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [input.to], originator: from, body: input.body }),
  })
  const json = responseRecord(body) as {
    id?: string
    errors?: { description?: string }[]
  } | null
  if (!response.ok || json?.errors?.length) {
    throw new Error(
      `MessageBird: ${json?.errors?.[0]?.description ? sanitizedText(json.errors[0].description!, [t.accessKey]) : errText(body, response.status, [t.accessKey])}`,
    )
  }
  return { id: requiredProviderId(json?.id, 'MessageBird') }
}

async function sendPlivo(
  t: Extract<SmsTransport, { provider: 'plivo' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const { response, body } = await requestJson(
    `https://api.plivo.com/v1/Account/${encodeURIComponent(t.authId)}/Message/`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.authId}:${t.authToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ src: from, dst: input.to, text: input.body }),
    },
  )
  const json = responseRecord(body) as { message_uuid?: string[]; error?: string } | null
  if (!response.ok || json?.error)
    throw new Error(
      `Plivo: ${json?.error ? sanitizedText(json.error, [t.authToken]) : errText(body, response.status, [t.authToken])}`,
    )
  return { id: requiredProviderId(json?.message_uuid?.[0], 'Plivo') }
}

async function sendTelnyx(
  t: Extract<SmsTransport, { provider: 'telnyx' }>,
  input: SendSmsInput,
  from: string,
): Promise<{ id: string }> {
  const { response, body } = await requestJson('https://api.telnyx.com/v2/messages', {
    headers: { Authorization: `Bearer ${t.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: input.to,
      text: input.body,
      messaging_profile_id: t.messagingProfileId,
    }),
  })
  const json = responseRecord(body) as {
    data?: { id?: string }
    errors?: { detail?: string; title?: string }[]
  } | null
  if (!response.ok || json?.errors?.length) {
    const e = json?.errors?.[0]
    const detail = e?.detail ?? e?.title
    throw new Error(
      `Telnyx: ${detail ? sanitizedText(detail, [t.apiKey]) : errText(body, response.status, [t.apiKey])}`,
    )
  }
  return { id: requiredProviderId(json?.data?.id, 'Telnyx') }
}
