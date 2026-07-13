import { and, asc, eq, lte, or, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant, type Database } from '@beaconhs/db'
import { domainEventOutbox } from '@beaconhs/db/schema'
import { assertDomainEventIdentity, deliverDomainNotification } from '@beaconhs/events'
import { publishIntegrationEvent } from '@beaconhs/integrations'
import { domainEventRetryAt } from './domain-event-outbox-policy'
import { dispatchDomainEventWebCommand } from './domain-event-web-command'

const BATCH_SIZE = 100
const CLAIM_TIMEOUT_MS = 10 * 60_000

type DomainEventOutboxScanResult = {
  claimed: number
  published: number
  retried: number
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

  for (const event of claimed) {
    try {
      assertDomainEventIdentity(event)
      if (event.payload.notification && !event.notificationPublishedAt) {
        await deliverDomainNotification(event.tenantId, event.id, event.payload.notification)
        await withSuperAdmin(db, (tx) =>
          tx
            .update(domainEventOutbox)
            .set({ notificationPublishedAt: new Date() })
            .where(eq(domainEventOutbox.id, event.id)),
        )
      }
      if (event.payload.integration && !event.integrationPublishedAt) {
        const ctx = {
          tenantId: event.tenantId,
          db: <T>(fn: (tx: Database) => Promise<T>) => withTenant(db, event.tenantId, fn),
        }
        await publishIntegrationEvent(ctx, event.payload.integration, event.id)
        await withSuperAdmin(db, (tx) =>
          tx
            .update(domainEventOutbox)
            .set({ integrationPublishedAt: new Date() })
            .where(eq(domainEventOutbox.id, event.id)),
        )
      }
      if (event.payload.web && !event.webPublishedAt) {
        await dispatchDomainEventWebCommand(event.id)
      }
      await withSuperAdmin(db, (tx) =>
        tx
          .update(domainEventOutbox)
          .set({ status: 'published', publishedAt: new Date(), claimedAt: null, lastError: null })
          .where(
            and(eq(domainEventOutbox.id, event.id), eq(domainEventOutbox.status, 'publishing')),
          ),
      )
      result.published += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await withSuperAdmin(db, (tx) =>
        tx
          .update(domainEventOutbox)
          .set({
            status: 'pending',
            availableAt: domainEventRetryAt(event.attempts, now),
            claimedAt: null,
            lastError: message,
          })
          .where(eq(domainEventOutbox.id, event.id)),
      )
      result.retried += 1
    }
  }
  return result
}
