import { Queue } from 'bullmq'
import { connection } from '../connection'

// Scheduled-report run queue. Producer is the scheduler tick (every 5 min);
// consumer lives in apps/worker/src/workers/reports.ts.

export type ReportRunJobData = {
  tenantId: string
  scheduleId: string
}

export const reportsQueue = new Queue<ReportRunJobData>('reports', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
})

export async function enqueueReportRun(data: ReportRunJobData) {
  await reportsQueue.add('run', data)
}
