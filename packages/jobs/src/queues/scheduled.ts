import { Queue, type JobsOptions } from 'bullmq'
import { getConnection } from '../connection'
import { assertUuid } from '../validation'

// Generic "tick" queue for scheduled work that fires on a cron. The
// scheduler process registers repeatable jobs; worker process consumes them.

export type ScheduledTick =
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
  | { kind: 'storage_object_deletion_scan' }
  | { kind: 'office_render_reconcile' }

let scheduledQueue: Queue<ScheduledTick> | undefined

const SCHEDULED_KINDS = new Set<ScheduledTick['kind']>([
  'form_session_overdue_scan',
  'report_schedule_scan',
  'compliance_scan',
  'escalation_scan',
  'digest_scan',
  'scheduled_flow_scan',
  'sync_scan',
  'sync_run',
  'db_maintenance',
  'domain_event_outbox_scan',
  'storage_object_deletion_scan',
  'office_render_reconcile',
])

export function assertScheduledTick(data: ScheduledTick): void {
  if (!data || typeof data !== 'object' || !SCHEDULED_KINDS.has(data.kind)) {
    throw new Error('Scheduled job kind is invalid.')
  }
  if (data.kind === 'sync_run') {
    assertUuid(data.tenantId, 'Sync tenantId')
    assertUuid(data.connectionId, 'Sync connectionId')
    if (data.trigger !== 'scheduled' && data.trigger !== 'manual') {
      throw new Error('Sync trigger is invalid.')
    }
  } else if (data.kind === 'db_maintenance') {
    if (data.trigger !== undefined && data.trigger !== 'scheduled' && data.trigger !== 'manual') {
      throw new Error('Database maintenance trigger is invalid.')
    }
  }
}

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

function omitJobId(options?: JobsOptions): JobsOptions {
  if (!options) return {}
  const normalized = { ...options }
  delete normalized.jobId
  return normalized
}

export async function enqueueScheduled(name: string, data: ScheduledTick, options?: JobsOptions) {
  if (!name || name.length > 100) throw new Error('Scheduled job name is invalid.')
  assertScheduledTick(data)
  const normalizedOptions =
    data.kind === 'sync_run'
      ? {
          ...options,
          // A manual click and the cadence scanner share this identity. Only
          // one run per connection may be queued or active, otherwise cursor
          // updates can race and move the connection backwards.
          jobId: `sync-run|${data.tenantId}|${data.connectionId}`,
          removeOnComplete: true,
          removeOnFail: true,
        }
      : data.kind === 'db_maintenance'
        ? {
            ...omitJobId(options),
            // A repeat occurrence and a platform "run now" click must never
            // execute retention deletes/ANALYZE concurrently.
            deduplication: { id: 'db-maintenance' },
          }
        : options
  return getScheduledQueue().add(name, data, normalizedOptions)
}

const SCHEDULES: Array<{
  name: string
  data: ScheduledTick
  pattern: string
  jobId: string
  repeatKey: string
}> = [
  {
    name: 'tick:form_session',
    data: { kind: 'form_session_overdue_scan' },
    pattern: '* * * * *',
    jobId: 'tick:form_session_overdue',
    repeatKey: 'tick-form-session-overdue',
  },
  {
    name: 'tick:reports',
    data: { kind: 'report_schedule_scan' },
    pattern: '*/5 * * * *',
    jobId: 'tick:reports',
    repeatKey: 'tick-reports',
  },
  {
    name: 'tick:compliance_scan',
    data: { kind: 'compliance_scan' },
    pattern: '* * * * *',
    jobId: 'tick:compliance_scan',
    repeatKey: 'tick-compliance-scan',
  },
  {
    name: 'tick:escalation',
    data: { kind: 'escalation_scan' },
    pattern: '30 6 * * *',
    jobId: 'tick:escalation',
    repeatKey: 'tick-escalation',
  },
  {
    name: 'tick:digest',
    data: { kind: 'digest_scan' },
    pattern: '5 * * * *',
    jobId: 'tick:digest',
    repeatKey: 'tick-digest',
  },
  {
    name: 'tick:scheduled_flow',
    data: { kind: 'scheduled_flow_scan' },
    pattern: '* * * * *',
    jobId: 'tick:scheduled_flow',
    repeatKey: 'tick-scheduled-flow',
  },
  {
    name: 'tick:sync_scan',
    data: { kind: 'sync_scan' },
    pattern: '*/15 * * * *',
    jobId: 'tick:sync_scan',
    repeatKey: 'tick-sync-scan',
  },
  {
    name: 'tick:db_maintenance',
    data: { kind: 'db_maintenance', trigger: 'scheduled' },
    pattern: '30 3 * * *',
    jobId: 'tick:db_maintenance',
    repeatKey: 'tick-db-maintenance',
  },
  {
    name: 'tick:domain_event_outbox',
    data: { kind: 'domain_event_outbox_scan' },
    pattern: '* * * * *',
    jobId: 'tick:domain_event_outbox',
    repeatKey: 'tick-domain-event-outbox',
  },
  {
    name: 'tick:storage_object_deletion',
    data: { kind: 'storage_object_deletion_scan' },
    pattern: '* * * * *',
    jobId: 'tick:storage_object_deletion',
    repeatKey: 'tick-storage-object-deletion',
  },
  {
    name: 'tick:office_render_reconcile',
    data: { kind: 'office_render_reconcile' },
    pattern: '*/5 * * * *',
    jobId: 'tick:office_render_reconcile',
    repeatKey: 'tick-office-render-reconcile',
  },
]

async function removeUnconfiguredSchedules() {
  const scheduledQueue = getScheduledQueue()
  const repeatables = await scheduledQueue.getRepeatableJobs()
  const unconfigured = repeatables.filter((job) =>
    SCHEDULES.every(
      (expected) =>
        job.key !== expected.repeatKey ||
        job.name !== expected.name ||
        job.pattern !== expected.pattern,
    ),
  )

  // Keep Redis pressure bounded even if a previous deployment accidentally
  // accumulated many stale repeat definitions.
  for (const job of unconfigured) {
    await scheduledQueue.removeRepeatableByKey(job.key)
  }
}

export async function registerSchedules() {
  // Reconcile Redis to this exact registry. Pattern/name changes replace their
  // old repeat key instead of leaving shadow schedules firing indefinitely.
  await removeUnconfiguredSchedules()
  for (const schedule of SCHEDULES) {
    await enqueueScheduled(schedule.name, schedule.data, {
      // BullMQ's generated repeat key hashes the jobId and then omits it from
      // getRepeatableJobs(). A stable explicit key makes reconciliation exact:
      // a renamed jobId cannot survive as an indistinguishable shadow timer.
      repeat: { pattern: schedule.pattern, key: schedule.repeatKey },
      jobId: schedule.jobId,
    })
  }
}
