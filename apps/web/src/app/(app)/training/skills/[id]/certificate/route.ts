// GET /training/skills/:id/certificate?output=certificate
//
// `:id` is a training_skill_assignments id. Resolves (or lazily creates) the
// training_skill_certificates row for the assignment, then renders the selected
// credential PDF on demand. `output` selects a saved credential design.

import { NextResponse, type NextRequest } from 'next/server'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pdfResponse, renderSkillCredentialPdf } from '@/lib/training-credential-pdf'
import { skillCertificateForAssignment } from '@/lib/training-credential-access'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: assignmentId } = await params
  if (!isUuid(assignmentId)) {
    return NextResponse.json({ error: 'Skill assignment not found.' }, { status: 404 })
  }

  const outputId = req.nextUrl.searchParams.get('output')

  const ctx = await requireRequestContext()
  const result = await skillCertificateForAssignment(ctx, assignmentId)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const rendered = await renderSkillCredentialPdf(ctx, result.certificateId, {
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
    metadata: { certificateId: result.certificateId, outputId },
  })

  return pdfResponse(rendered)
}
