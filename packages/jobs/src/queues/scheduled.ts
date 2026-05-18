import { Queue } from 'bullmq'
import { connection } from '../connection'

// Generic "tick" queue for scheduled work that fires on a cron. The
// scheduler process registers repeatable jobs; worker process consumes them.

export type ScheduledTick =
  | { kind: 'cert_expiry_scan' }
  | { kind: 'form_assignment_scan' }
  | { kind: 'document_review_scan' }
  | { kind: 'cs_permit_expiry_scan' }
  | { kind: 'lone_worker_overdue_scan' }
  | { kind: 'report_schedule_scan' }
  | { kind: 'plugin_cron'; cadence: 'hourly' | 'daily' | 'weekly' }

export const scheduledQueue = new Queue<ScheduledTick>('scheduled', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
})

export async function registerSchedules() {
  // Every minute: form assignment dispatch + lone-worker overdue scan
  await scheduledQueue.add(
    'tick:every_minute',
    { kind: 'form_assignment_scan' } as ScheduledTick,
    { repeat: { pattern: '* * * * *' }, jobId: 'tick:form_assignment_scan' },
  )
  await scheduledQueue.add(
    'tick:lone_worker',
    { kind: 'lone_worker_overdue_scan' } as ScheduledTick,
    { repeat: { pattern: '* * * * *' }, jobId: 'tick:lone_worker_overdue' },
  )
  // Every 5 minutes: report scheduler scan
  await scheduledQueue.add(
    'tick:reports',
    { kind: 'report_schedule_scan' } as ScheduledTick,
    { repeat: { pattern: '*/5 * * * *' }, jobId: 'tick:reports' },
  )
  // Hourly: confined-space permit expiry
  await scheduledQueue.add(
    'tick:cs_permits',
    { kind: 'cs_permit_expiry_scan' } as ScheduledTick,
    { repeat: { pattern: '0 * * * *' }, jobId: 'tick:cs_permits' },
  )
  // Daily 07:00 local: cert expiry reminders + document review reminders + daily plugins
  await scheduledQueue.add(
    'tick:cert_expiry',
    { kind: 'cert_expiry_scan' } as ScheduledTick,
    { repeat: { pattern: '0 7 * * *' }, jobId: 'tick:cert_expiry' },
  )
  await scheduledQueue.add(
    'tick:doc_review',
    { kind: 'document_review_scan' } as ScheduledTick,
    { repeat: { pattern: '15 7 * * *' }, jobId: 'tick:doc_review' },
  )
  await scheduledQueue.add(
    'tick:plugin_hourly',
    { kind: 'plugin_cron', cadence: 'hourly' } as ScheduledTick,
    { repeat: { pattern: '30 * * * *' }, jobId: 'tick:plugin_hourly' },
  )
  await scheduledQueue.add(
    'tick:plugin_daily',
    { kind: 'plugin_cron', cadence: 'daily' } as ScheduledTick,
    { repeat: { pattern: '30 7 * * *' }, jobId: 'tick:plugin_daily' },
  )
  await scheduledQueue.add(
    'tick:plugin_weekly',
    { kind: 'plugin_cron', cadence: 'weekly' } as ScheduledTick,
    { repeat: { pattern: '30 7 * * 1' }, jobId: 'tick:plugin_weekly' },
  )
}
