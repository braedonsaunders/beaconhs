// GET /training/skills/:id/certificate?format=cert|wallet[&json=1]
//
// `:id` is a training_skill_assignments id. Resolves (or lazily creates) the
// training_skill_certificates row for the assignment, then behaves exactly
// like the training-record certificate route:
//   - 307 redirect to a signed GET URL on the latest PDF (cert by default)
//   - 202 if no PDF exists yet and a render job has been enqueued
//   - `json=1` returns { status: 'ready', url } / { status: 'pending' } for
//     polling clients instead of redirecting.

import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, like } from 'drizzle-orm'
import {
  attachments,
  trainingSkillAssignments,
  trainingSkillCertificates,
} from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { requestSkillCertificatePdf } from '@/lib/pdf-actions'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: assignmentId } = await params
  const format = (req.nextUrl.searchParams.get('format') ?? 'cert').toLowerCase()
  const wantWallet = format === 'wallet'
  const wantJson = req.nextUrl.searchParams.get('json') === '1'

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

    if (wantWallet) {
      const [wallet] = await tx
        .select({ att: attachments })
        .from(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId!),
            eq(attachments.contentType, 'application/pdf'),
            like(attachments.r2Key, `pdfs/skill-certificates/${cert.id}-wallet-%`),
          ),
        )
        .orderBy(desc(attachments.createdAt))
        .limit(1)
      return { cert, latestAttachment: wallet?.att ?? null } as const
    }

    if (cert.pdfAttachmentId) {
      const [att] = await tx
        .select()
        .from(attachments)
        .where(eq(attachments.id, cert.pdfAttachmentId))
        .limit(1)
      return { cert, latestAttachment: att ?? null } as const
    }
    return { cert, latestAttachment: null } as const
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  if (result.latestAttachment) {
    const url = await presignGet({ key: result.latestAttachment.r2Key, expiresInSeconds: 300 })
    if (wantJson) return NextResponse.json({ status: 'ready', url })
    return NextResponse.redirect(url, { status: 307 })
  }

  const enq = await requestSkillCertificatePdf(result.cert.id)
  if (!enq.ok) {
    return NextResponse.json({ error: enq.error }, { status: 400 })
  }
  if (wantJson) return NextResponse.json({ status: 'pending' }, { headers: { 'Retry-After': '5' } })
  return new NextResponse('Certificate is being generated. Refresh in a few seconds.', {
    status: 202,
    headers: {
      'Retry-After': '5',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
