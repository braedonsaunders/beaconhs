import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Download } from 'lucide-react'
import { attachments, reportDefinitions, reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { ReportRunDetail } from '@beaconhs/reports/react'
import { assertCan } from '@beaconhs/tenant'
import { Button, DetailHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { toSchedule } from '../../../page'

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>
}) {
  const { id, runId } = await params
  if (!isUuid(id) || !isUuid(runId)) notFound()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.read')

  const row = await ctx.db(async (tx) => {
    const [result] = await tx
      .select({
        run: reportRuns,
        schedule: reportSchedules,
        definitionName: reportDefinitions.name,
        attachment: attachments,
      })
      .from(reportRuns)
      .innerJoin(
        reportSchedules,
        and(
          eq(reportSchedules.tenantId, reportRuns.tenantId),
          eq(reportSchedules.id, reportRuns.scheduleId),
        ),
      )
      .innerJoin(
        reportDefinitions,
        and(
          eq(reportDefinitions.tenantId, reportSchedules.tenantId),
          eq(reportDefinitions.id, reportSchedules.definitionId),
        ),
      )
      .leftJoin(
        attachments,
        and(
          eq(attachments.tenantId, reportRuns.tenantId),
          eq(attachments.id, reportRuns.pdfAttachmentId),
        ),
      )
      .where(
        and(
          eq(reportRuns.tenantId, ctx.tenantId!),
          eq(reportRuns.scheduleId, id),
          eq(reportRuns.id, runId),
        ),
      )
      .limit(1)
    return result ?? null
  })
  if (!row) notFound()
  const pdfHref = row.attachment ? `/reports/schedules/${id}/runs/${runId}/pdf` : undefined

  return (
    <PageContainer className="space-y-4">
      <DetailHeader
        back={{ href: `/reports/schedules/${id}`, label: 'Back to schedule' }}
        title={row.schedule.name}
        subtitle={tGenerated('m_175bec260f32b5', { value0: row.run.id })}
        actions={
          pdfHref ? (
            <Button asChild>
              <Link href={pdfHref}>
                <Download size={14} />
                <GeneratedText id="m_1eeaf573dabd83" />
              </Link>
            </Button>
          ) : null
        }
      />
      <ReportRunDetail
        definitionName={row.definitionName}
        schedule={toSchedule(row.schedule)}
        run={{
          id: row.run.id,
          scheduleId: row.run.scheduleId,
          trigger: row.run.trigger,
          status: row.run.status,
          error: row.run.error,
          rowCount: row.run.rowCount,
          startedAt: row.run.startedAt,
          finishedAt: row.run.finishedAt,
          artifact: row.attachment
            ? {
                filename: row.attachment.filename,
                sizeBytes: row.attachment.sizeBytes,
                contentType: row.attachment.contentType,
                createdAt: row.attachment.createdAt,
                href: pdfHref,
              }
            : null,
        }}
      />
    </PageContainer>
  )
}
