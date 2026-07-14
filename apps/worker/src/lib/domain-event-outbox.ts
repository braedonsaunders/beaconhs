import { and, asc, eq, lte, or, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant, type Database } from '@beaconhs/db'
import { domainEventOutbox } from '@beaconhs/db/schema'
import { assertDomainEventIdentity, deliverDomainNotification } from '@beaconhs/events'
import { publishIntegrationEvent } from '@beaconhs/integrations'
import { domainEventRetryAt } from './domain-event-outbox-policy'
import { dispatchDomainEventWebCommand } from './domain-event-web-command'

// A web command may legitimately run for up to two minutes. Keep the claimed
// batch below the ten-minute stale-lease window even at that worst case, and
// process a small bounded number in parallel so later rows do not sit claimed
// but untouched until their lease expires.
const BATCH_SIZE = 20
const PUBLISH_CONCURRENCY = 5
const CLAIM_TIMEOUT_MS = 10 * 60_000

type DomainEventOutboxScanResult = {
  claimed: number
  published: number
  retried: number
}

class DomainEventLeaseLost extends Error {
  constructor() {
    super('Domain event publishing lease was superseded')
  }
}

function nextLeaseTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1))
}

async function renewDomainEventLease(
  eventId: string,
  previous: Date,
  publishedField?: 'notificationPublishedAt' | 'integrationPublishedAt',
): Promise<Date> {
  const next = nextLeaseTimestamp(previous)
  const [renewed] = await withSuperAdmin(db, (tx) =>
    tx
      .update(domainEventOutbox)
      .set({
        ...(publishedField ? { [publishedField]: next } : {}),
        claimedAt: next,
      })
      .where(
        and(
          eq(domainEventOutbox.id, eventId),
          eq(domainEventOutbox.status, 'publishing'),
          eq(domainEventOutbox.claimedAt, previous),
        ),
      )
      .returning({ id: domainEventOutbox.id }),
  )
  if (!renewed) throw new DomainEventLeaseLost()
  return next
}

export async function drainDomainEventOutbox(
  now: Date = new Date(),
): Promise<DomainEventOutboxScanResult> {
  const result: DomainEventOutboxScanResult = { claimed: 0, published: 0, retried: 0 }
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS)
  const claimed = await withSuperAdmin(db, async (tx) => {
    const rows = await tx
      .select()
      .from(domainEventOutbox)
      .where(
        or(
          and(eq(domainEventOutbox.status, 'pending'), lte(domainEventOutbox.availableAt, now)),
          and(
            eq(domainEventOutbox.status, 'publishing'),
            lte(domainEventOutbox.claimedAt, staleBefore),
          ),
        ),
      )
      .orderBy(asc(domainEventOutbox.createdAt))
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true })
    for (const row of rows) {
      await tx
        .update(domainEventOutbox)
        .set({
          status: 'publishing',
          claimedAt: now,
          attempts: sql`${domainEventOutbox.attempts} + 1`,
          lastError: null,
        })
        .where(eq(domainEventOutbox.id, row.id))
    }
    return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }))
  })
  result.claimed = claimed.length

  for (let offset = 0; offset < claimed.length; offset += PUBLISH_CONCURRENCY) {
    await Promise.all(
      claimed.slice(offset, offset + PUBLISH_CONCURRENCY).map(async (event) => {
        let leaseAt = now
        try {
          assertDomainEventIdentity(event)
          if (event.payload.notification && !event.notificationPublishedAt) {
            await deliverDomainNotification(event.tenantId, event.id, event.payload.notification)
            leaseAt = await renewDomainEventLease(event.id, leaseAt, 'notificationPublishedAt')
          }
          if (event.payload.integration && !event.integrationPublishedAt) {
            const ctx = {
              tenantId: event.tenantId,
              db: <T>(fn: (tx: Database) => Promise<T>) => withTenant(db, event.tenantId, fn),
            }
            await publishIntegrationEvent(ctx, event.payload.integration, event.id)
            leaseAt = await renewDomainEventLease(event.id, leaseAt, 'integrationPublishedAt')
          }
          if (event.payload.web && !event.webPublishedAt) {
            await dispatchDomainEventWebCommand(event.id)
            leaseAt = await renewDomainEventLease(event.id, leaseAt)
          }
          const [published] = await withSuperAdmin(db, (tx) =>
            tx
              .update(domainEventOutbox)
              .set({
                status: 'published',
                publishedAt: new Date(),
                claimedAt: null,
                lastError: null,
              })
              .where(
                and(
                  eq(domainEventOutbox.id, event.id),
                  eq(domainEventOutbox.status, 'publishing'),
                  eq(domainEventOutbox.claimedAt, leaseAt),
                ),
              )
              .returning({ id: domainEventOutbox.id }),
          )
          if (!published) throw new DomainEventLeaseLost()
          result.published += 1
        } catch (error) {
          const failedAt = new Date()
          const message = (error instanceof Error ? error.message : String(error))
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
            .slice(0, 4_000)
          const [released] = await withSuperAdmin(db, (tx) =>
            tx
              .update(domainEventOutbox)
              .set({
                status: 'pending',
                availableAt: domainEventRetryAt(event.attempts, failedAt),
                claimedAt: null,
                lastError: message,
              })
              .where(
                and(
                  eq(domainEventOutbox.id, event.id),
                  eq(domainEventOutbox.status, 'publishing'),
                  eq(domainEventOutbox.claimedAt, leaseAt),
                ),
              )
              .returning({ id: domainEventOutbox.id }),
          )
          if (released) result.retried += 1
        }
      }),
    )
  }
  return result
}
