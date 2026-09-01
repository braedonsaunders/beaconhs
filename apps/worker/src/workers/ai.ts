import type { Job } from 'bullmq'
import { assertAiJobData, type AiJobData } from '@beaconhs/jobs'
import { runJournalAnalysisJob } from '../lib/journal-analysis'

export async function processAiJob(job: Job<AiJobData>): Promise<void> {
  assertAiJobData(job.data)
  await runJournalAnalysisJob(job.data.tenantId, job.data.days)
}
