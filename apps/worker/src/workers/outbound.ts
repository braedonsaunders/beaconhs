import type { Job } from 'bullmq'
import { db, withTenant } from '@beaconhs/db'
import type { Database } from '@beaconhs/db'
import { dispatchOne } from '@beaconhs/integrations'
import { assertOutboundDispatchJob, type OutboundDispatchJob } from '@beaconhs/jobs'

// Outbound automation worker. One job = one automation × one event. We rebuild a
// tenant-scoped ctx and run the shared dispatchOne (it delivers, reconciles the
// export ledger, and records status/last_error on the row). A delivery failure
// is returned as {ok:false}; we throw so BullMQ retries this single automation
// in isolation (exponential backoff). Idempotent destinations (SQL) reverse +
// re-post on retry; non-reversible ones with "only once per record" are guarded
// by the ledger.
export async function processOutboundDispatch(job: Job<OutboundDispatchJob>): Promise<void> {
  assertOutboundDispatchJob(job.data)
  const { tenantId, automationId, event } = job.data
  const ctx = {
    tenantId,
    db: <T>(fn: (tx: Database) => Promise<T>) => withTenant(db, tenantId, fn),
  }
  const res = await dispatchOne(ctx, automationId, event)
  if (!res.ok) throw new Error(res.error ?? 'Outbound delivery failed')
}
