// GET /training/skills/:id/certificate?output=certificate
//
// `:id` is a training_skill_assignments id. Resolves (or lazily creates) the
// training_skill_certificates row for the assignment, then renders the selected
// credential PDF on demand. `output` selects a saved credential design;
// `format=wallet|cert` is retained for legacy links.

import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { trainingSkillAssignments, trainingSkillCertificates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import {
  pdfResponse,
  renderSkillCredentialPdf,
  type CredentialPdfFormat,
} from '@/lib/training-credential-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: assignmentId } = await params
  const format = (req.nextUrl.searchParams.get('format') ?? 'cert').toLowerCase()
  const pdfFormat: CredentialPdfFormat = format === 'wallet' ? 'wallet' : 'cert'
  const outputId = req.nextUrl.searchParams.get('output')

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const result = await ctx.db(async (tx) => {
    let [cert] = await tx
      .select()
      .from(trainingSkillCertificates)
      .where(eq(trainingSkillCertificates.skillAssignmentId, assignmentId))
      .orderBy(desc(trainingSkillCertificates.createdAt))
      .limit(1)

    if (!cert) {
      const [assignment] = await tx
        .select({ id: trainingSkillAssignments.id })
        .from(trainingSkillAssignments)
        .where(eq(trainingSkillAssignments.id, assignmentId))
        .limit(1)
      if (!assignment) return { error: 'Skill assignment not found.', status: 404 } as const
      const [created] = await tx
        .insert(trainingSkillCertificates)
        .values({
          tenantId: ctx.tenantId!,
          skillAssignmentId: assignmentId,
          verifyToken: randomBytes(20).toString('hex'),
        })
        .returning()
      cert = created
    }
    if (!cert) return { error: 'Failed to issue certificate.', status: 500 } as const

    return { cert } as const
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const rendered = await renderSkillCredentialPdf(ctx, result.cert.id, {
    outputId,
    format: pdfFormat,
  })
  if (!rendered) {
    return NextResponse.json({ error: 'Skill certificate not found.' }, { status: 404 })
  }
  return pdfResponse(rendered)
}
