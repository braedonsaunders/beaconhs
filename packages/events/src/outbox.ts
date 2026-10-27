import { and, desc, eq } from 'drizzle-orm'
import { isDeepStrictEqual } from 'node:util'
import type { Database } from '@beaconhs/db'
import {
  domainEventOutbox,
  type DomainEventActor,
  type DomainEventPayload,
  type DomainWebCommand,
} from '@beaconhs/db/schema'

export type RecordDomainEventInput = {
  tenantId: string
  eventType: string
  subjectId: string
  dedupKey: string
  payload: DomainEventPayload
  /** Earliest publish time; defaults to now (the column default). */
  availableAt?: Date
}

type ActorContext = {
  userId: string
  membership?: { id: string } | null
  personId: string | null
  timezone: string
}

export function domainEventActor(ctx: ActorContext): DomainEventActor {
  return {
    userId: ctx.userId,
    membershipId: ctx.membership?.id ?? null,
    personId: ctx.personId,
    timezone: ctx.timezone,
  }
}

export function moduleFlowCommand(
  ctx: ActorContext,
  args: Omit<Extract<DomainWebCommand, { kind: 'module_flow' }>, 'kind' | 'actor'>,
): DomainWebCommand {
  return { kind: 'module_flow', ...args, actor: domainEventActor(ctx) }
}

export async function recordModuleFlowEvent(
  tx: Database,
  ctx: ActorContext & { tenantId: string },
  args: Omit<Extract<DomainWebCommand, { kind: 'module_flow' }>, 'kind' | 'actor'> & {
    occurrenceKey: string
  },
): Promise<string> {
  const { occurrenceKey, ...command } = args
  return recordDomainEvent(tx, {
    tenantId: ctx.tenantId,
    eventType: `flow.${command.moduleKey}.${command.event}`,
    subjectId: command.subjectId,
    dedupKey: `flow.${command.moduleKey}.${command.event}:${command.subjectId}:${occurrenceKey}`,
    payload: { web: moduleFlowCommand(ctx, command) },
  })
}

/** Reject corrupt/cross-tenant payloads both before storage and before delivery. */
export function assertDomainEventIdentity(input: RecordDomainEventInput): void {
  if (!input.eventType.trim() || !input.dedupKey.trim()) {
    throw new Error('A domain event requires an event type and deduplication key')
  }
  if (!input.payload.notification && !input.payload.integration && !input.payload.web) {
    throw new Error('A domain event requires at least one delivery effect')
  }
  if (
    input.payload.integration &&
    (input.payload.integration.tenantId !== input.tenantId ||
      input.payload.integration.subjectId !== input.subjectId ||
      input.payload.integration.type !== input.eventType)
  ) {
    throw new Error('Integration event identity does not match its domain event')
  }
  const notificationSubjectId = input.payload.notification
    ? 'assessmentId' in input.payload.notification
      ? input.payload.notification.assessmentId
      : 'incidentId' in input.payload.notification
        ? input.payload.notification.incidentId
        : input.payload.notification.caId
    : null
  if (notificationSubjectId && notificationSubjectId !== input.subjectId) {
    throw new Error('Notification event identity does not match its domain event')
  }
  if (input.payload.web && input.payload.web.subjectId !== input.subjectId) {
    throw new Error('Web command identity does not match its domain event')
  }
  if (
    input.payload.web?.kind === 'flow_gate_decided' &&
    input.payload.web.gateId !== input.subjectId
  ) {
    throw new Error('Flow gate command identity does not match its domain event')
  }
}

/** Write an event in the SAME transaction as its domain mutation. */
export async function recordDomainEvent(
  tx: Database,
  input: RecordDomainEventInput,
): Promise<string> {
  assertDomainEventIdentity(input)
  const { availableAt, ...rest } = input
  const [inserted] = await tx
    .insert(domainEventOutbox)
    .values(availableAt ? { ...rest, availableAt } : rest)
    .onConflictDoNothing({
      target: [domainEventOutbox.tenantId, domainEventOutbox.dedupKey],
    })
    .returning({ id: domainEventOutbox.id })
  if (inserted) return inserted.id

  const [existing] = await tx
    .select({
      id: domainEventOutbox.id,
      eventType: domainEventOutbox.eventType,
      subjectId: domainEventOutbox.subjectId,
      payload: domainEventOutbox.payload,
    })
    .from(domainEventOutbox)
    .where(
      and(
        eq(domainEventOutbox.tenantId, input.tenantId),
        eq(domainEventOutbox.dedupKey, input.dedupKey),
      ),
    )
    .limit(1)
  if (
    !existing ||
    existing.eventType !== input.eventType ||
    existing.subjectId !== input.subjectId ||
    !isDeepStrictEqual(existing.payload, input.payload)
  ) {
    throw new Error('Domain event deduplication key conflicts with another event')
  }
  return existing.id
}

/**
 * Record a desired-state snapshot event (e.g. a training class schedule)
 * coalesced per subject: while an earlier snapshot for the same
 * (tenant, eventType, subject) is still pending, replace its payload and
 * push its availability out by `delayMs`, so a burst of edits (autosave
 * keystrokes, roster changes) publishes ONE delivery with the latest state
 * instead of one per keystroke. Once the pending row has been claimed or
 * published, the next snapshot is a fresh row under the caller's new
 * occurrence dedup key. Callers hold the subject row lock in the same
 * transaction (the class mutations do), which serializes the
 * find-or-insert; a racing insert would only cost one extra delivery of a
 * full-replace snapshot, never corrupt state.
 */
export async function recordCoalescibleDomainEvent(
  tx: Database,
  input: RecordDomainEventInput,
  delayMs: number,
): Promise<string> {
  assertDomainEventIdentity(input)
  const availableAt = new Date(Date.now() + Math.max(0, delayMs))
  const [pending] = await tx
    .select({ id: domainEventOutbox.id })
    .from(domainEventOutbox)
    .where(
      and(
        eq(domainEventOutbox.tenantId, input.tenantId),
        eq(domainEventOutbox.eventType, input.eventType),
        eq(domainEventOutbox.subjectId, input.subjectId),
        eq(domainEventOutbox.status, 'pending'),
      ),
    )
    .orderBy(desc(domainEventOutbox.createdAt))
    .limit(1)
    .for('update')
  if (pending) {
    await tx
      .update(domainEventOutbox)
      .set({ payload: input.payload, availableAt, lastError: null })
      .where(eq(domainEventOutbox.id, pending.id))
    return pending.id
  }
  const { availableAt: _ignored, ...rest } = input
  const [inserted] = await tx
    .insert(domainEventOutbox)
    .values({ ...rest, availableAt })
    .returning({ id: domainEventOutbox.id })
  if (!inserted) throw new Error('Domain event could not be recorded')
  return inserted.id
}
