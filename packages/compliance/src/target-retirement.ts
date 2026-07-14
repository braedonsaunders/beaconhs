import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceObligations } from '@beaconhs/db/schema'

type ComplianceSourceModule = typeof complianceObligations.$inferSelect.sourceModule

export type RetirableComplianceTarget =
  | 'inspection_type'
  | 'document'
  | 'course'
  | 'assessment_type'
  | 'skill_type'
  | 'form_template'
  | 'equipment_type'
  | 'ppe_type'

type ComplianceTargetRefKey =
  | 'inspectionTypeId'
  | 'documentId'
  | 'courseId'
  | 'assessmentTypeId'
  | 'skillTypeId'
  | 'formTemplateId'
  | 'equipmentTypeId'
  | 'ppeTypeId'

export type ComplianceTargetRetirementPlan = {
  sourceModules: readonly ComplianceSourceModule[]
  targetRefKey: ComplianceTargetRefKey
  label: string
}

export class ComplianceTargetInUseError extends Error {
  override readonly name = 'ComplianceTargetInUseError'
}

const PLANS: Record<RetirableComplianceTarget, ComplianceTargetRetirementPlan> = {
  inspection_type: {
    sourceModules: ['inspection'],
    targetRefKey: 'inspectionTypeId',
    label: 'inspection type',
  },
  document: {
    sourceModules: ['document'],
    targetRefKey: 'documentId',
    label: 'document',
  },
  course: {
    sourceModules: ['training', 'cert_requirement'],
    targetRefKey: 'courseId',
    label: 'course',
  },
  assessment_type: {
    sourceModules: ['training'],
    targetRefKey: 'assessmentTypeId',
    label: 'assessment type',
  },
  skill_type: {
    sourceModules: ['cert_requirement'],
    targetRefKey: 'skillTypeId',
    label: 'skill type',
  },
  form_template: {
    sourceModules: ['form'],
    targetRefKey: 'formTemplateId',
    label: 'app',
  },
  equipment_type: {
    sourceModules: ['equipment_inspection'],
    targetRefKey: 'equipmentTypeId',
    label: 'equipment type',
  },
  ppe_type: {
    sourceModules: ['ppe_inspection'],
    targetRefKey: 'ppeTypeId',
    label: 'PPE type',
  },
}

export function planComplianceTargetRetirement(
  target: RetirableComplianceTarget,
): ComplianceTargetRetirementPlan {
  return PLANS[target]
}

/**
 * Reject retirement of a target referenced by a live obligation.
 *
 * The caller must first lock the target's owner row FOR UPDATE, with an
 * explicit tenant predicate. Obligation authoring takes FOR KEY SHARE on that
 * same owner row before inserting, enabling, or retargeting an obligation, so
 * this owner -> obligation lock order closes both sides of the race.
 */
export async function assertComplianceTargetCanRetire(
  tx: Database,
  tenantId: string,
  target: RetirableComplianceTarget,
  targetId: string,
): Promise<void> {
  const plan = planComplianceTargetRetirement(target)
  const targetIdExpression = sql<string>`${complianceObligations.targetRef} ->> ${plan.targetRefKey}`
  const moduleCondition =
    plan.sourceModules.length === 1
      ? eq(complianceObligations.sourceModule, plan.sourceModules[0]!)
      : inArray(complianceObligations.sourceModule, [...plan.sourceModules])

  const [obligation] = await tx
    .select({ id: complianceObligations.id })
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        moduleCondition,
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        eq(targetIdExpression, targetId),
      ),
    )
    .limit(1)
    .for('key share')

  if (obligation) {
    throw new ComplianceTargetInUseError(
      `Cannot retire this ${plan.label} while an active compliance obligation requires it. Pause or delete the obligation first.`,
    )
  }
}
