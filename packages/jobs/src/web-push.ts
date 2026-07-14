import webpush from 'web-push'
import {
  resolvePublicHost,
  secureFetch,
  validateOutboundRequestConfiguration,
} from '@beaconhs/sync/egress'

const MAX_ENDPOINT_LENGTH = 2_048
const MAX_PUSH_PAYLOAD_BYTES = 3_072
const MAX_PUSH_RESPONSE_BYTES = 16 * 1_024
const PUSH_TIMEOUT_MS = 15_000

export type WebPushSubscriptionInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type WebPushPayload = {
  title: string
  body?: string
  linkPath?: string
}

export type WebPushVapidDetails = {
  subject: string
  publicKey: string
  privateKey: string
}

function decodeBase64Url(value: string, label: string, expectedBytes: number): string {
  const normalized = value.trim().replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(`${label} is not valid base64url data.`)
  }
  const decoded = Buffer.from(normalized, 'base64url')
  if (decoded.length !== expectedBytes || decoded.toString('base64url') !== normalized) {
    throw new Error(`${label} has an invalid length or encoding.`)
  }
  return normalized
}

export function validateWebPushEndpoint(endpoint: string): string {
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    throw new Error('Web Push endpoint is missing or too long.')
  }
  return validateOutboundRequestConfiguration(endpoint).url.href
}

export function validateWebPushSubscription(
  input: WebPushSubscriptionInput,
): WebPushSubscriptionInput {
  const endpoint = validateWebPushEndpoint(input.endpoint)
  const p256dh = decodeBase64Url(input.keys.p256dh, 'Web Push p256dh key', 65)
  const publicKey = Buffer.from(p256dh, 'base64url')
  if (publicKey[0] !== 4) throw new Error('Web Push p256dh key is not an uncompressed P-256 key.')
  const auth = decodeBase64Url(input.keys.auth, 'Web Push auth secret', 16)
  return { endpoint, keys: { p256dh, auth } }
}

/**
 * Persistence-time validation. Runtime delivery repeats the same DNS policy
 * immediately before opening its pinned socket, closing DNS-rebinding races.
 */
export async function validateWebPushSubscriptionForPersistence(
  input: WebPushSubscriptionInput,
): Promise<WebPushSubscriptionInput> {
  const validated = validateWebPushSubscription(input)
  await resolvePublicHost(new URL(validated.endpoint).hostname, { timeoutMs: 5_000 })
  return validated
}

function truncateJsonString(value: string, maxEncodedBytes: number): string {
  const points = [...value]
  let low = 0
  let high = points.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = points.slice(0, mid).join('')
    if (Buffer.byteLength(JSON.stringify(candidate)) <= maxEncodedBytes) low = mid
    else high = mid - 1
  }
  if (low === points.length) return value
  const ellipsis = '…'
  while (
    low > 0 &&
    Buffer.byteLength(JSON.stringify(`${points.slice(0, low).join('')}${ellipsis}`)) >
      maxEncodedBytes
  ) {
    low -= 1
  }
  return `${points.slice(0, low).join('')}${ellipsis}`
}

export function buildWebPushPayload(input: WebPushPayload): string {
  const title = truncateJsonString(input.title, 512)
  const linkPath = input.linkPath ? truncateJsonString(input.linkPath, 1_024) : undefined
  const base = { title, ...(linkPath ? { linkPath } : {}) }
  if (!input.body) return JSON.stringify(base)

  const bodyPoints = [...input.body]
  let low = 0
  let high = bodyPoints.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = JSON.stringify({
      ...base,
      body: `${bodyPoints.slice(0, mid).join('')}${mid < bodyPoints.length ? '…' : ''}`,
    })
    if (Buffer.byteLength(candidate) <= MAX_PUSH_PAYLOAD_BYTES) low = mid
    else high = mid - 1
  }
  const body = `${bodyPoints.slice(0, low).join('')}${low < bodyPoints.length ? '…' : ''}`
  const payload = JSON.stringify({ ...base, body })
  if (Buffer.byteLength(payload) > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error('Web Push payload could not be reduced to the delivery limit.')
  }
  return payload
}

function requestHeaders(headers: webpush.Headers): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    // secureFetch computes this from the encrypted body and forbids callers
    // from supplying a conflicting length.
    if (name.toLowerCase() === 'content-length') continue
    normalized[name] = String(value)
  }
  return normalized
}

export async function sendWebPushNotification(input: {
  subscription: WebPushSubscriptionInput
  payload: WebPushPayload
  vapid: WebPushVapidDetails
}): Promise<void> {
  const subscription = validateWebPushSubscription(input.subscription)
  const payload = buildWebPushPayload(input.payload)
  const request = webpush.generateRequestDetails(subscription, payload, {
    TTL: 5 * 60,
    urgency: 'normal',
    contentEncoding: 'aes128gcm',
    vapidDetails: input.vapid,
  })
  const response = await secureFetch(request.endpoint, {
    method: 'POST',
    headers: requestHeaders(request.headers),
    body: request.body ?? null,
    timeoutMs: PUSH_TIMEOUT_MS,
    maxRequestBytes: 16 * 1_024,
    maxResponseBytes: MAX_PUSH_RESPONSE_BYTES,
    maxRedirects: 0,
  })
  if (response.ok) return
  const detail = (await response.text()).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300)
  const error = new Error(
    `Web Push provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
  ) as Error & { statusCode?: number }
  error.statusCode = response.status
  throw error
}
