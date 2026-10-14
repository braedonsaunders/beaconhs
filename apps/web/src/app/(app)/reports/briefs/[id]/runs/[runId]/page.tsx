import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Bot, Download, Loader2 } from 'lucide-react'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { briefRunDeliveries, tenantUsers } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { BriefView } from '@/components/briefs/brief-view'
import { DeliveryStatusTable } from '@/components/delivery-status-table'
import { DetailGrid } from '@/components/detail-grid'
import { DownloadLink } from '@/components/download-link'
import { DetailPageLayout } from '@/components/page-layout'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { canReadBriefs } from '@/lib/briefs/access'
import { loadBriefRun } from '@/lib/briefs/data'
import { BRIEF_RUN_STATUS_LABEL, BRIEF_RUN_TRIGGER_LABEL } from '@/lib/briefs/labels'

export const dynamic = 'force-dynamic'

export default async function BriefRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const { id, runId } = await params
  if (!isUuid(id) || !isUuid(runId)) notFound()
  const ctx = await requireRequestContext()
  if (!canReadBriefs(ctx)) redirect('/reports')
  const row = await loadBriefRun(ctx, id, runId)
  if (!row) notFound()
  const sp = await searchParams
  const { run } = row
  const [deliveries, members] = await Promise.all([
    ctx.db((tx) =>
      tx
        .select({
          id: briefRunDeliveries.id,
          recipientEmail: briefRunDeliveries.recipientEmail,
          status: briefRunDeliveries.status,
          error: briefRunDeliveries.error,
          sentAt: briefRunDeliveries.sentAt,
        })
        .from(briefRunDeliveries)
        .where(eq(briefRunDeliveries.runId, run.id))
        .orderBy(asc(briefRunDeliveries.recipientEmail)),
    ),
    ctx.db((tx) =>
      run.runAsTenantUserId
        ? tx
            .select({ name: tenantUsers.displayName })
            .from(tenantUsers)
            .where(eq(tenantUsers.id, run.runAsTenantUserId))
            .limit(1)
        : Promise.resolve([]),
    ),
  ])
  const meta = run.aiMeta
  const numberFormat = new Intl.NumberFormat(ctx.locale)
  const base = `/reports/briefs/${id}/runs/${runId}`
  const askHref = `/assistant?q=${encodeURIComponent(
    `Read brief run ${run.id} ("${run.briefName}", ${run.windowLabel}) and help me act on it.`,
  )}`
  const inProgress = run.status === 'queued' || run.status === 'running'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: `/reports/briefs/${id}?tab=runs`, label: tGenerated('m_0e68dfee553cdb') }}
          title={run.briefName}
          subtitle={`${run.windowLabel}${row.departmentName ? ` · ${row.departmentName}` : ''}`}
          actions={
            <div className="flex flex-wrap gap-2">
              {run.status === 'succeeded' && can(ctx, 'assistant.use') ? (
                <Link href={askHref as never}>
                  <Button variant="outline">
                    <Bot size={14} /> <GeneratedText id="m_0163d9a28c0d78" />
                  </Button>
                </Link>
              ) : null}
              {run.status === 'succeeded' ? (
                <DownloadLink href={`${base}/pdf`} target="_blank" rel="noopener noreferrer">
                  <Button>
                    <Download size={14} /> <GeneratedText id="m_1a2b2ed6729166" />
                  </Button>
                </DownloadLink>
              ) : null}
            </div>
          }
        />
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="space-y-4">
          {run.status === 'failed' ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <GeneratedValue value={run.error ?? 'The brief could not be written.'} />
            </p>
          ) : null}
          {inProgress ? (
            <p className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <Loader2 size={14} className="animate-spin" />
              <GeneratedText id="m_0c3baf0fcd4002" />
            </p>
          ) : null}
          {run.result && run.evidence ? (
            <Card>
              <CardContent className="pt-5">
                <BriefView result={run.result} evidence={run.evidence} />
              </CardContent>
            </Card>
          ) : null}
          {run.delivery || deliveries.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_03db87cb2e7846" />
              </h2>
              <DeliveryStatusTable
                rows={deliveries}
                basePath={base}
                currentParams={sp}
                timezone={ctx.timezone}
                locale={ctx.locale}
              />
            </section>
          ) : null}
        </div>
        <div className="space-y-4">
          <DetailGrid
            className="sm:grid-cols-1"
            rows={[
              { label: 'Status', value: BRIEF_RUN_STATUS_LABEL[run.status] },
              { label: 'Trigger', value: BRIEF_RUN_TRIGGER_LABEL[run.trigger] },
              ...(row.scheduleName ? [{ label: 'Schedule', value: row.scheduleName }] : []),
              { label: 'Covers', value: `${run.windowLabel} (${run.timezone})` },
              { label: 'Reads data as', value: members[0]?.name ?? '—' },
              {
                label: 'Finished',
                value: run.finishedAt
                  ? formatDateTime(run.finishedAt, ctx.timezone, ctx.locale)
                  : '—',
              },
            ]}
          />
          {meta ? (
            <DetailGrid
              className="sm:grid-cols-1"
              rows={[
                { label: 'Model', value: meta.model ? `${meta.model} (${meta.tier})` : '—' },
                {
                  label: 'Tokens',
                  value: tGenerated('m_079317a8c23fe3', {
                    value0: numberFormat.format(meta.inputTokens),
                    value1: numberFormat.format(meta.outputTokens),
                  }),
                },
                { label: 'Writing passes', value: String(meta.passes) },
                {
                  label: 'Citations removed',
                  value: tGenerated('m_1a89d211380678', {
                    value0: numberFormat.format(meta.droppedCitations),
                    value1: numberFormat.format(meta.uncitedBullets),
                  }),
                },
                { label: 'Brief version', value: String(meta.specVersion) },
              ]}
            />
          ) : null}
          {run.evidence ? (
            <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_117f952b9de016" />
              </h2>
              <ul className="space-y-1">
                {run.evidence.sources.map((source) => (
                  <li key={source.key} className="flex justify-between gap-2">
                    <GeneratedValue value={source.label} />
                    <span className="text-slate-600 tabular-nums dark:text-slate-300">
                      {source.count}
                      {source.truncated > 0 ? ` (+${source.truncated})` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-mono text-[10px] break-all text-slate-400">
                {run.evidence.contentHash.slice(0, 16)}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </DetailPageLayout>
  )
}
