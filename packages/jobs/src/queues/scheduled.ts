import { Queue } from 'bullmq'
import { connection } from '../connection'

// Generic "tick" queue for scheduled work that fires on a cron. The
// scheduler process registers repeatable jobs; worker process consumes them.

export type ScheduledTick =
  | { kind: 'form_assignment_scan' }
  | { kind: 'form_session_overdue_scan' }
  | { kind: 'report_schedule_scan' }
  | { kind: 'report_run'; tenantId: string; scheduleId: string }
  | { kind: 'compliance_scan' }
  | { kind: 'escalation_scan' }
  | { kind: 'digest_scan' }
  | { kind: 'scheduled_flow_scan' }
  | { kind: 'plugin_cron'; cadence: 'hourly' | 'daily' | 'weekly' }
  | { kind: 'sync_scan' }
  | { kind: 'sync_run'; tenantId: string; connectionId: string; trigger: 'scheduled' | 'manual' }

export const scheduledQueue = new Queue<ScheduledTick>('scheduled', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
})

export async function registerSchedules() {
  // Every minute: form assignment dispatch
  await scheduledQueue.add('tick:every_minute', { kind: 'form_assignment_scan' } as ScheduledTick, {
    repeat: { pattern: '* * * * *' },
    jobId: 'tick:form_assignment_scan',
  })
  // Every minute: generic monitored-session overdue scan — escalates overdue
  // check-ins for the Lone Worker app + any monitored Builder app. (Successor to
  // the retired native lone_worker_overdue_scan.) See docs/monitored-sessions-design.md.
  await scheduledQueue.add(
    'tick:form_session',
    { kind: 'form_session_overdue_scan' } as ScheduledTick,
    { repeat: { pattern: '* * * * *' }, jobId: 'tick:form_session_overdue' },
  )
  // Every 5 minutes: report scheduler scan
  await scheduledQueue.add('tick:reports', { kind: 'report_schedule_scan' } as ScheduledTick, {
    repeat: { pattern: '*/5 * * * *' },
    jobId: 'tick:reports',
  })
  // Daily 06:00: re-materialise every obligation's compliance_status + reminders.
  // (Create/update materialise instantly on the write path; this is the refresh.)
  await scheduledQueue.add('tick:compliance_scan', { kind: 'compliance_scan' } as ScheduledTick, {
    repeat: { pattern: '0 6 * * *' },
    jobId: 'tick:compliance_scan',
  })
  // Daily 06:30: escalation ladder — re-alert higher roles for items that have
  // stayed overdue past each ladder step (runs after the compliance scan).
  await scheduledQueue.add('tick:escalation', { kind: 'escalation_scan' } as ScheduledTick, {
    repeat: { pattern: '30 6 * * *' },
    jobId: 'tick:escalation',
  })
  // Hourly: digest dispatch — self-gates to each tenant's configured digest hour.
  await scheduledQueue.add('tick:digest', { kind: 'digest_scan' } as ScheduledTick, {
    repeat: { pattern: '5 * * * *' },
    jobId: 'tick:digest',
  })
  // Every minute: run flows whose `scheduled` cron matches this minute (Phase 4).
  await scheduledQueue.add('tick:scheduled_flow', { kind: 'scheduled_flow_scan' } as ScheduledTick, {
    repeat: { pattern: '* * * * *' },
    jobId: 'tick:scheduled_flow',
  })
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
  // Every 15 minutes: scan external sync connections and enqueue the ones due.
  await scheduledQueue.add('tick:sync_scan', { kind: 'sync_scan' } as ScheduledTick, {
    repeat: { pattern: '*/15 * * * *' },
    jobId: 'tick:sync_scan',
  })
}
