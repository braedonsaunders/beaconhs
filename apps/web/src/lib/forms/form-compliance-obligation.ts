import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceAudience, complianceObligations, complianceStatus } from '@beaconhs/db/schema'
import { resolveObligationAudience } from '@beaconhs/compliance'

type FormObligation = typeof complianceObligations.$inferSelect

export async function loadFormObligation(
  tx: Database,
  input: { tenantId: string; obligationId: string; templateId: string },
): Promise<FormObligation | null> {
  const [row] = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, input.tenantId),
        eq(complianceObligations.id, input.obligationId),
        eq(complianceObligations.sourceModule, 'form'),
      ),
    )
    .limit(1)
  if (row?.targetRef?.formTemplateId !== input.templateId) return null
  return row
}

/**
 * Resolve an active form obligation that is currently assigned to the person.
 * Caller-controlled ids never become response provenance without this check.
 */
export async function loadApplicableFormObligation(
  tx: Database,
  input: {
    tenantId: string
    obligationId: string
    templateId: string
    personId: string | null
  },
): Promise<FormObligation | null> {
  if (!input.personId) return null
  const obligation = await loadFormObligation(tx, input)
  if (!obligation || obligation.status !== 'active' || obligation.deletedAt !== null) return null
  const audience = await tx
    .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
    .from(complianceAudience)
    .where(
      and(
        eq(complianceAudience.tenantId, input.tenantId),
        eq(complianceAudience.obligationId, input.obligationId),
      ),
    )
  const members = await resolveObligationAudience(
    tx,
    input.tenantId,
    audience.map((row) => ({ kind: row.kind, entityKey: row.entityKey })),
  )
  if (!members.some((member) => member.personId === input.personId)) return null
  const [actionable] = await tx
    .select({ id: complianceStatus.id })
    .from(complianceStatus)
    .where(
      and(
        eq(complianceStatus.tenantId, input.tenantId),
        eq(complianceStatus.obligationId, input.obligationId),
        eq(complianceStatus.personId, input.personId),
        inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue']),
      ),
    )
    .limit(1)
  return actionable ? obligation : null
}
