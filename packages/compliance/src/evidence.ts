import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceObligations,
  documents,
  equipmentTypes,
  formTemplates,
  inspectionTypes,
  ppeTypes,
  trainingAssessmentTypes,
  trainingCourses,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import {
  ensureSystemObligations,
  materializeObligation,
  resolveComplianceClock,
} from './materialize'
import { ComplianceTargetError, planComplianceTargetLock } from './target-lock'

export type ComplianceEvidenceTarget =
  | { sourceModule: 'document'; targetRef: { documentId: string } }
  | { sourceModule: 'inspection'; targetRef: { inspectionTypeId: string } }
  | { sourceModule: 'form'; targetRef: { formTemplateId: string } }
  | { sourceModule: 'equipment_inspection'; targetRef: { equipmentTypeId: string } }
  | { sourceModule: 'ppe_inspection'; targetRef: { ppeTypeId: string } }
  | {
      sourceModule: 'journal' | 'hazard_assessment' | 'corrective_action'
      targetRef: Record<string, never>
    }
  | {
      sourceModule: 'training' | 'cert_requirement'
      targetRef: { courseId: string; assessmentTypeId?: never; skillTypeId?: never }
    }
  | {
      sourceModule: 'training'
      targetRef: { assessmentTypeId: string; courseId?: never; skillTypeId?: never }
    }
  | {
      sourceModule: 'cert_requirement'
      targetRef: { skillTypeId: string; courseId?: never; assessmentTypeId?: never }
    }

export type EvidenceMaterializationResult = { obligationIds: string[] }

type ComplianceEvidenceOwner =
  | 'assessment_type'
  | 'course'
  | 'document'
  | 'equipment_type'
  | 'form_template'
  | 'inspection_type'
  | 'ppe_type'
  | 'skill_type'
type ComplianceEvidenceMatch = {
  sourceModule: typeof complianceObligations.$inferSelect.sourceModule
  targetKey:
    | 'assessmentTypeId'
    | 'courseId'
    | 'documentId'
    | 'equipmentTypeId'
    | 'formTemplateId'
    | 'inspectionTypeId'
    | 'ppeTypeId'
    | 'skillTypeId'
    | null
}

export type ComplianceEvidenceTargetPlan = {
  owner: ComplianceEvidenceOwner | null
  ownerId: string | null
  matches: readonly ComplianceEvidenceMatch[]
}

/**
 * Keep evidence-family fan-out in one pure plan. Course evidence matches both
 * `training` and `cert_requirement`, while targetless modules match every live
 * obligation in their family without inventing a shadow target identifier.
 */
export function planComplianceEvidenceTarget(
  target: ComplianceEvidenceTarget,
): ComplianceEvidenceTargetPlan {
  if (
    target.sourceModule === 'journal' ||
    target.sourceModule === 'hazard_assessment' ||
    target.sourceModule === 'corrective_action'
  ) {
    return {
      owner: null,
      ownerId: null,
      matches: [{ sourceModule: target.sourceModule, targetKey: null }],
    }
  }

  const owner = planComplianceTargetLock(target.sourceModule, target.targetRef)
  if (!owner) throw new ComplianceTargetError('Compliance evidence target is invalid')

  switch (target.sourceModule) {
    case 'document':
      if (owner.entity !== 'document') {
        throw new ComplianceTargetError('Compliance document evidence target is invalid')
      }
      return {
        owner: 'document',
        ownerId: owner.id,
        matches: [{ sourceModule: 'document', targetKey: 'documentId' }],
      }
    case 'inspection':
      if (owner.entity !== 'inspection_type') {
        throw new ComplianceTargetError('Compliance inspection evidence target is invalid')
      }
      return {
        owner: 'inspection_type',
        ownerId: owner.id,
        matches: [{ sourceModule: 'inspection', targetKey: 'inspectionTypeId' }],
      }
    case 'form':
      if (owner.entity !== 'form_template') {
        throw new ComplianceTargetError('Compliance form evidence target is invalid')
      }
      return {
        owner: 'form_template',
        ownerId: owner.id,
        matches: [{ sourceModule: 'form', targetKey: 'formTemplateId' }],
      }
    case 'equipment_inspection':
      if (owner.entity !== 'equipment_type') {
        throw new ComplianceTargetError('Compliance equipment evidence target is invalid')
      }
      return {
        owner: 'equipment_type',
        ownerId: owner.id,
        matches: [{ sourceModule: 'equipment_inspection', targetKey: 'equipmentTypeId' }],
      }
    case 'ppe_inspection':
      if (owner.entity !== 'ppe_type') {
        throw new ComplianceTargetError('Compliance PPE evidence target is invalid')
      }
      return {
        owner: 'ppe_type',
        ownerId: owner.id,
        matches: [{ sourceModule: 'ppe_inspection', targetKey: 'ppeTypeId' }],
      }
    case 'training':
      if (owner.entity === 'assessment_type') {
        return {
          owner: 'assessment_type',
          ownerId: owner.id,
          matches: [{ sourceModule: 'training', targetKey: 'assessmentTypeId' }],
        }
      }
      if (owner.entity !== 'course') {
        throw new ComplianceTargetError('Compliance training evidence target is invalid')
      }
      return {
        owner: 'course',
        ownerId: owner.id,
        matches: [
          { sourceModule: 'training', targetKey: 'courseId' },
          { sourceModule: 'cert_requirement', targetKey: 'courseId' },
        ],
      }
    case 'cert_requirement':
      if (owner.entity === 'skill_type') {
        return {
          owner: 'skill_type',
          ownerId: owner.id,
          matches: [{ sourceModule: 'cert_requirement', targetKey: 'skillTypeId' }],
        }
      }
      if (owner.entity !== 'course') {
        throw new ComplianceTargetError('Compliance certification evidence target is invalid')
      }
      return {
        owner: 'course',
        ownerId: owner.id,
        matches: [
          { sourceModule: 'training', targetKey: 'courseId' },
          { sourceModule: 'cert_requirement', targetKey: 'courseId' },
        ],
      }
  }
}

async function lockEvidenceTargetOwner(
  tx: Database,
  tenantId: string,
  plan: ComplianceEvidenceTargetPlan,
): Promise<void> {
  if (!plan.owner || !plan.ownerId) return
  switch (plan.owner) {
    case 'document': {
      const [row] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, plan.ownerId)))
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence document no longer exists')
      return
    }
    case 'inspection_type': {
      const [row] = await tx
        .select({ id: inspectionTypes.id })
        .from(inspectionTypes)
        .where(and(eq(inspectionTypes.tenantId, tenantId), eq(inspectionTypes.id, plan.ownerId)))
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence inspection type no longer exists')
      return
    }
    case 'form_template': {
      const [row] = await tx
        .select({ id: formTemplates.id })
        .from(formTemplates)
        .where(and(eq(formTemplates.tenantId, tenantId), eq(formTemplates.id, plan.ownerId)))
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence form template no longer exists')
      return
    }
    case 'equipment_type': {
      const [row] = await tx
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(and(eq(equipmentTypes.tenantId, tenantId), eq(equipmentTypes.id, plan.ownerId)))
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence equipment type no longer exists')
      return
    }
    case 'ppe_type': {
      const [row] = await tx
        .select({ id: ppeTypes.id })
        .from(ppeTypes)
        .where(and(eq(ppeTypes.tenantId, tenantId), eq(ppeTypes.id, plan.ownerId)))
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence PPE type no longer exists')
      return
    }
    case 'course': {
      const [row] = await tx
        .select({ id: trainingCourses.id })
        .from(trainingCourses)
        .where(and(eq(trainingCourses.tenantId, tenantId), eq(trainingCourses.id, plan.ownerId)))
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence course no longer exists')
      return
    }
    case 'assessment_type': {
      const [row] = await tx
        .select({ id: trainingAssessmentTypes.id })
        .from(trainingAssessmentTypes)
        .where(
          and(
            eq(trainingAssessmentTypes.tenantId, tenantId),
            eq(trainingAssessmentTypes.id, plan.ownerId),
          ),
        )
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence assessment type no longer exists')
      return
    }
    case 'skill_type': {
      const [row] = await tx
        .select({ id: trainingSkillTypes.id })
        .from(trainingSkillTypes)
        .where(
          and(eq(trainingSkillTypes.tenantId, tenantId), eq(trainingSkillTypes.id, plan.ownerId)),
        )
        .limit(1)
        .for('update')
      if (!row) throw new ComplianceTargetError('The evidence skill type no longer exists')
    }
  }
}

function evidenceTargetRefValue(targetKey: ComplianceEvidenceMatch['targetKey']): SQL<string> {
  switch (targetKey) {
    case null:
      throw new ComplianceTargetError('Targetless compliance evidence has no reference value')
    case 'documentId':
      return sql<string>`${complianceObligations.targetRef}->>'documentId'`
    case 'inspectionTypeId':
      return sql<string>`${complianceObligations.targetRef}->>'inspectionTypeId'`
    case 'formTemplateId':
      return sql<string>`${complianceObligations.targetRef}->>'formTemplateId'`
    case 'equipmentTypeId':
      return sql<string>`${complianceObligations.targetRef}->>'equipmentTypeId'`
    case 'ppeTypeId':
      return sql<string>`${complianceObligations.targetRef}->>'ppeTypeId'`
    case 'courseId':
      return sql<string>`${complianceObligations.targetRef}->>'courseId'`
    case 'assessmentTypeId':
      return sql<string>`${complianceObligations.targetRef}->>'assessmentTypeId'`
    case 'skillTypeId':
      return sql<string>`${complianceObligations.targetRef}->>'skillTypeId'`
  }
}

function evidenceMatchPredicate(plan: ComplianceEvidenceTargetPlan): SQL {
  const matches = plan.matches.map((match) =>
    match.targetKey === null
      ? eq(complianceObligations.sourceModule, match.sourceModule)
      : and(
          eq(complianceObligations.sourceModule, match.sourceModule),
          eq(evidenceTargetRefValue(match.targetKey), plan.ownerId!),
        ),
  )
  if (matches.length === 0) throw new ComplianceTargetError('Compliance evidence plan has no match')
  return matches.length === 1 ? matches[0]! : or(...matches)!
}

/**
 * Reconcile every active obligation whose evidence can change in the caller's
 * transaction. The lifecycle owner is locked before obligation discovery, and
 * obligations are materialized in id order. This shares the target→obligation
 * lock order used by obligation authoring and prevents a concurrent obligation
 * create/update from being missed between an evidence write and its refresh.
 *
 * Availability is deliberately not revalidated here: historical inspection
 * records may remain editable after their type is unpublished. The owner row
 * only has to exist long enough to serialize the evidence boundary.
 */
export async function materializeEvidenceTargetObligations(
  tx: Database,
  tenantId: string,
  target: ComplianceEvidenceTarget,
): Promise<EvidenceMaterializationResult> {
  return materializeEvidenceTargetsObligations(tx, tenantId, [target])
}

export async function materializeEvidenceTargetsObligations(
  tx: Database,
  tenantId: string,
  targets: readonly ComplianceEvidenceTarget[],
): Promise<EvidenceMaterializationResult> {
  const plansByOwner = new Map<string, ComplianceEvidenceTargetPlan>()
  for (const target of targets) {
    const next = planComplianceEvidenceTarget(target)
    const key = next.owner
      ? `${next.owner}:\0${next.ownerId}`
      : `module:\0${next.matches
          .map((match) => match.sourceModule)
          .sort()
          .join(',')}`
    const prior = plansByOwner.get(key)
    if (!prior) {
      plansByOwner.set(key, next)
      continue
    }
    const matches = new Map(
      [...prior.matches, ...next.matches].map((match) => [
        `${match.sourceModule}:\0${match.targetKey}`,
        match,
      ]),
    )
    plansByOwner.set(key, { ...prior, matches: [...matches.values()] })
  }
  const plans = [...plansByOwner.values()].sort((left, right) => {
    const ownerOrder = (left.owner ?? 'module').localeCompare(right.owner ?? 'module')
    return ownerOrder || (left.ownerId ?? '').localeCompare(right.ownerId ?? '')
  })
  if (plans.length === 0) return { obligationIds: [] }

  if (
    plans.some((plan) => plan.matches.some((match) => match.sourceModule === 'corrective_action'))
  ) {
    await ensureSystemObligations(tx, tenantId)
  }
  for (const plan of plans) await lockEvidenceTargetOwner(tx, tenantId, plan)
  const obligations = await tx
    .select()
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        or(...plans.map(evidenceMatchPredicate)),
      ),
    )
    .orderBy(complianceObligations.id)

  if (obligations.length === 0) return { obligationIds: [] }
  const clock = await resolveComplianceClock(tx, tenantId)
  for (const obligation of obligations) {
    await materializeObligation(tx, tenantId, obligation, clock)
  }
  return { obligationIds: obligations.map((obligation) => obligation.id) }
}
