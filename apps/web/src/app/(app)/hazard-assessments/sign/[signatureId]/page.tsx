import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { hazidSigningRounds } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireOwnHazidSignature, type SigningContext } from '@/lib/hazid-signing'
import { isUuid } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { GeneratedValue } from '@/i18n/generated'
import { SigningReview } from '../../_signing-review'
import { SignatureRequest, SigningWorkspaceSwitch } from '../../_signature-request'
import { PushToggle } from '@/app/(app)/notifications/preferences/_push-toggle'

export const dynamic = 'force-dynamic'
export default async function OwnSignaturePage({
  params,
  searchParams,
}: {
  params: Promise<{ signatureId: string }>
  searchParams: Promise<{ tenantId?: string }>
}) {
  const { signatureId } = await params
  if (!isUuid(signatureId)) notFound()
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) notFound()
  const { tenantId } = await searchParams
  if (tenantId && isUuid(tenantId) && ctx.tenantId !== tenantId)
    return (
      <PageContainer>
        <SigningWorkspaceSwitch tenantId={tenantId} />
      </PageContainer>
    )
  const result = await ctx.db(async (tx) => {
    try {
      const row = await requireOwnHazidSignature(ctx as SigningContext, tx, signatureId)
      const [round] = await tx
        .select()
        .from(hazidSigningRounds)
        .where(
          and(
            eq(hazidSigningRounds.assessmentId, row.assessment.id),
            eq(hazidSigningRounds.revision, row.signature.revision),
          ),
        )
        .limit(1)
      return round ? { ...row, round } : null
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('This signature request has expired'))
        return { error: error.message }
      if (error instanceof Error && error.message === 'Signature request not found') return null
      throw error
    }
  })
  if (!result) notFound()
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-5">
        {'error' in result ? (
          <p role="alert">
            <GeneratedValue value={result.error} />
          </p>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">
              <GeneratedValue value="Review and sign" /> · {result.assessment.reference}
            </h1>
            {result.signature.signedAt ? (
              <p role="status">
                <GeneratedValue value="Your signature is saved" />
              </p>
            ) : (
              <SignatureRequest
                signatureId={signatureId}
                revision={result.signature.revision}
                name={result.signature.signerName ?? 'Crew member'}
                review={<SigningReview snapshot={result.round.snapshot} />}
              />
            )}
          </>
        )}
        <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
        <Link href="/notifications" className="text-sm text-teal-700 underline dark:text-teal-300">
          <GeneratedValue value="Back to notifications" />
        </Link>
      </div>
    </PageContainer>
  )
}
