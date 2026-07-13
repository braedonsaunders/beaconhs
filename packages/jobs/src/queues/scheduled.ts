import { Queue, type JobsOptions } from 'bullmq'
import { getConnection } from '../connection'

// Generic "tick" queue for scheduled work that fires on a cron. The
// scheduler process registers repeatable jobs; worker process consumes them.

export type ScheduledTick =
  | { kind: 'form_assignment_scan' }
  | { kind: 'form_session_overdue_scan' }
  | { kind: 'report_schedule_scan' }
  | { kind: 'compliance_scan' }
  | { kind: 'escalation_scan' }
  | { kind: 'digest_scan' }
  | { kind: 'scheduled_flow_scan' }
  | { kind: 'sync_scan' }
  | { kind: 'sync_run'; tenantId: string; connectionId: string; trigger: 'scheduled' | 'manual' }
  | { kind: 'db_maintenance'; trigger?: 'scheduled' | 'manual' }
  | { kind: 'domain_event_outbox_scan' }

let scheduledQueue: Queue<ScheduledTick> | undefined

function getScheduledQueue(): Queue<ScheduledTick> {
  scheduledQueue ??= new Queue<ScheduledTick>('scheduled', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
  return scheduledQueue
}

export async function enqueueScheduled(name: string, data: ScheduledTick, options?: JobsOptions) {
  return getScheduledQueue().add(name, data, options)
}

const SCHEDULES: Array<{
  name: string
  data: ScheduledTick
  pattern: string
  jobId: string
}> = [
  {
    name: 'tick:every_minute',
    data: { kind: 'form_assignment_scan' },
    pattern: '* * * * *',
    jobId: 'tick:form_assignment_scan',
  },
  {
    name: 'tick:form_session',
    data: { kind: 'form_session_overdue_scan' },
    pattern: '* * * * *',
    jobId: 'tick:form_session_overdue',
  },
  {
    name: 'tick:reports',
    data: { kind: 'report_schedule_scan' },
    pattern: '*/5 * * * *',
    jobId: 'tick:reports',
  },
  {
    name: 'tick:compliance_scan',
    data: { kind: 'compliance_scan' },
    pattern: '* * * * *',
    jobId: 'tick:compliance_scan',
  },
  {
    name: 'tick:escalation',
    data: { kind: 'escalation_scan' },
    pattern: '30 6 * * *',
    jobId: 'tick:escalation',
  },
  {
    name: 'tick:digest',
    data: { kind: 'digest_scan' },
    pattern: '5 * * * *',
    jobId: 'tick:digest',
  },
  {
    name: 'tick:scheduled_flow',
    data: { kind: 'scheduled_flow_scan' },
    pattern: '* * * * *',
    jobId: 'tick:scheduled_flow',
  },
  {
    name: 'tick:sync_scan',
    data: { kind: 'sync_scan' },
    pattern: '*/15 * * * *',
    jobId: 'tick:sync_scan',
  },
  {
    name: 'tick:db_maintenance',
    data: { kind: 'db_maintenance', trigger: 'scheduled' },
    pattern: '30 3 * * *',
    jobId: 'tick:db_maintenance',
  },
  {
    name: 'tick:domain_event_outbox',
    data: { kind: 'domain_event_outbox_scan' },
    pattern: '* * * * *',
    jobId: 'tick:domain_event_outbox',
  },
]

async function removeUnconfiguredSchedules() {
  const scheduledQueue = getScheduledQueue()
  const repeatables = await scheduledQueue.getRepeatableJobs()
  await Promise.all(
    repeatables
      .filter((job) =>
        SCHEDULES.every(
          (expected) => job.name !== expected.name || job.pattern !== expected.pattern,
        ),
      )
      .map((job) => scheduledQueue.removeRepeatableByKey(job.key)),
  )
}

export async function registerSchedules() {
  // Reconcile Redis to this exact registry. Pattern/name changes replace their
  // old repeat key instead of leaving shadow schedules firing indefinitely.
  await removeUnconfiguredSchedules()
  for (const schedule of SCHEDULES) {
    await enqueueScheduled(schedule.name, schedule.data, {
      repeat: { pattern: schedule.pattern },
      jobId: schedule.jobId,
    })
  }
}
