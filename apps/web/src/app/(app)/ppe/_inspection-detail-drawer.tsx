import Link from 'next/link'
import { alias } from 'drizzle-orm/pg-core'
import { and, asc, eq, or } from 'drizzle-orm'
import { Printer } from 'lucide-react'
import { Badge, Button, UrlDrawer } from '@beaconhs/ui'
import {
  attachments,
  orgUnits,
  people,
  ppeInspectionAttachments,
  ppeInspectionCriteria,
  ppeInspections,
  ppeIssueReports,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations, getGeneratedValueTranslations } from '@/i18n/generated.server'
import { attachmentUrl } from '@/lib/attachment-url'
import { formatDate } from '@/lib/datetime'
import { isUuid } from '@/lib/list-params'
import { DetailGrid } from '@/components/detail-grid'
import { DownloadLink } from '@/components/download-link'
import { RawImage } from '@/components/raw-image'

// The saved checklist of one PPE inspection — registered item or other PPE —
// with its photos and any defect report it raised. Mounted on the item page
// (scoped to that item) and on the register and inspections list (any
// inspection the viewer may read).

const supervisors = alias(people, 'ppe_inspection_supervisors')

const KIND_LABELS = { pre_use: 'Pre-use', annual: 'Annual' } as const
const RESULT_LABELS = { pass: 'Pass', fail: 'Fail', n_a: 'N/A' } as const
const ISSUE_STATUS_LABELS = { open: 'Open', resolved: 'Resolved', replaced: 'Replaced' } as const

function canReadAnyPpeInspection(ctx: RequestContext): boolean {
  return can(ctx, 'ppe.manage') || can(ctx, 'ppe.read.all') || can(ctx, 'ppe.inspect')
}

export async function PpeInspectionDetailDrawer({
  ctx,
  inspectionId,
  closeHref,
  itemId,
}: {
  ctx: RequestContext
  inspectionId: string | undefined
  closeHref: string
  /** On an item page: only that item's inspections open here. */
  itemId?: string
}) {
  const tGenerated = await getGeneratedTranslations()
  const tGeneratedValue = await getGeneratedValueTranslations()
  const allowed = itemId ? true : canReadAnyPpeInspection(ctx)
  const data =
    allowed && inspectionId && isUuid(inspectionId)
      ? await ctx.db(async (tx) => {
          const [head] = await tx
            .select({
              inspection: ppeInspections,
              typeName: ppeTypes.name,
              itemSerial: ppeItems.serialNumber,
              site: orgUnits.name,
              supervisorFirst: supervisors.firstName,
              supervisorLast: supervisors.lastName,
            })
            .from(ppeInspections)
            .innerJoin(ppeTypes, eq(ppeTypes.id, ppeInspections.typeId))
            .leftJoin(ppeItems, eq(ppeItems.id, ppeInspections.itemId))
            .leftJoin(orgUnits, eq(orgUnits.id, ppeInspections.siteOrgUnitId))
            .leftJoin(supervisors, eq(supervisors.id, ppeInspections.supervisorPersonId))
            .where(
              and(
                eq(ppeInspections.id, inspectionId),
                itemId ? eq(ppeInspections.itemId, itemId) : undefined,
              ),
            )
            .limit(1)
          if (!head) return null
          const [criteria, photoLinks, defectReports] = await Promise.all([
            tx
              .select()
              .from(ppeInspectionCriteria)
              .where(eq(ppeInspectionCriteria.inspectionId, inspectionId))
              .orderBy(asc(ppeInspectionCriteria.sequence)),
            tx
              .select({ link: ppeInspectionAttachments, attachment: attachments })
              .from(ppeInspectionAttachments)
              .innerJoin(attachments, eq(attachments.id, ppeInspectionAttachments.attachmentId))
              .leftJoin(
                ppeInspectionCriteria,
                eq(ppeInspectionCriteria.id, ppeInspectionAttachments.criterionResultId),
              )
              .where(
                or(
                  eq(ppeInspectionAttachments.inspectionId, inspectionId),
                  eq(ppeInspectionCriteria.inspectionId, inspectionId),
                ),
              ),
            tx
              .select()
              .from(ppeIssueReports)
              .where(eq(ppeIssueReports.inspectionId, inspectionId))
              .orderBy(asc(ppeIssueReports.reportedAt)),
          ])
          return { head, criteria, photoLinks, defectReports }
        })
      : null

  const inspection = data?.head.inspection
  const serial = inspection ? (data.head.itemSerial ?? inspection.serialNumber) : null
  const supervisorName = data?.head.supervisorLast
    ? `${data.head.supervisorLast}, ${data.head.supervisorFirst ?? ''}`
    : null

  return (
    <UrlDrawer
      open={Boolean(inspection)}
      closeHref={closeHref}
      title={tGenerated('m_1045d684f7a2d8')}
      description={
        inspection
          ? tGeneratedValue(
              `${KIND_LABELS[inspection.kind]} · ${inspection.inspectedOn ?? '—'} · ${inspection.result ? RESULT_LABELS[inspection.result] : '—'}`,
            )
          : undefined
      }
      size="lg"
      footer={
        inspection ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {inspection.itemId && !itemId ? (
              <Link href={`/ppe/${inspection.itemId}?tab=inspections`}>
                <Button variant="ghost">
                  <GeneratedText id="m_16a5f5ac3980cb" />
                </Button>
              </Link>
            ) : null}
            <DownloadLink
              href={`/ppe/inspections/${inspection.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline">
                <Printer size={14} /> <GeneratedText id="m_016088be0b1e51" />
              </Button>
            </DownloadLink>
          </div>
        ) : undefined
      }
    >
      {data && inspection ? (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-slate-100">
              <GeneratedValue
                value={serial ? `${data.head.typeName} · ${serial}` : data.head.typeName}
              />
            </span>
            {inspection.isOther ? (
              <Badge variant="secondary">
                <GeneratedText id="m_172b20c7c26e49" />
              </Badge>
            ) : null}
          </div>
          <DetailGrid
            rows={[
              ...(inspection.isOther
                ? [{ label: 'Supplied by', value: inspection.suppliedBy ?? '—' }]
                : []),
              { label: 'Inspected by', value: inspection.inspectorNameSnapshot ?? '—' },
              { label: 'Supervisor', value: supervisorName ?? '—' },
              { label: 'Location', value: data.head.site ?? '—' },
              { label: 'Notes', value: inspection.notes ?? '—' },
            ]}
          />
          {data.criteria.length === 0 ? (
            <p className="text-sm text-slate-500">
              <GeneratedText id="m_0b4b0b10211872" />
            </p>
          ) : (
            <ol className="space-y-2">
              {data.criteria.map((criterion) => {
                const photos = data.photoLinks.filter(
                  ({ link }) => link.criterionResultId === criterion.id,
                )
                return (
                  <li
                    key={criterion.id}
                    className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          <GeneratedValue
                            value={`${criterion.sequence + 1}. ${criterion.questionTextSnapshot}`}
                          />
                        </p>
                        {criterion.descriptionSnapshot ? (
                          <p className="mt-1 text-xs text-slate-500">
                            <GeneratedValue value={criterion.descriptionSnapshot} />
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary">
                          <GeneratedValue value={criterion.severity} />
                        </Badge>
                        <Badge
                          variant={
                            criterion.answer === 'pass'
                              ? 'success'
                              : criterion.answer === 'fail'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {criterion.answer ? (
                            <GeneratedValue value={RESULT_LABELS[criterion.answer]} />
                          ) : (
                            <GeneratedText id="m_001b53ad38955a" />
                          )}
                        </Badge>
                      </div>
                    </div>
                    {criterion.nonComplianceReason ? (
                      <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                        <GeneratedValue value={criterion.nonComplianceReason} />
                      </p>
                    ) : null}
                    {photos.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {photos.map(({ attachment }) => (
                          <InspectionPhoto key={attachment.id} attachment={attachment} />
                        ))}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          )}
          <InspectionRecordPhotos
            photos={data.photoLinks.filter(({ link }) => link.criterionResultId === null)}
          />
          {data.defectReports.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_1d2314abcb8336" />
              </p>
              {data.defectReports.map((report) => (
                <div
                  key={report.id}
                  className="space-y-1.5 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      <GeneratedValue
                        value={[
                          report.reportedByNameSnapshot,
                          formatDate(report.reportedAt, ctx.timezone, ctx.locale),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    </span>
                    <Badge variant={report.status === 'open' ? 'warning' : 'secondary'}>
                      <GeneratedValue value={ISSUE_STATUS_LABELS[report.status]} />
                    </Badge>
                  </div>
                  <p className="whitespace-pre-line text-slate-800 dark:text-slate-200">
                    <GeneratedValue value={report.description} />
                  </p>
                  {report.resolution ? (
                    <p className="text-slate-600 dark:text-slate-400">
                      <GeneratedText id="m_1e0580f7c4c4a5" />
                      {': '}
                      <GeneratedValue value={report.resolution} />
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </UrlDrawer>
  )
}

type PhotoAttachment = { id: string; filename: string }

function InspectionPhoto({ attachment }: { attachment: PhotoAttachment }) {
  return (
    <a
      href={attachmentUrl(attachment.id)}
      target="_blank"
      rel="noreferrer"
      title={attachment.filename}
      className="block h-16 w-16 overflow-hidden rounded border border-slate-200 dark:border-slate-700"
    >
      <RawImage
        src={attachmentUrl(attachment.id)}
        alt={attachment.filename}
        optimizationReason="authenticated"
        className="h-full w-full object-cover"
      />
    </a>
  )
}

function InspectionRecordPhotos({ photos }: { photos: { attachment: PhotoAttachment }[] }) {
  if (photos.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        <GeneratedText id="m_020f32bc59d098" />
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map(({ attachment }) => (
          <InspectionPhoto key={attachment.id} attachment={attachment} />
        ))}
      </div>
    </div>
  )
}
