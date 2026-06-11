// Detail page for a built signed-report bundle (`/hazid/reports/signed/:id`).
//
// Shows everything an admin needs to verify a wave-7 hazid signed-report:
//   * Title / description / builder / dates / status badge
//   * Included assessments (links back to /hazid/:id)
//   * "Download PDF" button when status='completed'
//   * "Re-send email" form (with optional override recipients)
//   * "Retry render" button when status='failed' or stuck pending/rendering
//   * Audit feed for action history
//
// The page itself just reads and renders; mutation goes through the
// `_actions.ts` server actions.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  Input,
  Label,
} from '@beaconhs/ui'
import { Download, FileSignature, Mail, RefreshCw, Trash2 } from 'lucide-react'
import {
  attachments,
  hazidAssessmentTypes,
  hazidAssessments,
  hazidSignedReports,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { deleteSignedReport, resendSignedReportEmail, retrySignedReport } from '../../../_actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Signed-report · ${id.slice(0, 8)}` }
}

export default async function SignedReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [reportRow] = await tx
      .select({
        report: hazidSignedReports,
        pdfAttachment: attachments,
        builderMember: tenantUsers,
        builderUser: user,
      })
      .from(hazidSignedReports)
      .leftJoin(attachments, eq(attachments.id, hazidSignedReports.pdfAttachmentId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, hazidSignedReports.builtByTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(hazidSignedReports.id, id))
      .limit(1)
    if (!reportRow) return null

    // Resolve every assessment referenced by the bundle so we can link them
    // back to /hazid/:id. We still want to render rows whose assessments
    // have been soft-deleted (so admins can see what changed); we just mark
    // them visually.
    const includedAssessments = reportRow.report.assessmentIds.length
      ? await tx
          .select({
            a: hazidAssessments,
            site: orgUnits,
            supervisor: people,
            type: hazidAssessmentTypes,
          })
          .from(hazidAssessments)
          .leftJoin(orgUnits, eq(orgUnits.id, hazidAssessments.siteOrgUnitId))
          .leftJoin(people, eq(people.id, hazidAssessments.supervisorPersonId))
          .leftJoin(
            hazidAssessmentTypes,
            eq(hazidAssessmentTypes.id, hazidAssessments.assessmentTypeId),
          )
          .where(inArray(hazidAssessments.id, reportRow.report.assessmentIds))
          .orderBy(asc(hazidAssessments.occurredAt))
      : []

    return { reportRow, includedAssessments }
  })

  if (!data) notFound()

  const { reportRow, includedAssessments } = data
  const r = reportRow.report
  const activity = await recentActivityForEntity(ctx, 'hazid_signed_report', id, 50)

  const builderName = reportRow.builderUser?.name ?? reportRow.builderMember?.displayName ?? null

  const statusVariant = statusBadgeVariant(r.status)
  const isCompleted = r.status === 'completed' || r.status === 'ready'
  const isFailed = r.status === 'failed'
  const isInFlight = r.status === 'pending' || r.status === 'rendering' || r.status === 'generating'

  // Index assessments by id so we can preserve the order the user picked.
  const assessmentMap = new Map(includedAssessments.map((row) => [row.a.id, row] as const))

  return (
    <DetailPageLayout
      header={
        <>
          <div className="mb-2"></div>
          <DetailHeader
            back={{ href: '/hazid/reports/signed', label: 'Back to signed-report bundles' }}
            title={r.title}
            subtitle={`Built ${r.builtAt ? new Date(r.builtAt).toLocaleString() : new Date(r.createdAt).toLocaleString()} · ${r.assessmentIds.length} assessment${r.assessmentIds.length === 1 ? '' : 's'}`}
            badge={<Badge variant={statusVariant}>{r.status}</Badge>}
            actions={
              <>
                {isCompleted && reportRow.pdfAttachment ? (
                  <Link href={`/hazid/reports/signed/${id}/pdf` as any}>
                    <Button variant="outline">
                      <Download size={14} /> Download PDF
                    </Button>
                  </Link>
                ) : null}
                {isFailed || isInFlight ? (
                  <form action={retrySignedReport}>
                    <input type="hidden" name="id" value={id} />
                    <Button type="submit" variant="outline">
                      <RefreshCw size={14} /> {isFailed ? 'Retry render' : 'Re-enqueue'}
                    </Button>
                  </form>
                ) : null}
                <form action={deleteSignedReport}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="ghost" className="text-red-600">
                    <Trash2 size={14} /> Delete
                  </Button>
                </form>
              </>
            }
          />
        </>
      }
      alerts={
        <>
          {r.status === 'rendering' || r.status === 'generating' ? (
            <Alert variant="info">
              <AlertTitle>Render in progress</AlertTitle>
              <AlertDescription>
                The worker is concatenating per-assessment PDFs into a single bundle. Refresh in a
                few seconds.
              </AlertDescription>
            </Alert>
          ) : null}
          {r.status === 'pending' ? (
            <Alert variant="info">
              <AlertTitle>Waiting for render</AlertTitle>
              <AlertDescription>
                This bundle is queued for rendering. If it stays pending for more than a minute, the
                worker may be down — try re-enqueueing.
              </AlertDescription>
            </Alert>
          ) : null}
          {isFailed ? (
            <Alert variant="destructive">
              <AlertTitle>Render failed</AlertTitle>
              <AlertDescription>
                {r.errorMessage
                  ? r.errorMessage
                  : 'Worker reported an error — check the audit log.'}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        <Section title="Bundle details" defaultOpen>
          <DetailGrid
            rows={[
              { label: 'Title', value: r.title },
              { label: 'Status', value: <Badge variant={statusVariant}>{r.status}</Badge> },
              { label: 'Assessment count', value: r.assessmentIds.length },
              { label: 'Built by', value: builderName ?? '—' },
              {
                label: 'Built at',
                value: r.builtAt ? new Date(r.builtAt).toLocaleString() : '—',
              },
              {
                label: 'Completed at',
                value: r.completedAt ? new Date(r.completedAt).toLocaleString() : '—',
              },
              {
                label: 'PDF size',
                value: reportRow.pdfAttachment
                  ? `${formatBytes(reportRow.pdfAttachment.sizeBytes)}`
                  : '—',
              },
              {
                label: 'Recipients on file',
                value: r.recipientEmails.length > 0 ? r.recipientEmails.join(', ') : '—',
              },
            ]}
          />
          {r.description ? (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap">
              {r.description}
            </div>
          ) : null}
        </Section>

        <Section title={`Included assessments (${r.assessmentIds.length})`} defaultOpen>
          {r.assessmentIds.length === 0 ? (
            <p className="text-sm text-slate-500">No assessments selected.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
              {r.assessmentIds.map((aid, idx) => {
                const row = assessmentMap.get(aid)
                if (!row) {
                  return (
                    <li key={aid} className="px-4 py-3 text-sm text-slate-500">
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-500">
                            {idx + 1}
                          </span>
                          Assessment {aid.slice(0, 8)}…
                        </span>
                        <Badge variant="secondary">missing / deleted</Badge>
                      </div>
                    </li>
                  )
                }
                return (
                  <li key={aid} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-50 text-xs font-medium text-teal-700">
                            {idx + 1}
                          </span>
                          <Link
                            href={`/hazid/${row.a.id}` as any}
                            className="font-mono text-sm font-medium text-teal-700 hover:underline"
                          >
                            {row.a.reference}
                          </Link>
                          {row.a.locked ? (
                            <Badge variant="success">Locked</Badge>
                          ) : (
                            <Badge variant="secondary">In progress</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.type?.name ?? 'Hazard assessment'}
                          {row.site?.name ? ` · ${row.site.name}` : ''}
                          {' · '}
                          {new Date(row.a.occurredAt).toLocaleString()}
                          {row.supervisor
                            ? ` · Supervisor: ${row.supervisor.firstName} ${row.supervisor.lastName}`
                            : ''}
                        </div>
                      </div>
                      <Link href={`/hazid/${row.a.id}` as any}>
                        <Button type="button" size="sm" variant="ghost">
                          View
                        </Button>
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="Email distribution" defaultOpen>
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-xs tracking-wide text-slate-500 uppercase">
                Recipients on file
              </div>
              <div className="mt-1 text-sm">
                {r.recipientEmails.length === 0 ? (
                  <span className="text-slate-500 italic">
                    No recipients were captured when this bundle was built.
                  </span>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {r.recipientEmails.map((addr) => (
                      <li
                        key={addr}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs text-slate-700"
                      >
                        {addr}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <form
              action={resendSignedReportEmail}
              className="space-y-3 rounded-md border border-slate-200 bg-white p-4"
            >
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label className="text-xs">Override recipients (optional, comma separated)</Label>
                <Input
                  name="recipients"
                  placeholder={
                    r.recipientEmails.length > 0
                      ? `Leave blank to use: ${r.recipientEmails.join(', ')}`
                      : 'eg. ops-mgr@example.com, safety@example.com'
                  }
                />
                <p className="text-xs text-slate-500">
                  Sends a fresh signed-link to the listed addresses. The PDF itself is not
                  regenerated — use Retry render for that.
                </p>
              </div>
              <div className="flex items-center justify-end">
                <Button type="submit" disabled={!isCompleted}>
                  <Mail size={14} /> {isCompleted ? 'Re-send email' : 'Bundle not ready'}
                </Button>
              </div>
            </form>
          </div>
        </Section>

        <Section title={`Activity (${activity.length})`} defaultOpen>
          {activity.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500">
              <FileSignature size={20} className="mx-auto mb-2 text-slate-300" />
              No activity recorded yet.
            </div>
          ) : (
            <ActivityFeed entries={activity} />
          )}
        </Section>
      </div>
    </DetailPageLayout>
  )
}

// Shared badge variant map for the wave-7 + legacy status strings so the
// detail header matches the listing row.
function statusBadgeVariant(status: string): 'success' | 'secondary' | 'warning' | 'destructive' {
  switch (status) {
    case 'completed':
    case 'ready':
      return 'success'
    case 'rendering':
    case 'generating':
      return 'warning'
    case 'pending':
      return 'secondary'
    case 'failed':
      return 'destructive'
    default:
      return 'secondary'
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
