import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Alert, AlertDescription, AlertTitle, Badge, Button, UrlDrawer } from '@beaconhs/ui'
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
import { ActivityFeed } from '@/components/activity-feed'
import { InspectionStatusPill } from '@/components/inspection-status-pill'
import { PhotoGallery } from '@/components/photo-gallery'
import { CriterionCard, type EqKind } from './[id]/_criteria'
import { RecordMeta } from './[id]/_record-meta'
import { datetimeLocalValue, formatDateTime } from '@/lib/datetime'
import {
  addCriterionPhotos,
  passAllEquipmentInspection,
  reopenEquipmentInspection,
  removeCriterionPhoto,
  removeRecordPhoto,
  reorderCriterionPhotos,
  reorderRecordPhotos,
  setActionTaken,
  setAnswer,
  setComment,
  setSeverity,
  setValue,
  submitEquipmentInspection,
  updateCriterionPhoto,
  updateRecordPhoto,
} from './_actions'

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

export async function EquipmentInspectionDrawer({
  open,
  closeHref,
  inspectionId,
  sp,
  returnTo,
}: {
  open: boolean
  /** Where the flyout's close control goes — also the page it reports back to. */
  closeHref: string
  inspectionId: string | null
  sp: Record<string, string | string[] | undefined>
  /** Host page this flyout is open over, so a rejected submit comes back here. */
  returnTo?: string
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  // Kept mounted while closed so the flyout animates out, but the record is
  // only read when it is actually being shown.
  const id = open && inspectionId && isUuid(inspectionId) ? inspectionId : null
  if (!id) {
    return (
      <UrlDrawer open={false} closeHref={closeHref} title={tGenerated('m_189bb91aaf5565')}>
        {null}
      </UrlDrawer>
    )
  }
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
    const photoMap = new Map<
      string,
      {
        id: string
        url: string
        filename: string
        caption: string | null
        annotations: (typeof attachments.$inferSelect)['annotations']
        width: number | null
        height: number | null
      }
    >()
    if (allPhotoIds.length > 0) {
      const rows = await tx
        .select({
          id: attachments.id,
          filename: attachments.filename,
          caption: attachments.caption,
          annotations: attachments.annotations,
          width: attachments.width,
          height: attachments.height,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.kind, 'image'),
            inArray(attachments.id, allPhotoIds),
          ),
        )
      for (const r of rows) photoMap.set(r.id, { ...r, url: attachmentUrl(r.id) })
    }
    const recordPhotos = await tx
      .select({
        id: equipmentInspectionRecordAttachments.id,
        attachmentId: attachments.id,
        filename: attachments.filename,
        caption: equipmentInspectionRecordAttachments.caption,
        annotations: attachments.annotations,
        width: attachments.width,
        height: attachments.height,
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
      .orderBy(
        asc(equipmentInspectionRecordAttachments.sortOrder),
        asc(equipmentInspectionRecordAttachments.createdAt),
        asc(equipmentInspectionRecordAttachments.id),
      )
    return { ...row, criteria, photoMap, recordPhotos }
  })

  if (!data) {
    return (
      <UrlDrawer open closeHref={closeHref} title={tGenerated('m_189bb91aaf5565')}>
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <GeneratedText id="m_0279fd6c5a9fba" />
        </p>
      </UrlDrawer>
    )
  }
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
  // Same derivation the PPE flyout uses: the result comes from the answers, it
  // is never chosen by hand. A finalized record reports what it recorded.
  const progress: 'pass' | 'fail' | 'incomplete' = finalized
    ? record.result === 'pass'
      ? 'pass'
      : record.result === 'fail'
        ? 'fail'
        : 'incomplete'
    : total === 0 || answered < total
      ? 'incomplete'
      : failCount > 0
        ? 'fail'
        : 'pass'

  const actions = {
    setAnswer,
    setSeverity,
    setComment,
    setActionTaken,
    setValue,
    addPhotos: addCriterionPhotos,
    updatePhoto: updateCriterionPhoto,
    removePhoto: removeCriterionPhoto,
    reorderPhotos: reorderCriterionPhotos,
  }
  const updateRecordPhotoAction = updateRecordPhoto.bind(null, id)
  const removeRecordPhotoAction = removeRecordPhoto.bind(null, id)
  const reorderRecordPhotosAction = reorderRecordPhotos.bind(null, id)
  const activity = await recentActivityForEntity(ctx, 'equipment_inspection_record', id, 25)

  return (
    <UrlDrawer
      open
      closeHref={closeHref}
      title={tGeneratedValue(record.reference)}
      description={tGeneratedValue(
        `${item?.name ?? record.equipmentNameSnapshot ?? 'Rental equipment'}${type ? ` · ${type.name}` : ''}`,
      )}
      size="xl"
      footer={
        // Status on the left, the one action on the right — the flyout's own
        // footer sits outside the scroll container, so the checklist can grow
        // under it without the list appearing to end early.
        <div className="flex w-full items-center justify-between gap-3">
          <InspectionStatusPill status={progress} answered={answered} total={total} />
          <div className="flex items-center gap-2">
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
                      <GeneratedValue
                        value={
                          returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null
                        }
                      />
                      <Button type="submit" disabled={answered < total}>
                        <ClipboardCheck size={14} /> <GeneratedText id="m_09ee2ce911f04f" />
                      </Button>
                    </form>
                  </>
                ) : null
              }
            />
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              <GeneratedValue value={type?.name ?? 'Inspection'} />
            </p>
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_1e7a6e975f16ba" />
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          </div>
        </div>

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
            item || record.isRental ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <GeneratedValue
                  value={
                    item ? (
                      <Link
                        href={`/equipment/${item.id}`}
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <Wrench size={12} /> <GeneratedValue value={item.assetTag} />
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                        <Wrench size={12} /> <GeneratedText id="m_1bff1917923224" />{' '}
                        <GeneratedValue
                          value={record.equipmentNameSnapshot ?? 'Unregistered unit'}
                        />
                      </span>
                    )
                  }
                />
                <GeneratedValue
                  value={
                    record.serial ? (
                      <span>
                        <GeneratedText id="m_036a8b80373228" /> {record.serial}
                      </span>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    record.rentalProvider ? (
                      <span>
                        <GeneratedText id="m_1b8c7327ab77c7" /> {record.rentalProvider}
                      </span>
                    ) : null
                  }
                />
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
                  <GeneratedValue value={passCount} /> <GeneratedText id="m_06bcacf715c7ca" />{' '}
                  <GeneratedValue value={failCount} /> <GeneratedText id="m_14803909da5dbb" />
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
                    attachmentId: photo.attachmentId,
                    url: attachmentUrl(photo.attachmentId),
                    filename: photo.filename,
                    caption: photo.caption,
                    annotations: photo.annotations,
                    width: photo.width,
                    height: photo.height,
                  }))}
                  editable={editable}
                  onUpdate={updateRecordPhotoAction}
                  onRemove={removeRecordPhotoAction}
                  onReorder={reorderRecordPhotosAction}
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
                          .filter((p): p is NonNullable<typeof p> => Boolean(p))}
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
    </UrlDrawer>
  )
}
