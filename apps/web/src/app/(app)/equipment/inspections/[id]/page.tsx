import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_1e1f30fc77a9cc', { value0: id.slice(0, 8) }) }
}

export default async function EquipmentInspectionRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
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
          title={tGeneratedValue(record.reference)}
          description={tGeneratedValue(
            `${item?.name ?? 'Equipment'}${type ? ` · ${type.name}` : ''}`,
          )}
          back={{ href: '/equipment/inspections', label: 'Back to inspections' }}
          actions={
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[record.status] ?? 'secondary'}>
                <GeneratedValue value={record.status.replace('_', ' ')} />
              </Badge>
              <GeneratedValue
                value={
                  record.result ? (
                    <Badge variant={RESULT_VARIANT[record.result] ?? 'secondary'}>
                      <GeneratedValue value={record.result} />
                    </Badge>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  finalized && canInspect ? (
                    <form action={reopenEquipmentInspection}>
                      <input type="hidden" name="recordId" value={record.id} />
                      <Button type="submit" variant="outline">
                        <RotateCcw size={14} /> <GeneratedText id="m_0341d048ec832d" />
                      </Button>
                    </form>
                  ) : editable ? (
                    <>
                      <GeneratedValue
                        value={
                          record.allowPassAll && answered < total ? (
                            <form action={passAllEquipmentInspection}>
                              <input type="hidden" name="recordId" value={record.id} />
                              <Button type="submit" variant="outline">
                                <CheckCheck size={14} /> <GeneratedText id="m_1017a3edb674c9" />
                              </Button>
                            </form>
                          ) : null
                        }
                      />
                      <form action={submitEquipmentInspection}>
                        <input type="hidden" name="recordId" value={record.id} />
                        <Button type="submit">
                          <ClipboardCheck size={14} /> <GeneratedText id="m_09ee2ce911f04f" />
                        </Button>
                      </form>
                    </>
                  ) : null
                }
              />
            </div>
          }
        />

        <GeneratedValue
          value={
            issue && editable ? (
              <Alert variant="destructive">
                <AlertTitle>
                  <GeneratedText id="m_0256fc3e59aacf" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedValue value={issue} />
                </AlertDescription>
              </Alert>
            ) : null
          }
        />

        <GeneratedValue
          value={
            item ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <Link
                  href={`/equipment/${item.id}`}
                  className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline dark:text-teal-400"
                >
                  <Wrench size={12} /> <GeneratedValue value={item.assetTag} />
                </Link>
                <GeneratedValue
                  value={
                    inspectorName ? (
                      <span>
                        <GeneratedText id="m_1b46f099996a1c" />{' '}
                        <GeneratedValue value={inspectorName} />
                      </span>
                    ) : null
                  }
                />
                <span>
                  <GeneratedValue value={answered} />/<GeneratedValue value={total} />{' '}
                  <GeneratedText id="m_13f3fe949a61d7" /> <GeneratedValue value={passCount} />{' '}
                  <GeneratedText id="m_06bcacf715c7ca" /> <GeneratedValue value={failCount} />{' '}
                  <GeneratedText id="m_14803909da5dbb" />
                </span>
              </div>
            ) : null
          }
        />

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

        <GeneratedValue
          value={
            recordPhotos.length > 0 ? (
              <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <GeneratedText id="m_074ae613f77eb0" />
                  <GeneratedValue value={recordPhotos.length} />)
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
            ) : null
          }
        />

        <div className="space-y-4">
          <GeneratedValue
            value={order.map((label) => {
              const items = byLabel.get(label)!
              return (
                <section key={label} className="space-y-2">
                  <GeneratedValue
                    value={
                      multiSection ? (
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                          <GeneratedValue
                            value={
                              label === '__ungrouped__' ? (
                                <GeneratedText id="m_1086584d9aca6a" />
                              ) : (
                                label
                              )
                            }
                          />
                        </h3>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={items.map((c) => (
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
                  />
                </section>
              )
            })}
          />
          <GeneratedValue
            value={
              total === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <GeneratedText id="m_07c4d82e8c9123" />
                </p>
              ) : null
            }
          />
        </div>

        <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
      </div>
    </PageContainer>
  )
}
