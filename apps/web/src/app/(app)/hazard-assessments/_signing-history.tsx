import Link from 'next/link'
import type { RequestContext } from '@beaconhs/tenant'
import { GeneratedValue } from '@/i18n/generated'
import { FilterChips } from '@/components/filter-bar'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { RawImage } from '@/components/raw-image'
import { loadSigningHistory } from '@/lib/hazid-signing-history'
import { formatDateTime } from '@/lib/datetime'
export async function SigningHistory({
  ctx,
  assessmentId,
  params,
}: {
  ctx: RequestContext
  assessmentId: string
  params: Record<string, string | string[] | undefined>
}) {
  const t = await getGeneratedValueTranslations()
  const data = await loadSigningHistory(ctx, assessmentId, params)
  if (!data || data.revision === 1) return null
  return (
    <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer font-medium">
        <GeneratedValue value="Previous signatures" />
      </summary>
      <p className="my-3 text-sm text-slate-500">
        <GeneratedValue value="These signatures belong to earlier versions. They do not sign off the current job content." />
      </p>
      <div className="mb-3 flex gap-2">
        <SearchInput
          paramKey="signHistoryQ"
          pageParamKey="signHistoryPage"
          placeholder={t('Search previous signers…')}
        />
        <FilterChips
          basePath={`/hazard-assessments/${assessmentId}`}
          currentParams={params}
          paramKey="signHistoryRevision"
          pageParamKey="signHistoryPage"
          label={t('Signing version')}
          options={Array.from({ length: data.revision - 1 }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
        />
      </div>
      <div className="space-y-2">
        {data.rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2 dark:border-slate-800"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{row.signerName ?? row.externalName}</p>
              <p className="text-xs text-slate-500">
                {row.signedAt ? formatDateTime(row.signedAt, ctx.timezone, ctx.locale) : '—'}
              </p>
            </div>
            <RawImage
              src={row.image}
              alt={t('Signature')}
              optimizationReason="authenticated"
              className="h-12 w-28 rounded bg-white object-contain"
            />
            {row.snapshotAvailable ? (
              <Link
                className="text-sm text-teal-700 underline dark:text-teal-300"
                href={`/hazard-assessments/${assessmentId}/signing/${row.revision}`}
              >
                <GeneratedValue value="View signed version" /> {row.revision}
              </Link>
            ) : (
              <span className="text-xs text-slate-500">
                <GeneratedValue value="Signing version" /> {row.revision} ·{' '}
                <GeneratedValue value="Earlier content snapshot unavailable" />
              </span>
            )}
          </div>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <p className="py-3 text-sm text-slate-500">
          <GeneratedValue value="No previous signatures match." />
        </p>
      ) : null}
      <Pagination
        basePath={`/hazard-assessments/${assessmentId}`}
        currentParams={params}
        total={data.total}
        page={data.page}
        perPage={data.perPage}
        pageParamKey="signHistoryPage"
      />
    </details>
  )
}
