import { signDomainEventRequest } from '@beaconhs/events'

function webBaseUrl(): string {
  const value = process.env.INTERNAL_WEB_URL ?? process.env.APP_URL ?? process.env.PUBLIC_APP_URL
  if (!value) throw new Error('INTERNAL_WEB_URL or APP_URL is required for web domain commands')
  return value.replace(/\/$/, '')
}

export async function dispatchDomainEventWebCommand(eventId: string): Promise<void> {
  const timestamp = String(Date.now())
  const response = await fetch(`${webBaseUrl()}/api/internal/domain-events/${eventId}`, {
    method: 'POST',
    headers: {
      'x-beaconhs-event-timestamp': timestamp,
      'x-beaconhs-event-signature': signDomainEventRequest(eventId, timestamp),
    },
    signal: AbortSignal.timeout(120_000),
  })
  if (response.ok) return
  const detail = (await response.text()).slice(0, 500)
  throw new Error(`Web domain command failed (${response.status}): ${detail}`)
}
