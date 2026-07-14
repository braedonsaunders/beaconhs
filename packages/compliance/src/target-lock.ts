import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceObligations,
  documents,
  equipmentTypes,
  formTemplates,
  inspectionTypes,
  personTitles,
  ppeTypes,
  trainingAssessmentTypes,
  trainingCourses,
  trainingSkillTypes,
  type ComplianceTargetRef,
} from '@beaconhs/db/schema'

type ComplianceSourceModule = typeof complianceObligations.$inferSelect.sourceModule

type TargetEntity =
  | 'inspection_type'
  | 'document'
  | 'course'
  | 'assessment_type'
  | 'skill_type'
  | 'form_template'
  | 'equipment_type'
  | 'ppe_type'
  | 'job_title'

export type ComplianceTargetLockPlan = {
  entity: TargetEntity
  id: string
  label: string
}

export class ComplianceTargetError extends Error {
  override readonly name = 'ComplianceTargetError'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function target(
  entity: TargetEntity,
  id: string | undefined,
  label: string,
): ComplianceTargetLockPlan {
  if (!id || !UUID.test(id)) throw new ComplianceTargetError(`Pick a valid ${label}`)
  return { entity, id, label }
}

/**
 * Reduce a polymorphic JSON target to the single row that owns its lifecycle.
 * Keeping this pure gives create/update/enable and deletion-side guards one
 * canonical interpretation of every authorable obligation target.
 */
export function planComplianceTargetLock(
  sourceModule: ComplianceSourceModule,
  ref: ComplianceTargetRef,
): ComplianceTargetLockPlan | null {
  switch (sourceModule) {
    case 'inspection':
      return target('inspection_type', ref.inspectionTypeId, 'inspection type')
    case 'document':
      return target('document', ref.documentId, 'document')
    case 'training': {
      const assessment = ref.trainingItemKind === 'assessment_type' || Boolean(ref.assessmentTypeId)
      if (assessment) {
        if (ref.courseId) throw new ComplianceTargetError('Training target is ambiguous')
        return target('assessment_type', ref.assessmentTypeId, 'assessment type')
      }
      if (ref.assessmentTypeId) throw new ComplianceTargetError('Training target is ambiguous')
      return target('course', ref.courseId, 'course')
    }
    case 'cert_requirement':
      if (ref.skillTypeId && ref.courseId)
        throw new ComplianceTargetError('Certification target is ambiguous')
      return ref.skillTypeId
        ? target('skill_type', ref.skillTypeId, 'skill type')
        : target('course', ref.courseId, 'course')
    case 'form':
      return target('form_template', ref.formTemplateId, 'app')
    case 'equipment_inspection':
      return target('equipment_type', ref.equipmentTypeId, 'equipment type')
    case 'ppe_inspection':
      return target('ppe_type', ref.ppeTypeId, 'PPE type')
    case 'job_title_signoff':
      return target('job_title', ref.jobTitleId, 'job title')
    case 'journal':
    case 'hazard_assessment':
    case 'corrective_action':
      return null
  }
}

async function unavailable(row: { id: string } | undefined, label: string): Promise<void> {
  if (!row) throw new ComplianceTargetError(`The selected ${label} is no longer available`)
}

/**
 * Validate and lock an obligation target inside the caller's transaction.
 * Deletion/archive paths must acquire FOR UPDATE on the same owner row before
 * checking for active obligations, closing the polymorphic JSON reference race.
 */
export async function lockComplianceTarget(
  tx: Database,
  tenantId: string,
  sourceModule: ComplianceSourceModule,
  ref: ComplianceTargetRef,
): Promise<void> {
  const plan = planComplianceTargetLock(sourceModule, ref)
  if (!plan) return

  switch (plan.entity) {
    case 'inspection_type': {
      const [row] = await tx
        .select({ id: inspectionTypes.id })
        .from(inspectionTypes)
        .where(
          and(
            eq(inspectionTypes.tenantId, tenantId),
            eq(inspectionTypes.id, plan.id),
            eq(inspectionTypes.isPublished, true),
            isNull(inspectionTypes.deletedAt),
          ),
        )
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'document': {
      const [row] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, tenantId),
            eq(documents.id, plan.id),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'course': {
      const [row] = await tx
        .select({ id: trainingCourses.id })
        .from(trainingCourses)
        .where(
          and(
            eq(trainingCourses.tenantId, tenantId),
            eq(trainingCourses.id, plan.id),
            isNull(trainingCourses.deletedAt),
          ),
        )
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'assessment_type': {
      const [row] = await tx
        .select({ id: trainingAssessmentTypes.id })
        .from(trainingAssessmentTypes)
        .where(
          and(
            eq(trainingAssessmentTypes.tenantId, tenantId),
            eq(trainingAssessmentTypes.id, plan.id),
            eq(trainingAssessmentTypes.active, true),
            isNull(trainingAssessmentTypes.deletedAt),
          ),
        )
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'skill_type': {
      const [row] = await tx
        .select({ id: trainingSkillTypes.id })
        .from(trainingSkillTypes)
        .where(and(eq(trainingSkillTypes.tenantId, tenantId), eq(trainingSkillTypes.id, plan.id)))
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'form_template': {
      const [row] = await tx
        .select({ id: formTemplates.id })
        .from(formTemplates)
        .where(
          and(
            eq(formTemplates.tenantId, tenantId),
            eq(formTemplates.id, plan.id),
            eq(formTemplates.status, 'published'),
            isNull(formTemplates.deletedAt),
          ),
        )
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'equipment_type': {
      const [row] = await tx
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(and(eq(equipmentTypes.tenantId, tenantId), eq(equipmentTypes.id, plan.id)))
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'ppe_type': {
      const [row] = await tx
        .select({ id: ppeTypes.id })
        .from(ppeTypes)
        .where(and(eq(ppeTypes.tenantId, tenantId), eq(ppeTypes.id, plan.id)))
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
    case 'job_title': {
      const [row] = await tx
        .select({ id: personTitles.id })
        .from(personTitles)
        .where(
          and(
            eq(personTitles.tenantId, tenantId),
            eq(personTitles.id, plan.id),
            isNull(personTitles.deletedAt),
          ),
        )
        .limit(1)
        .for('key share')
      return unavailable(row, plan.label)
    }
  }
}
