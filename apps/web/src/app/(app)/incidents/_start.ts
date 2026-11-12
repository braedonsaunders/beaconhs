'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { nextReference } from '@/lib/reference'
import { recordIncidentCreated } from '@/lib/incident-events'

// Starts an empty draft report and opens it. The reporter fills it in on the
// record page and taps Submit report, which runs the incident `on_submit` Flows.
export async function startIncident() {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'incidents.create')
  const type = 'injury' as const
  const severity = 'no_injury' as const
  const title = 'Incident report'
  const description = null
  const occurredAt = new Date()
  const siteOrgUnitId = null
  const location = null
  const weather = null
  const immediateActionTaken = null

  const row = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'incident')
    const created = await tx
      .insert(incidents)
      .values({
        tenantId: ctx.tenantId,
        reference,
        type,
        severity,
        status: 'reported',
        isDraft: true,
        title,
        description,
        occurredAt,
        siteOrgUnitId,
        location,
        weather,
        immediateActionTaken,
        reportedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning()
    const incident = created[0]
    if (!incident) throw new Error('Incident could not be created.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'incident',
      entityId: incident.id,
      action: 'create',
      summary: `Started ${incident.reference}`,
      after: { reference: incident.reference, type, severity, occurredAt },
    })
    await recordIncidentCreated(tx, ctx, incident)
    return incident
  })

  revalidatePath('/incidents')
  revalidatePath('/my/incidents')
  redirect(`/incidents/${row.id}`)
}
