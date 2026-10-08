import { and, asc, eq, isNull } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { assertCan } from '@beaconhs/tenant'
import {
  hazidAssessments,
  hazidAssessmentSignatures,
  hazidSigningRounds,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { isUuid } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { SigningReview } from '../../_signing-review'
import { SigningPad } from '../../_signing-pad'
import { GeneratedValue } from '@/i18n/generated'

export const dynamic = 'force-dynamic'
export default async function CollectSignaturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ signer?: string }>
}) {
  const { id } = await params,
    { signer } = await searchParams
  if (!isUuid(id)) notFound()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'hazid.update')
  const result = await ctx.db(async (tx) => {
    const [parent] = await tx
      .select()
      .from(hazidAssessments)
      .where(
        and(
          eq(hazidAssessments.tenantId, ctx.tenantId),
          eq(hazidAssessments.id, id),
          isNull(hazidAssessments.deletedAt),
        ),
      )
      .limit(1)
    if (
      !parent ||
      !(await canSeeRecord(ctx, tx, {
        prefix: 'hazid',
        ownerIds: [parent.reportedByTenantUserId],
        siteId: parent.siteOrgUnitId,
      }))
    )
      return null
    const [round] = await tx
      .select()
      .from(hazidSigningRounds)
      .where(
        and(
          eq(hazidSigningRounds.assessmentId, id),
          eq(hazidSigningRounds.revision, parent.signingRevision),
        ),
      )
      .limit(1)
    if (!round || !parent.signingFrozenAt || parent.locked)
      return { parent, round: null, signers: [] }
    const rows = await tx
      .select({ row: hazidAssessmentSignatures, person: people })
      .from(hazidAssessmentSignatures)
      .leftJoin(people, eq(people.id, hazidAssessmentSignatures.personId))
      .where(
        and(
          eq(hazidAssessmentSignatures.assessmentId, id),
          eq(hazidAssessmentSignatures.revision, parent.signingRevision),
          isNull(hazidAssessmentSignatures.signatureAttachmentId),
        ),
      )
      .orderBy(asc(hazidAssessmentSignatures.createdAt))
      .limit(250)
    const signers = rows
      .filter((r) => !r.row.personId || (r.person?.status === 'active' && !r.person.deletedAt))
      .map((r) => ({
        id: r.row.id,
        name:
          r.row.signerName ??
          r.row.externalName ??
          `${r.person?.firstName ?? ''} ${r.person?.lastName ?? ''}`,
      }))
    if (signer) signers.sort((a, b) => Number(b.id === signer) - Number(a.id === signer))
    return { parent, round, signers }
  })
  if (!result) notFound()
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">
          <GeneratedValue value="Collect crew signatures" /> · {result.parent.reference}
        </h1>
        {result.round ? (
          <SigningPad
            assessmentId={id}
            revision={result.parent.signingRevision}
            signers={result.signers}
            review={<SigningReview snapshot={result.round.snapshot} />}
          />
        ) : (
          <p>
            <GeneratedValue value="This signing round is closed or has not started. Return to the assessment to start collection." />
          </p>
        )}
        <Link
          href={`/hazard-assessments/${id}` as any}
          className="text-sm text-teal-700 underline dark:text-teal-300"
        >
          <GeneratedValue value="Return to assessment" />
        </Link>
      </div>
    </PageContainer>
  )
}
