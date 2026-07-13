import { Queue } from 'bullmq'
import { getConnection } from '../connection'

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
  return getOutboundQueue().add('dispatch', data, jobId ? { jobId } : undefined)
}
