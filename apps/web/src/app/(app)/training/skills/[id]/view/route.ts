import { and, desc, eq, isNull, ilike, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  attachments,
  tenants,
  trainingSkillAssignmentFiles,
  trainingSkillAssignments,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { attachmentUrl } from '@/lib/attachment-url'
import { canManageModule } from '@/lib/module-admin/guard'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { skillCredentialOutputs } from '@/lib/credential-designs'
import { isRouterPrefetch } from '@/lib/router-prefetch'
import { isUuid } from '@/lib/list-params'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })
  const { id } = await params
  if (!isUuid(id)) return new Response('Skill not found.', { status: 404 })
  const ctx = await requireRequestContext()
  const result = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ assignment: trainingSkillAssignments, type: trainingSkillTypes })
      .from(trainingSkillAssignments)
      .innerJoin(
        trainingSkillTypes,
        eq(trainingSkillTypes.id, trainingSkillAssignments.skillTypeId),
      )
      .where(and(eq(trainingSkillAssignments.id, id), isNull(trainingSkillAssignments.deletedAt)))
      .limit(1)
    if (
      !row ||
      (!canManageModule(ctx, 'training') &&
        !(await canSeeRecord(ctx, tx, { prefix: 'training', personId: row.assignment.personId })))
    )
      return null
    if (row.type.viewSource === 'generated') {
      const [tenant] = await tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      const [output] = skillCredentialOutputs(row.type.credentialOutputIds, tenant?.settings)
      return {
        href: output
          ? `/training/skills/${id}/certificate?output=${encodeURIComponent(output.id)}`
          : `/training/skills/${id}?tab=outputs`,
        attachmentId: null,
      }
    }
    const [file] = await tx
      .select({ id: attachments.id })
      .from(trainingSkillAssignmentFiles)
      .innerJoin(attachments, eq(attachments.id, trainingSkillAssignmentFiles.attachmentId))
      .where(
        and(
          eq(trainingSkillAssignmentFiles.skillAssignmentId, id),
          or(
            eq(attachments.contentType, 'application/pdf'),
            ilike(attachments.contentType, 'image/%'),
            eq(trainingSkillAssignmentFiles.kind, 'certificate'),
          ),
        ),
      )
      .orderBy(desc(trainingSkillAssignmentFiles.uploadedAt))
      .limit(1)
    return {
      href:
        row.assignment.evidenceAttachmentId || file?.id
          ? attachmentUrl(row.assignment.evidenceAttachmentId ?? file!.id)
          : `/training/skills/${id}?tab=files`,
      attachmentId: row.assignment.evidenceAttachmentId ?? file?.id ?? null,
    }
  })
  if (!result) return new Response('Skill not found.', { status: 404 })
  if (result.attachmentId)
    await recordAudit(ctx, {
      entityType: 'training_skill',
      entityId: id,
      action: 'export',
      summary: 'Viewed uploaded skill credential',
      metadata: { attachmentId: result.attachmentId },
    })
  return NextResponse.redirect(new URL(result.href, request.url))
}
