import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { hazidSigningRounds } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { loadOwnSigningRequest } from '@/lib/hazid-signing-request'
import { isUuid } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { GeneratedValue } from '@/i18n/generated'
import { SigningReview } from '../../_signing-review'
import {
  SignatureRequest,
  SigningWorkspaceSwitch,
  CurrentSigningRequest,
} from '../../_signature-request'
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
    const request = await loadOwnSigningRequest(ctx, tx, signatureId)
    if (request.kind !== 'ready') return request
    const [round] = await tx
      .select()
      .from(hazidSigningRounds)
      .where(
        and(
          eq(hazidSigningRounds.tenantId, ctx.tenantId),
          eq(hazidSigningRounds.assessmentId, request.assessment.id),
          eq(hazidSigningRounds.revision, request.signature.revision),
        ),
      )
      .limit(1)
    return round ? { ...request, round } : { kind: 'unavailable' as const }
  })
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-5">
        {result.kind === 'changed' ? (
          <CurrentSigningRequest signatureId={signatureId} />
        ) : result.kind === 'ready' ? (
          <>
            <h1 className="text-2xl font-semibold">
              <GeneratedValue value="Review and sign" /> · {result.assessment.reference}
            </h1>
            <SignatureRequest
              signatureId={signatureId}
              revision={result.signature.revision}
              name={result.signature.signerName ?? 'Crew member'}
              review={<SigningReview snapshot={result.round.snapshot} />}
            />
          </>
        ) : (
          <p role="status">
            <GeneratedValue
              value={
                result.kind === 'signed'
                  ? 'Your signature is saved'
                  : result.kind === 'expired'
                    ? 'This signature request has expired. Ask the supervisor to resend it.'
                    : result.kind === 'removed'
                      ? 'You are no longer in the crew for the current JSA. Contact the supervisor.'
                      : 'This signing request is unavailable. Sign in with the account that received it, or ask the supervisor for a new request.'
              }
            />
          </p>
        )}
        <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
        <Link href="/notifications" className="text-sm text-teal-700 underline dark:text-teal-300">
          <GeneratedValue value="Back to notifications" />
        </Link>
      </div>
    </PageContainer>
  )
}
