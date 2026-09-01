import { Queue, type JobsOptions } from 'bullmq'
import { getConnection } from '../connection'
import { assertUuid } from '../validation'

export const JOURNAL_ANALYSIS_PERIODS = [7, 30, 90] as const
export type JournalAnalysisPeriod = (typeof JOURNAL_ANALYSIS_PERIODS)[number]

export type AiJobData = {
  kind: 'journal_analysis_run'
  tenantId: string
  days: JournalAnalysisPeriod
}

let aiQueue: Queue<AiJobData> | undefined

export function isJournalAnalysisPeriod(value: number): value is JournalAnalysisPeriod {
  return (JOURNAL_ANALYSIS_PERIODS as readonly number[]).includes(value)
}

export function assertAiJobData(data: AiJobData): void {
  if (!data || typeof data !== 'object' || data.kind !== 'journal_analysis_run') {
    throw new Error('AI job kind is invalid.')
  }
  assertUuid(data.tenantId, 'AI job tenantId')
  if (!isJournalAnalysisPeriod(data.days)) {
    throw new Error('AI journal analysis period must be 7, 30, or 90 days.')
  }
}

function getAiQueue(): Queue<AiJobData> {
  aiQueue ??= new Queue<AiJobData>('ai', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
  return aiQueue
}

export async function enqueueAiJob(data: AiJobData, options?: JobsOptions) {
  assertAiJobData(data)
  return getAiQueue().add(data.kind, data, {
    jobId: `journal-analysis|${data.tenantId}|${data.days}`,
    removeOnComplete: true,
    removeOnFail: true,
    ...options,
  })
}
