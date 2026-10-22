import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { loadSignedVersion } from '@/lib/hazid-signing-history'
import { PageContainer } from '@/components/page-layout'
import { GeneratedValue } from '@/i18n/generated'
import { SigningReview } from '../../../_signing-review'
export default async function SignedVersion({
  params,
}: {
  params: Promise<{ id: string; revision: string }>
}) {
  const { id, revision: raw } = await params,
    revision = Number(raw)
  if (!isUuid(id) || !Number.isSafeInteger(revision) || revision < 1) notFound()
  const ctx = await requireRequestContext(),
    data = await loadSignedVersion(ctx, id, revision)
  if (!data) notFound()
  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-4">
        <Link
          className="text-sm text-teal-700 underline dark:text-teal-300"
          href={`/hazard-assessments/${id}#section-signatures`}
        >
          <GeneratedValue value="Back to assessment" />
        </Link>
        <h1 className="text-xl font-semibold">
          {data.parent.reference} · <GeneratedValue value="Signing version" /> {revision}
        </h1>
        <p className="text-sm text-slate-500">
          <GeneratedValue value="Read-only copy of the content reviewed for this signing version. It does not change the current assessment." />
        </p>
        <SigningReview snapshot={data.round.snapshot} />
      </div>
    </PageContainer>
  )
}
