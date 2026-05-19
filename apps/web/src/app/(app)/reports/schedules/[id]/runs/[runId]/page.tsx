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
import {
  attachments,
  reportDefinitions,
  reportRuns,
  reportSchedules,
} from '@beaconhs/db/schema'
import { db, withSuperAdmin } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { StatusBadge } from '../../../../page'

export const metadata = { title: 'Report run' }

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id, runId } = await params
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

  const [definition] = await withSuperAdmin(db, (tx) =>
    tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, row.schedule.definitionId))
      .limit(1),
  )

  const duration =
    row.run.finishedAt && row.run.startedAt
      ? Math.round((new Date(row.run.finishedAt).getTime() - new Date(row.run.startedAt).getTime()) / 1000)
      : null

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{
            href: `/reports/schedules/${id}`,
            label: 'Back to schedule',
          }}
          title={`Run · ${new Date(row.run.startedAt).toLocaleString()}`}
          subtitle={`${row.schedule.name} — ${definition?.name ?? 'Unknown report'}`}
          badge={<StatusBadge status={row.run.status} />}
          actions={
            row.attachment ? (
              <a href={`/reports/schedules/${id}/runs/${runId}/pdf`}>
                <Button>Download PDF</Button>
              </a>
            ) : null
          }
        />

        {row.run.status === 'failed' && row.run.error ? (
          <Alert variant="destructive">
            <AlertTitle>Run failed</AlertTitle>
            <AlertDescription>
              <pre className="mt-2 whitespace-pre-wrap text-xs">{row.run.error}</pre>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Detail label="Status">
                <Badge variant="outline">{row.run.status}</Badge>
              </Detail>
              <Detail label="Started">{new Date(row.run.startedAt).toLocaleString()}</Detail>
              <Detail label="Finished">
                {row.run.finishedAt ? new Date(row.run.finishedAt).toLocaleString() : '—'}
              </Detail>
              <Detail label="Duration">{duration !== null ? `${duration}s` : '—'}</Detail>
              <Detail label="Rows">{row.run.rowCount ?? '—'}</Detail>
              <Detail label="Schedule">{row.schedule.name}</Detail>
              <Detail label="Report">{definition?.name ?? '—'}</Detail>
              <Detail label="Cadence">
                {row.schedule.cadence} @ {String(row.schedule.hour).padStart(2, '0')}:
                {String(row.schedule.minute).padStart(2, '0')} {row.schedule.timezone}
              </Detail>
            </dl>
          </CardContent>
        </Card>

        {row.attachment ? (
          <Card>
            <CardHeader>
              <CardTitle>PDF attachment</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Detail label="Filename">
                  <span className="font-mono text-xs">{row.attachment.filename}</span>
                </Detail>
                <Detail label="Size">{Math.round(row.attachment.sizeBytes / 1024)} KB</Detail>
                <Detail label="Content type">{row.attachment.contentType}</Detail>
                <Detail label="Uploaded">
                  {new Date(row.attachment.createdAt).toLocaleString()}
                </Detail>
              </dl>
              <div className="mt-4">
                <a href={`/reports/schedules/${id}/runs/${runId}/pdf`}>
                  <Button>Download PDF</Button>
                </a>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>PDF</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500">
                No PDF available for this run.
                {row.run.status === 'failed'
                  ? ' The run failed before rendering.'
                  : row.run.status !== 'succeeded'
                    ? ' The run is still in progress.'
                    : ''}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  )
}
