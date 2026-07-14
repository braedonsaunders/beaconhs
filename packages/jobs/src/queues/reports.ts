import { Queue } from 'bullmq'
import { getConnection } from '../connection'
import { assertUuid } from '../validation'

// Scheduled-report run queue. Producer is the scheduler tick (every 5 min);
// consumer lives in apps/worker/src/workers/reports.ts.

export type ReportRunJobData = {
  tenantId: string
  scheduleId: string
  runId: string
}

let reportsQueue: Queue<ReportRunJobData> | undefined

export function assertReportRunJobData(data: ReportRunJobData): void {
  assertUuid(data.tenantId, 'Report tenantId')
  assertUuid(data.scheduleId, 'Report scheduleId')
  assertUuid(data.runId, 'Report runId')
}

function getReportsQueue(): Queue<ReportRunJobData> {
  reportsQueue ??= new Queue<ReportRunJobData>('reports', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  })
  return reportsQueue
}

export async function enqueueReportRun(data: ReportRunJobData) {
  assertReportRunJobData(data)
  return getReportsQueue().add('run', data, { jobId: `report-run|${data.runId}` })
}
