import type { Database } from '@beaconhs/db'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'

const FORM_EVIDENCE_STATUSES = new Set(['submitted', 'in_review', 'closed', 'non_compliant'])

export type FormResponseEvidenceSnapshot = {
  templateId: string
  complianceObligationId: string | null
  status: string
  submittedAt: Date | null
  submittedBy: string | null
  deletedAt: Date | null
}

function timestamp(value: Date | null): number | null {
  return value?.getTime() ?? null
}

export function isActiveFormResponseEvidence(
  value: FormResponseEvidenceSnapshot | null,
): value is FormResponseEvidenceSnapshot {
  return !!(
    value &&
    value.complianceObligationId &&
    FORM_EVIDENCE_STATUSES.has(value.status) &&
    value.submittedAt &&
    value.submittedBy &&
    !value.deletedAt
  )
}

export function formResponseEvidenceChanged(
  before: FormResponseEvidenceSnapshot | null,
  after: FormResponseEvidenceSnapshot | null,
): boolean {
  const beforeActive = isActiveFormResponseEvidence(before)
  const afterActive = isActiveFormResponseEvidence(after)
  if (!beforeActive && !afterActive) return false
  if (beforeActive !== afterActive) return true
  if (!before || !after) return true
  return (
    before.templateId !== after.templateId ||
    before.complianceObligationId !== after.complianceObligationId ||
    before.submittedBy !== after.submittedBy ||
    timestamp(before.submittedAt) !== timestamp(after.submittedAt)
  )
}

export async function materializeFormResponseEvidenceChange(
  tx: Database,
  tenantId: string,
  before: FormResponseEvidenceSnapshot | null,
  after: FormResponseEvidenceSnapshot | null,
): Promise<void> {
  if (!formResponseEvidenceChanged(before, after)) return
  const templateIds = new Set<string>()
  if (isActiveFormResponseEvidence(before)) templateIds.add(before.templateId)
  if (isActiveFormResponseEvidence(after)) templateIds.add(after.templateId)
  for (const formTemplateId of [...templateIds].sort()) {
    await materializeEvidenceTargetObligations(tx, tenantId, {
      sourceModule: 'form',
      targetRef: { formTemplateId },
    })
  }
}
