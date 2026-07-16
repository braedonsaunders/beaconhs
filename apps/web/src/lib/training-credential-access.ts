import { eq } from 'drizzle-orm'
import { trainingRecords, trainingSkillAssignments } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { canManageModule } from '@/lib/module-admin/guard'
import { canSeeRecord } from '@/lib/visibility'
import {
  issueTrainingCertificate,
  issueTrainingSkillCertificate,
} from '@/lib/training-certificate-issuance'

type CredentialAccessResult = { certificateId: string } | { error: string; status: 400 | 404 | 409 }

const TRAINING_CREDENTIAL_DESIGN_PERMISSION = 'training.course.manage'

export function canDesignTrainingCredentials(ctx: RequestContext): boolean {
  return (
    ctx.isSuperAdmin ||
    can(ctx, TRAINING_CREDENTIAL_DESIGN_PERMISSION) ||
    can(ctx, 'admin.settings.manage')
  )
}

export async function trainingCertificateForRecord(
  ctx: RequestContext,
  recordId: string,
): Promise<CredentialAccessResult> {
  if (!ctx.tenantId) return { error: 'No active tenant', status: 400 }
  return ctx.db(async (tx) => {
    const [record] = await tx
      .select({ personId: trainingRecords.personId, deletedAt: trainingRecords.deletedAt })
      .from(trainingRecords)
      .where(eq(trainingRecords.id, recordId))
      .limit(1)
    if (!record) return { error: 'Training record not found.', status: 404 }
    if (!(await canSeeRecord(ctx, tx, { prefix: 'training', personId: record.personId }))) {
      return { error: 'Training record not found.', status: 404 }
    }
    if (record.deletedAt) {
      return {
        error: 'This record has been revoked; the certificate is no longer valid.',
        status: 409,
      }
    }
    const certificate = await issueTrainingCertificate(tx, { tenantId: ctx.tenantId!, recordId })
    if (certificate.revokedAt) {
      return {
        error: 'This certificate has been revoked and can no longer be downloaded.',
        status: 409,
      }
    }
    return { certificateId: certificate.id }
  })
}

export async function skillCertificateForAssignment(
  ctx: RequestContext,
  assignmentId: string,
): Promise<CredentialAccessResult> {
  if (!ctx.tenantId) return { error: 'No active tenant', status: 400 }
  return ctx.db(async (tx) => {
    const [assignment] = await tx
      .select({
        personId: trainingSkillAssignments.personId,
        deletedAt: trainingSkillAssignments.deletedAt,
      })
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, assignmentId))
      .limit(1)
    if (!assignment) return { error: 'Skill assignment not found.', status: 404 }
    const visible =
      canManageModule(ctx, 'training') ||
      (await canSeeRecord(ctx, tx, { prefix: 'training', personId: assignment.personId }))
    if (!visible) return { error: 'Skill assignment not found.', status: 404 }
    if (assignment.deletedAt) {
      return {
        error: 'This skill has been revoked; the credential is no longer valid.',
        status: 409,
      }
    }
    const certificate = await issueTrainingSkillCertificate(tx, {
      tenantId: ctx.tenantId!,
      skillAssignmentId: assignmentId,
    })
    if (certificate.revokedAt) {
      return {
        error: 'This certificate has been revoked and can no longer be downloaded.',
        status: 409,
      }
    }
    return { certificateId: certificate.id }
  })
}
