import { Queue, type JobsOptions } from 'bullmq'
import { getConnection } from '../connection'
import { assertUuid } from '../validation'

/** Generate (and deliver, when scheduled) one AI brief run. */
export type AiJobData = {
  kind: 'brief_run'
  tenantId: string
  runId: string
}

let aiQueue: Queue<AiJobData> | undefined

export function assertAiJobData(data: AiJobData): void {
  if (!data || typeof data !== 'object' || data.kind !== 'brief_run') {
    throw new Error('AI job kind is invalid.')
  }
  assertUuid(data.tenantId, 'AI job tenantId')
  assertUuid(data.runId, 'AI job runId')
}

function getAiQueue(): Queue<AiJobData> {
  aiQueue ??= new Queue<AiJobData>('ai', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
  return aiQueue
}

/** Queue a brief run. The job id is the run id, so re-publishing is idempotent. */
export async function enqueueAiJob(data: AiJobData, options?: JobsOptions) {
  assertAiJobData(data)
  return getAiQueue().add(data.kind, data, {
    jobId: `brief-run|${data.runId}`,
    ...options,
  })
}
