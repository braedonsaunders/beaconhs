// GET /training/skills/:id/certificate?output=certificate
//
// `:id` is a training_skill_assignments id. Resolves (or lazily creates) the
// training_skill_certificates row for the assignment, then renders the selected
// credential PDF on demand. `output` selects a saved credential design.

import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { trainingSkillAssignments } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { issueTrainingSkillCertificate } from '@/lib/training-certificate-issuance'
import { pdfResponse, renderSkillCredentialPdf } from '@/lib/training-credential-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: assignmentId } = await params
  const outputId = req.nextUrl.searchParams.get('output')

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const result = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select({
        id: trainingSkillAssignments.id,
        personId: trainingSkillAssignments.personId,
        deletedAt: trainingSkillAssignments.deletedAt,
      })
      .from(trainingSkillAssignments)
      .where(eq(trainingSkillAssignments.id, assignmentId))
      .limit(1)
    if (!assignment) return { error: 'Skill assignment not found.', status: 404 } as const

    // Same per-record visibility gate as the training-record certificate route:
    // managers and read.all see any credential; everyone else only their own.
    // Without this any authenticated user could download (and lazily issue)
    // anyone's credential PDF by guessing the assignment id.
    const visible =
      canManageModule(ctx, 'training') ||
      (await canSeeRecord(ctx, tx, { prefix: 'training', personId: assignment.personId }))
    if (!visible) return { error: 'Skill assignment not found.', status: 404 } as const

    // A revoked skill must not produce a fresh, valid-looking credential —
    // whether or not a certificate row was already issued.
    if (assignment.deletedAt) {
      return {
        error: 'This skill has been revoked; the credential is no longer valid.',
        status: 409,
      } as const
    }

    const cert = await issueTrainingSkillCertificate(tx, {
      tenantId: ctx.tenantId,
      skillAssignmentId: assignmentId,
    })
    if (cert.revokedAt) {
      return {
        error: 'This certificate has been revoked and can no longer be downloaded.',
        status: 409,
      } as const
    }

    return { cert } as const
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const rendered = await renderSkillCredentialPdf(ctx, result.cert.id, {
    outputId,
  })
  if (!rendered) {
    return NextResponse.json({ error: 'Skill certificate not found.' }, { status: 404 })
  }

  // Credential PDFs are personal-data exports — audit them like the CSV routes.
  await recordAudit(ctx, {
    entityType: 'training_skill',
    entityId: assignmentId,
    action: 'export',
    summary: 'Downloaded skill credential PDF',
    metadata: { certificateId: result.cert.id, outputId },
  })

  return pdfResponse(rendered)
}
