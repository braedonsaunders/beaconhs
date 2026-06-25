import { notFound } from 'next/navigation'
import Link from 'next/link'
import { asc, eq, inArray } from 'drizzle-orm'
import { Badge, Button, PageHeader } from '@beaconhs/ui'
import { ClipboardCheck, RotateCcw, Wrench } from 'lucide-react'
import { publicUrl } from '@beaconhs/storage'
import {
  attachments,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { CriterionCard, type EqKind } from './_criteria'
import { RecordMeta } from './_record-meta'
import {
  addCriterionPhotos,
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
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

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
        eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
      )
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentInspectionRecords.inspectorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(equipmentInspectionRecords.id, id))
      .limit(1)
    if (!row) return null
    const criteria = await tx
      .select()
      .from(equipmentInspectionRecordCriteria)
      .where(eq(equipmentInspectionRecordCriteria.recordId, id))
      .orderBy(asc(equipmentInspectionRecordCriteria.sequence))

    const allPhotoIds = Array.from(new Set(criteria.flatMap((c) => c.photoAttachmentIds ?? [])))
    const photoMap = new Map<string, { id: string; url: string; filename: string }>()
    if (allPhotoIds.length > 0) {
      const rows = await tx
        .select({ id: attachments.id, key: attachments.r2Key, filename: attachments.filename })
        .from(attachments)
        .where(inArray(attachments.id, allPhotoIds))
      for (const r of rows)
        photoMap.set(r.id, { id: r.id, url: publicUrl(r.key), filename: r.filename })
    }
    return { ...row, criteria, photoMap }
  })

  if (!data) notFound()
  const { record, type, item, inspectorName, criteria, photoMap } = data
  const locked = record.status === 'submitted' || record.status === 'closed'

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
          back={{ href: '/equipment/inspections/records', label: 'Back to inspections' }}
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
              {locked ? (
                <form action={reopenEquipmentInspection}>
                  <input type="hidden" name="recordId" value={record.id} />
                  <Button type="submit" variant="outline">
                    <RotateCcw size={14} /> Reopen
                  </Button>
                </form>
              ) : (
                <form action={submitEquipmentInspection}>
                  <input type="hidden" name="recordId" value={record.id} />
                  <Button type="submit">
                    <ClipboardCheck size={14} /> Submit
                  </Button>
                </form>
              )}
            </div>
          }
        />

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
            record.occurredAt ? new Date(record.occurredAt).toISOString().slice(0, 16) : ''
          }
          hours={record.hours ?? ''}
          notes={record.notes ?? ''}
          locked={locked}
        />

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
                    locked={locked}
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

        <ActivityFeed entries={activity} />
      </div>
    </PageContainer>
  )
}
