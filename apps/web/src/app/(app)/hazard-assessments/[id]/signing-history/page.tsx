import Link from 'next/link'
import { and, count, desc, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import {
  hazidAssessments,
  hazidAssessmentSignatures,
  hazidSigningRounds,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { attachmentUrl } from '@/lib/attachment-url'
import {
  isUuid,
  mergeHref,
  parseListParams,
  parsePrefixedListParams,
  pickString,
} from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { RawImage } from '@/components/raw-image'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { SigningReview } from '../../_signing-review'

export const dynamic = 'force-dynamic'
export default async function SigningHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { id } = await params,
    sp = await searchParams
  if (!isUuid(id)) notFound()
  const ctx = await requireRequestContext()
  const list = parseListParams(sp, { sort: 'revision', allowedSorts: ['revision'], perPage: 10 })
  const crewList = parsePrefixedListParams(sp, 'signature', {
    sort: 'signedAt',
    allowedSorts: ['signedAt'],
    perPage: 10,
  })
  const data = await ctx.db(async (tx) => {
    const [parent] = await tx
      .select()
      .from(hazidAssessments)
      .where(and(eq(hazidAssessments.id, id), isNull(hazidAssessments.deletedAt)))
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
    const where = and(
      eq(hazidSigningRounds.assessmentId, id),
      list.q
        ? ilike(
            sql`'Revision ' || ${hazidSigningRounds.revision}::text`,
            `%${list.q.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
      sp.status === 'current'
        ? eq(hazidSigningRounds.revision, parent.signingRevision)
        : sp.status === 'previous'
          ? sql`${hazidSigningRounds.revision} < ${parent.signingRevision}`
          : undefined,
    )
    const [total] = await tx.select({ n: count() }).from(hazidSigningRounds).where(where)
    const rounds = await tx
      .select({
        revision: hazidSigningRounds.revision,
        createdAt: hazidSigningRounds.createdAt,
        endedAt: hazidSigningRounds.endedAt,
      })
      .from(hazidSigningRounds)
      .where(where)
      .orderBy(desc(hazidSigningRounds.revision))
      .limit(list.perPage)
      .offset((list.page - 1) * list.perPage)
    const selectedRevision = Number(pickString(sp.revision) ?? rounds[0]?.revision)
    const [selected] = Number.isInteger(selectedRevision)
      ? await tx
          .select()
          .from(hazidSigningRounds)
          .where(
            and(
              eq(hazidSigningRounds.assessmentId, id),
              eq(hazidSigningRounds.revision, selectedRevision),
            ),
          )
          .limit(1)
      : []
    const signatureWhere = selected
      ? and(
          eq(hazidAssessmentSignatures.assessmentId, id),
          eq(hazidAssessmentSignatures.revision, selected.revision),
          crewList.q
            ? ilike(
                sql`coalesce(${hazidAssessmentSignatures.signerName}, ${hazidAssessmentSignatures.externalName}, 'Crew member')`,
                `%${crewList.q.replace(/[\\%_]/g, '\\$&')}%`,
              )
            : undefined,
          sp.signatureStatus === 'signed'
            ? isNotNull(hazidAssessmentSignatures.signatureAttachmentId)
            : sp.signatureStatus === 'unsigned'
              ? isNull(hazidAssessmentSignatures.signatureAttachmentId)
              : undefined,
        )
      : undefined
    const signatures = selected
      ? await tx
          .select()
          .from(hazidAssessmentSignatures)
          .where(signatureWhere)
          .orderBy(desc(hazidAssessmentSignatures.signedAt), hazidAssessmentSignatures.id)
          .limit(crewList.perPage)
          .offset((crewList.page - 1) * crewList.perPage)
      : []
    const [signatureTotal] = selected
      ? await tx.select({ n: count() }).from(hazidAssessmentSignatures).where(signatureWhere)
      : []
    return {
      parent,
      total: total?.n ?? 0,
      rounds,
      selected,
      signatures,
      signatureTotal: signatureTotal?.n ?? 0,
    }
  })
  if (!data) notFound()
  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-2xl font-semibold">
          <GeneratedValue value="Signing history" /> · {data.parent.reference}
        </h1>
        <Link
          href={`/hazard-assessments/${id}` as any}
          className="text-teal-700 underline dark:text-teal-300"
        >
          <GeneratedValue value="Return to assessment" />
        </Link>
        <div className="flex flex-wrap gap-2">
          <SearchInput placeholder={tGeneratedValue('Search revisions…')} />
          <Link
            href={
              mergeHref(`/hazard-assessments/${id}/signing-history`, sp, {
                status: null,
                page: null,
              }) as any
            }
          >
            <GeneratedValue value="All" />
          </Link>
          <Link
            href={
              mergeHref(`/hazard-assessments/${id}/signing-history`, sp, {
                status: 'current',
                page: null,
              }) as any
            }
          >
            <GeneratedValue value="Current revision" />
          </Link>
          <Link
            href={
              mergeHref(`/hazard-assessments/${id}/signing-history`, sp, {
                status: 'previous',
                page: null,
              }) as any
            }
          >
            <GeneratedValue value="Previous revisions" />
          </Link>
        </div>
        {!data.rounds.length ? (
          <p>
            <GeneratedValue value="No signing revisions yet." />
          </p>
        ) : (
          <ul className="space-y-2">
            {data.rounds.map((round) => (
              <li key={round.revision}>
                <Link
                  href={
                    mergeHref(`/hazard-assessments/${id}/signing-history`, sp, {
                      revision: round.revision,
                      signaturePage: null,
                    }) as any
                  }
                  className="block rounded border p-3 dark:border-slate-700"
                >
                  <GeneratedValue value="Revision" /> {round.revision} ·{' '}
                  {round.createdAt.toLocaleString(ctx.locale, { timeZone: ctx.timezone })} ·{' '}
                  <GeneratedValue
                    value={round.endedAt ? 'Previous revision' : 'Current revision'}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination
          basePath={`/hazard-assessments/${id}/signing-history`}
          currentParams={sp}
          total={data.total}
          page={list.page}
          perPage={list.perPage}
        />
        {data.selected ? (
          <>
            <h2 className="text-xl font-semibold">
              <GeneratedValue value="Revision" /> {data.selected.revision}
            </h2>
            <SigningReview snapshot={data.selected.snapshot} />
            <section className="space-y-3">
              <h3 className="font-semibold">
                <GeneratedValue value="Crew signatures" />
              </h3>
              <div className="flex flex-wrap gap-3">
                <SearchInput
                  placeholder={tGeneratedValue('Search crew…')}
                  paramKey="signatureQ"
                  pageParamKey="signaturePage"
                />
                {(['all', 'signed', 'unsigned'] as const).map((status) => (
                  <Link
                    key={status}
                    href={
                      mergeHref(`/hazard-assessments/${id}/signing-history`, sp, {
                        signatureStatus: status === 'all' ? null : status,
                        signaturePage: null,
                      }) as any
                    }
                    className="text-sm underline"
                  >
                    <GeneratedValue
                      value={status === 'all' ? 'All' : status === 'signed' ? 'Signed' : 'Unsigned'}
                    />
                  </Link>
                ))}
              </div>
              {!data.signatures.length ? (
                <p>
                  <GeneratedValue value="No matching crew members." />
                </p>
              ) : null}
              {data.signatures.map((row) => (
                <div key={row.id} className="rounded border p-3 dark:border-slate-700">
                  <p className="font-medium">
                    {row.signerName ?? row.externalName ?? <GeneratedValue value="Crew member" />}
                  </p>
                  {row.signatureAttachmentId ? (
                    <RawImage
                      optimizationReason="authenticated"
                      src={attachmentUrl(row.signatureAttachmentId)}
                      alt={tGeneratedValue('Signature')}
                      className="h-16 max-w-full object-contain dark:bg-white"
                    />
                  ) : (
                    <p>
                      <GeneratedValue value="Unsigned" />
                    </p>
                  )}
                  {row.signedAt ? (
                    <p className="text-xs text-slate-500">
                      {row.signedAt.toLocaleString(ctx.locale, { timeZone: ctx.timezone })}
                    </p>
                  ) : null}
                </div>
              ))}
              <Pagination
                basePath={`/hazard-assessments/${id}/signing-history`}
                currentParams={sp}
                total={data.signatureTotal}
                page={crewList.page}
                perPage={crewList.perPage}
                pageParamKey="signaturePage"
              />
            </section>
          </>
        ) : null}
      </div>
    </PageContainer>
  )
}
