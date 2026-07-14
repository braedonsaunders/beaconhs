import { signDomainEventRequest } from '@beaconhs/events'

const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ERROR_BYTES = 2_048

function webBaseUrl(): URL {
  const value = process.env.INTERNAL_WEB_URL ?? process.env.APP_URL ?? process.env.PUBLIC_APP_URL
  if (!value) throw new Error('INTERNAL_WEB_URL or APP_URL is required for web domain commands')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Internal web URL is invalid')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Internal web URL must be an HTTP(S) origin without credentials or query data')
  }
  return new URL('/', url)
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = MAX_ERROR_BYTES - bytes
      if (remaining <= 0) {
        await reader.cancel()
        break
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(chunk)
      bytes += chunk.byteLength
      if (value.byteLength > remaining || bytes === MAX_ERROR_BYTES) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder()
    .decode(merged)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, 500)
}

export async function dispatchDomainEventWebCommand(eventId: string): Promise<void> {
  if (!EVENT_ID_PATTERN.test(eventId)) throw new Error('Domain event id must be a UUID')
  const timestamp = String(Date.now())
  const endpoint = new URL(`/api/internal/domain-events/${eventId}`, webBaseUrl())
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'x-beaconhs-event-timestamp': timestamp,
      'x-beaconhs-event-signature': signDomainEventRequest(eventId, timestamp),
    },
    signal: AbortSignal.timeout(120_000),
  })
  if (response.ok) return
  const detail = await boundedResponseText(response)
  throw new Error(`Web domain command failed (${response.status}): ${detail}`)
}
