import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { domainEventOutbox } from '@beaconhs/db/schema'
import { verifyDomainEventRequest } from '@beaconhs/events'
import { makeTenantContext } from '@beaconhs/tenant'
import { sendFormResponseRecapEmail } from '@/app/(app)/apps/_lib/recap-email'
import {
  runOnSubmitAutomations,
  runStatusChangeAutomations,
} from '@/app/(app)/apps/_lib/run-automations'
import { executeModuleFlowsNow } from '@/lib/flows/run-module-flows'
import { resumeFlowGateNow } from '@/lib/flows/resume-flow-gate'
import { isUuid } from '@/lib/list-params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return new Response('Not found', { status: 404 })
  if (
    !verifyDomainEventRequest(
      id,
      request.headers.get('x-beaconhs-event-timestamp'),
      request.headers.get('x-beaconhs-event-signature'),
    )
  ) {
    return new Response('Unauthorized', { status: 401 })
  }

  const event = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.id, id))
      .limit(1)
    return row ?? null
  })
  if (!event?.payload.web) return new Response('Web command not found', { status: 404 })
  if (event.webPublishedAt) return Response.json({ ok: true, replay: true })
  if (event.status !== 'publishing') {
    return new Response('Domain event is not claimed for publication', { status: 409 })
  }

  const command = event.payload.web
  const actor = command.actor
  if (
    !isUuid(actor.userId) ||
    (actor.membershipId && !isUuid(actor.membershipId)) ||
    (actor.personId && !isUuid(actor.personId))
  ) {
    return new Response('Invalid command actor', { status: 422 })
  }
  const ctx = makeTenantContext(db, {
    userId: actor.userId,
    tenantId: event.tenantId,
    isSuperAdmin: true,
    timezone: actor.timezone,
    membership: actor.membershipId
      ? { id: actor.membershipId, displayName: 'Flow automation' }
      : null,
    personId: actor.personId,
    permissions: new Set(['*']),
    scopes: [{ type: 'tenant' }],
  })

  try {
    if (command.kind === 'module_flow') {
      await executeModuleFlowsNow(
        ctx,
        {
          moduleKey: command.moduleKey,
          event: command.event,
          subjectId: command.subjectId,
          toStatus: command.toStatus,
        },
        event.id,
      )
    } else if (command.kind === 'form_submitted') {
      if (command.recap) await sendFormResponseRecapEmail(ctx, command.subjectId, event.id)
      await runOnSubmitAutomations(
        ctx,
        {
          templateId: command.templateId,
          responseId: command.subjectId,
          data: command.data,
          score: command.score,
          status: command.status,
        },
        event.id,
      )
    } else if (command.kind === 'flow_gate_decided') {
      await resumeFlowGateNow(ctx, command.gateId, command.decision, event.id)
    } else {
      await runStatusChangeAutomations(
        ctx,
        {
          templateId: command.templateId,
          responseId: command.subjectId,
          data: command.data,
          score: command.score,
          status: command.status,
          toStatus: command.toStatus,
        },
        event.id,
      )
    }

    await ctx.db((tx) =>
      tx
        .update(domainEventOutbox)
        .set({ webPublishedAt: new Date() })
        .where(eq(domainEventOutbox.id, event.id)),
    )
    return Response.json({ ok: true })
  } catch (error) {
    console.error('[domain-events] web command failed', {
      eventId: event.id,
      kind: command.kind,
      error,
    })
    return new Response(error instanceof Error ? error.message : 'Web command failed', {
      status: 500,
    })
  }
}
