import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
} from '@beaconhs/ui'
import { attachments, reportDefinitions, reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { PageContainer } from '@/components/page-layout'
import { isUuid } from '@/lib/list-params'
import { StatusBadge } from '../../../../_format'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_061f2f6ac3704b') }
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id, runId } = await params
  if (!isUuid(id) || !isUuid(runId)) notFound()

  const ctx = await requireRequestContext()

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        run: reportRuns,
        schedule: reportSchedules,
        attachment: attachments,
      })
      .from(reportRuns)
      .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
      .leftJoin(attachments, eq(attachments.id, reportRuns.pdfAttachmentId))
      .where(eq(reportRuns.id, runId))
      .limit(1)
    return r ?? null
  })
  if (!row || row.schedule.id !== id) notFound()

  const [definition] = await ctx.db((tx) =>
    tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, row.schedule.definitionId))
      .limit(1),
  )

  const duration =
    row.run.finishedAt && row.run.startedAt
      ? Math.round(
          (new Date(row.run.finishedAt).getTime() - new Date(row.run.startedAt).getTime()) / 1000,
        )
      : null

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{
            href: `/reports/schedules/${id}`,
            label: 'Back to schedule',
          }}
          title={tGenerated('m_12a0bd39d734b4', {
            value0: formatDateTime(new Date(row.run.startedAt), ctx.timezone, ctx.locale),
          })}
          subtitle={tGeneratedValue(
            `${row.schedule.name} — ${definition?.name ?? 'Unknown report'}`,
          )}
          badge={<StatusBadge status={row.run.status} />}
          actions={
            row.attachment ? (
              <a href={`/reports/schedules/${id}/runs/${runId}/pdf`}>
                <Button>
                  <GeneratedText id="m_1eeaf573dabd83" />
                </Button>
              </a>
            ) : null
          }
        />

        <GeneratedValue
          value={
            row.run.status === 'failed' && row.run.error ? (
              <Alert variant="destructive">
                <AlertTitle>
                  <GeneratedText id="m_0cc9e9aed95413" />
                </AlertTitle>
                <AlertDescription>
                  <pre className="mt-2 text-xs whitespace-pre-wrap">{row.run.error}</pre>
                </AlertDescription>
              </Alert>
            ) : null
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedText id="m_1560d4e2a09d09" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Detail label={tGenerated('m_0b9da892d6faf0')}>
                <Badge variant="outline">
                  <GeneratedValue value={row.run.status} />
                </Badge>
              </Detail>
              <Detail label={tGenerated('m_1922c581498469')}>
                <GeneratedValue
                  value={formatDateTime(new Date(row.run.startedAt), ctx.timezone, ctx.locale)}
                />
              </Detail>
              <Detail label={tGenerated('m_0b4f952ff360b5')}>
                <GeneratedValue
                  value={
                    row.run.finishedAt
                      ? formatDateTime(new Date(row.run.finishedAt), ctx.timezone, ctx.locale)
                      : '—'
                  }
                />
              </Detail>
              <Detail label={tGenerated('m_0ec97074401d0f')}>
                <GeneratedValue
                  value={
                    duration !== null ? (
                      <GeneratedText id="m_06fa7e2daf6448" values={{ value0: duration }} />
                    ) : (
                      '—'
                    )
                  }
                />
              </Detail>
              <Detail label={tGenerated('m_03be2202673df4')}>
                <GeneratedValue value={row.run.rowCount ?? '—'} />
              </Detail>
              <Detail label={tGenerated('m_16faf7a86922c4')}>
                <GeneratedValue value={row.schedule.name} />
              </Detail>
              <Detail label={tGenerated('m_0ab5a972fc80fd')}>
                <GeneratedValue value={definition?.name ?? '—'} />
              </Detail>
              <Detail label={tGenerated('m_1151ed0308b6d1')}>
                <GeneratedValue value={row.schedule.cadence} /> @{' '}
                <GeneratedValue value={String(row.schedule.hour).padStart(2, '0')} />:
                <GeneratedValue value={String(row.schedule.minute).padStart(2, '0')} />{' '}
                <GeneratedValue value={row.schedule.timezone} />
              </Detail>
            </dl>
          </CardContent>
        </Card>

        <GeneratedValue
          value={
            row.attachment ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_04c18d4965cadc" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <Detail label={tGenerated('m_0bd52c07efd4da')}>
                      <span className="font-mono text-xs">
                        <GeneratedValue value={row.attachment.filename} />
                      </span>
                    </Detail>
                    <Detail label={tGenerated('m_11ad4bbeced31b')}>
                      <GeneratedValue value={Math.round(row.attachment.sizeBytes / 1024)} />{' '}
                      <GeneratedText id="m_17d7fe3f03b546" />
                    </Detail>
                    <Detail label={tGenerated('m_0ad469bd29c2e1')}>
                      <GeneratedValue value={row.attachment.contentType} />
                    </Detail>
                    <Detail label={tGenerated('m_028e286aa7b299')}>
                      <GeneratedValue
                        value={formatDateTime(
                          new Date(row.attachment.createdAt),
                          ctx.timezone,
                          ctx.locale,
                        )}
                      />
                    </Detail>
                  </dl>
                  <div className="mt-4">
                    <a href={`/reports/schedules/${id}/runs/${runId}/pdf`}>
                      <Button>
                        <GeneratedText id="m_1eeaf573dabd83" />
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_1a2b2ed6729166" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_193594205d2793" />
                    <GeneratedValue
                      value={
                        row.run.status === 'failed' ? (
                          <GeneratedText id="m_0e0391e5cf0947" />
                        ) : row.run.status !== 'succeeded' ? (
                          <GeneratedText id="m_07606a32a23f55" />
                        ) : (
                          ''
                        )
                      }
                    />
                  </p>
                </CardContent>
              </Card>
            )
          }
        />
      </div>
    </PageContainer>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </dt>
      <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
        <GeneratedValue value={children} />
      </dd>
    </div>
  )
}
