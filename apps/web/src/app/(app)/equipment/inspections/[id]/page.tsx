import { notFound } from 'next/navigation'
import Link from 'next/link'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Alert, AlertDescription, AlertTitle, Badge, Button, PageHeader } from '@beaconhs/ui'
import { CheckCheck, ClipboardCheck, RotateCcw, Wrench } from 'lucide-react'
import { attachmentUrl } from '@/lib/attachment-url'
import {
  attachments,
  equipmentInspectionRecordAttachments,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity } from '@/lib/audit'
import { isUuid, pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { PhotoGallery } from '@/components/photo-gallery'
import { CriterionCard, type EqKind } from './_criteria'
import { RecordMeta } from './_record-meta'
import { datetimeLocalValue, formatDateTime } from '@/lib/datetime'
import {
  addCriterionPhotos,
  passAllEquipmentInspection,
  reopenEquipmentInspection,
  setActionTaken,
  setAnswer,
  setComment,
  setSeverity,
  setValue,
  submitEquipmentInspection,
} from '../_actions'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<string, 'secondary' | 'warning' | 'success'> = {
  draft: 'secondary',
  in_progress: 'warning',
  submitted: 'success',
  closed: 'secondary',
}
const RESULT_VARIANT: Record<string, 'success' | 'destructive' | 'secondary'> = {
  pass: 'success',
  fail: 'destructive',
  incomplete: 'secondary',
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Equipment inspection · ${id.slice(0, 8)}` }
}

export default async function EquipmentInspectionRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const issue = pickString(sp.issue)
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.self')
  const canInspect = can(ctx, 'equipment.inspect')

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        record: equipmentInspectionRecords,
        type: equipmentInspectionTypes,
        item: equipmentItems,
        inspectorName: user.name,
      })
      .from(equipmentInspectionRecords)
      .leftJoin(
        equipmentInspectionTypes,
        and(
          eq(equipmentInspectionTypes.tenantId, equipmentInspectionRecords.tenantId),
          eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
        ),
      )
      .leftJoin(
        equipmentItems,
        and(
          eq(equipmentItems.tenantId, equipmentInspectionRecords.tenantId),
          eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId),
        ),
      )
      .leftJoin(
        tenantUsers,
        and(
          eq(tenantUsers.tenantId, equipmentInspectionRecords.tenantId),
          eq(tenantUsers.id, equipmentInspectionRecords.inspectorTenantUserId),
        ),
      )
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, id),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .limit(1)
    if (!row) return null
    // Read-tier guard mirroring the equipment item detail page: site-tier
    // viewers see records at their sites; everyone else only their own.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      ownerIds: [row.record.inspectorTenantUserId, row.record.submittedByTenantUserId],
      siteId: row.record.siteOrgUnitId ?? row.item?.currentSiteOrgUnitId,
      personId: row.record.inspectorPersonId ?? row.item?.currentHolderPersonId,
    })
    if (!visible) return null
    const criteria = await tx
      .select()
      .from(equipmentInspectionRecordCriteria)
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecordCriteria.recordId, id),
        ),
      )
      .orderBy(asc(equipmentInspectionRecordCriteria.sequence))

    const allPhotoIds = Array.from(new Set(criteria.flatMap((c) => c.photoAttachmentIds ?? [])))
    const photoMap = new Map<string, { id: string; url: string; filename: string }>()
    if (allPhotoIds.length > 0) {
      const rows = await tx
        .select({ id: attachments.id, key: attachments.r2Key, filename: attachments.filename })
        .from(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.kind, 'image'),
            inArray(attachments.id, allPhotoIds),
          ),
        )
      for (const r of rows)
        photoMap.set(r.id, { id: r.id, url: attachmentUrl(r.id), filename: r.filename })
    }
    const recordPhotos = await tx
      .select({
        id: attachments.id,
        filename: attachments.filename,
        caption: equipmentInspectionRecordAttachments.caption,
      })
      .from(equipmentInspectionRecordAttachments)
      .innerJoin(
        attachments,
        and(
          eq(attachments.tenantId, equipmentInspectionRecordAttachments.tenantId),
          eq(attachments.id, equipmentInspectionRecordAttachments.attachmentId),
          eq(attachments.kind, 'image'),
        ),
      )
      .where(
        and(
          eq(equipmentInspectionRecordAttachments.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecordAttachments.recordId, id),
        ),
      )
    return { ...row, criteria, photoMap, recordPhotos }
  })

  if (!data) notFound()
  const { record, type, item, inspectorName, criteria, photoMap, recordPhotos } = data
  const finalized = record.status === 'submitted' || record.status === 'closed'
  const editable = canInspect && !record.locked && !finalized

  // Counts for the summary line
  const total = criteria.length
  const failCount = criteria.filter((c) => c.answer === 'fail').length
  const passCount = criteria.filter((c) => c.answer === 'pass').length
  const answered = criteria.filter(
    (c) =>
      c.answer != null ||
      (c.textValue ?? '') !== '' ||
      c.numericValue != null ||
      (c.photoAttachmentIds?.length ?? 0) > 0,
  ).length

  // Group by section (snapshot label), preserving first-appearance order.
  const order: string[] = []
  const byLabel = new Map<string, typeof criteria>()
  for (const c of criteria) {
    const label = c.groupLabelSnapshot ?? '__ungrouped__'
    if (!byLabel.has(label)) {
      byLabel.set(label, [])
      order.push(label)
    }
    byLabel.get(label)!.push(c)
  }
  const multiSection = order.length > 1 || (order.length === 1 && order[0] !== '__ungrouped__')
  const indexById = new Map(criteria.map((c, i) => [c.id, i]))

  const actions = {
    setAnswer,
    setSeverity,
    setComment,
    setActionTaken,
    setValue,
    addPhotos: addCriterionPhotos,
  }
  const activity = await recentActivityForEntity(ctx, 'equipment_inspection_record', id, 25)

  return (
    <PageContainer>
      <div className="space-y-5">
        <PageHeader
          title={record.reference}
          description={`${item?.name ?? 'Equipment'}${type ? ` · ${type.name}` : ''}`}
          back={{ href: '/equipment/inspections', label: 'Back to inspections' }}
          actions={
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[record.status] ?? 'secondary'}>
                {record.status.replace('_', ' ')}
              </Badge>
              {record.result ? (
                <Badge variant={RESULT_VARIANT[record.result] ?? 'secondary'}>
                  {record.result}
                </Badge>
              ) : null}
              {finalized && canInspect ? (
                <form action={reopenEquipmentInspection}>
                  <input type="hidden" name="recordId" value={record.id} />
                  <Button type="submit" variant="outline">
                    <RotateCcw size={14} /> Reopen
                  </Button>
                </form>
              ) : editable ? (
                <>
                  {record.allowPassAll && answered < total ? (
                    <form action={passAllEquipmentInspection}>
                      <input type="hidden" name="recordId" value={record.id} />
                      <Button type="submit" variant="outline">
                        <CheckCheck size={14} /> Pass all remaining
                      </Button>
                    </form>
                  ) : null}
                  <form action={submitEquipmentInspection}>
                    <input type="hidden" name="recordId" value={record.id} />
                    <Button type="submit">
                      <ClipboardCheck size={14} /> Submit
                    </Button>
                  </form>
                </>
              ) : null}
            </div>
          }
        />

        {issue && editable ? (
          <Alert variant="destructive">
            <AlertTitle>Submission blocked</AlertTitle>
            <AlertDescription>{issue}</AlertDescription>
          </Alert>
        ) : null}

        {item ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <Link
              href={`/equipment/${item.id}`}
              className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              <Wrench size={12} /> {item.assetTag}
            </Link>
            {inspectorName ? <span>Inspector: {inspectorName}</span> : null}
            <span>
              {answered}/{total} answered · {passCount} pass · {failCount} fail
            </span>
          </div>
        ) : null}

        <RecordMeta
          recordId={record.id}
          occurredAt={
            record.occurredAt ? datetimeLocalValue(new Date(record.occurredAt), ctx.timezone) : ''
          }
          occurredAtDisplay={
            record.occurredAt
              ? formatDateTime(new Date(record.occurredAt), ctx.timezone, ctx.locale)
              : ''
          }
          hours={record.hours ?? ''}
          notes={record.notes ?? ''}
          locked={!editable}
        />

        {recordPhotos.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Record photos ({recordPhotos.length})
            </h2>
            <PhotoGallery
              photos={recordPhotos.map((photo) => ({
                id: photo.id,
                url: attachmentUrl(photo.id),
                filename: photo.filename,
                caption: photo.caption,
              }))}
            />
          </section>
        ) : null}

        <div className="space-y-4">
          {order.map((label) => {
            const items = byLabel.get(label)!
            return (
              <section key={label} className="space-y-2">
                {multiSection ? (
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {label === '__ungrouped__' ? 'General' : label}
                  </h3>
                ) : null}
                {items.map((c) => (
                  <CriterionCard
                    key={c.id}
                    recordId={record.id}
                    rowId={c.id}
                    index={indexById.get(c.id) ?? 0}
                    question={c.questionTextSnapshot}
                    kind={c.kind as EqKind}
                    isCritical={c.isCritical}
                    isRequired={c.isRequired}
                    requiresPhoto={c.requiresPhoto}
                    requiresComment={c.requiresComment}
                    answer={c.answer as 'pass' | 'fail' | 'n_a' | null}
                    severity={c.severity as 'low' | 'medium' | 'high' | 'critical' | null}
                    comment={c.comment}
                    actionTaken={c.actionTaken}
                    textValue={c.textValue}
                    numericValue={c.numericValue}
                    photoPreviews={(c.photoAttachmentIds ?? [])
                      .map((pid) => photoMap.get(pid))
                      .filter((p): p is { id: string; url: string; filename: string } =>
                        Boolean(p),
                      )}
                    workOrderRef={c.workOrderId ? 'Work order' : null}
                    locked={!editable}
                    actions={actions}
                  />
                ))}
              </section>
            )
          })}
          {total === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              This inspection type has no criteria. Add criteria to its type, then start a new
              inspection.
            </p>
          ) : null}
        </div>

        <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
      </div>
    </PageContainer>
  )
}
