import { Queue } from 'bullmq'
import { getConnection } from '../connection'
import {
  assertIdentifier,
  assertJsonBytes,
  assertQueueJobId,
  assertString,
  assertUuid,
} from '../validation'

// One job per (automation, event): the worker delivers that single automation
// and retries it in isolation, so one failing destination never re-fires the
// others. The event payload is self-contained (resolved items) so the worker
// never re-queries the source entity.
export type OutboundEvent = {
  type: string
  tenantId: string
  subjectId: string
  items: Array<Record<string, string | number | boolean | null>>
}
export type OutboundDispatchJob = {
  tenantId: string
  automationId: string
  event: OutboundEvent
}

let outboundQueue: Queue<OutboundDispatchJob> | undefined

export function assertOutboundDispatchJob(data: OutboundDispatchJob): void {
  assertUuid(data.tenantId, 'Outbound tenantId')
  assertUuid(data.automationId, 'Outbound automationId')
  if (!data.event || data.event.tenantId !== data.tenantId) {
    throw new Error('Outbound event identity does not match its dispatch tenant.')
  }
  assertIdentifier(data.event.type, 'Outbound event type', 200)
  assertString(data.event.subjectId, 'Outbound subjectId', { min: 1, max: 200 })
  if (!Array.isArray(data.event.items) || data.event.items.length > 5_000) {
    throw new Error('Outbound event items exceed the 5000 item limit.')
  }
  for (const item of data.event.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Outbound event items must be flat records.')
    }
    const entries = Object.entries(item)
    if (entries.length > 500) throw new Error('Outbound event item exceeds the 500-field limit.')
    for (const [key, value] of entries) {
      assertString(key, 'Outbound event item key', { min: 1, max: 200 })
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new Error('Outbound event item values must be scalar JSON values.')
      }
      if (typeof value === 'string' && value.length > 100_000) {
        throw new Error('Outbound event item string exceeds 100000 characters.')
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error('Outbound event item numbers must be finite.')
      }
    }
  }
  assertJsonBytes(data.event.items, 'Outbound event items', 1_024 * 1_024)
}

function getOutboundQueue(): Queue<OutboundDispatchJob> {
  outboundQueue ??= new Queue<OutboundDispatchJob>('outbound', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  })
  return outboundQueue
}

export async function enqueueOutboundDispatch(data: OutboundDispatchJob, jobId?: string) {
  assertOutboundDispatchJob(data)
  assertQueueJobId(jobId, 'Outbound jobId')
  return getOutboundQueue().add('dispatch', data, jobId ? { jobId } : undefined)
}
