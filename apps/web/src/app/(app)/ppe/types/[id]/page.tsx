import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// /ppe/types/[id] — PPE type detail, hosting the 1/3-2/3 builder.
//
// Mirrors the inspections type builder: a settings rail + a build surface with
// drag-reorderable, kind-scoped sections, manual severity-aware criteria, and
// "Import from bank". Replaces the old ?tab= general/criteria/sizing pages —
// all of that now lives in the builder (Settings tab + Build surface).

import { notFound } from 'next/navigation'
import { asc, count, eq, sql } from 'drizzle-orm'
import { Badge, DetailHeader } from '@beaconhs/ui'
import {
  ppeCriteriaBankCriteria,
  ppeCriteriaBanks,
  ppeItems,
  ppeTypeCriteriaGroups,
  ppeTypeInspectionCriteria,
  ppeTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { isUuid } from '@/lib/list-params'
import { countScopedCustomFields } from '@/lib/custom-fields/subtype-retirement'
import { PpeTypeBuilder } from './_type-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_069c9d9caa04a7', { value0: id.slice(0, 8) }) }
}

export default async function PpeTypeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireModuleManage('ppe')

  const data = await ctx.db(async (tx) => {
    const [type] = await tx.select().from(ppeTypes).where(eq(ppeTypes.id, id)).limit(1)
    if (!type) return null
    const groups = await tx
      .select({
        id: ppeTypeCriteriaGroups.id,
        label: ppeTypeCriteriaGroups.label,
        sequence: ppeTypeCriteriaGroups.sequence,
        inspectionKind: ppeTypeCriteriaGroups.inspectionKind,
      })
      .from(ppeTypeCriteriaGroups)
      .where(eq(ppeTypeCriteriaGroups.ppeTypeId, id))
      .orderBy(asc(ppeTypeCriteriaGroups.sequence))
    const criteria = await tx
      .select({
        id: ppeTypeInspectionCriteria.id,
        groupId: ppeTypeInspectionCriteria.groupId,
        sequence: ppeTypeInspectionCriteria.entityOrder,
        question: ppeTypeInspectionCriteria.question,
        description: ppeTypeInspectionCriteria.description,
        severity: ppeTypeInspectionCriteria.severity,
        requiresPhoto: ppeTypeInspectionCriteria.requiresPhoto,
        inspectionKind: ppeTypeInspectionCriteria.inspectionKind,
      })
      .from(ppeTypeInspectionCriteria)
      .where(eq(ppeTypeInspectionCriteria.ppeTypeId, id))
      .orderBy(asc(ppeTypeInspectionCriteria.entityOrder))
    const banks = await tx
      .select({
        id: ppeCriteriaBanks.id,
        name: ppeCriteriaBanks.name,
        category: ppeCriteriaBanks.category,
        criteriaCount: sql<number>`count(${ppeCriteriaBankCriteria.id})`.mapWith(Number),
      })
      .from(ppeCriteriaBanks)
      .leftJoin(ppeCriteriaBankCriteria, eq(ppeCriteriaBankCriteria.bankId, ppeCriteriaBanks.id))
      .where(eq(ppeCriteriaBanks.isPublished, true))
      .groupBy(ppeCriteriaBanks.id)
      .orderBy(asc(ppeCriteriaBanks.name))
    const [itemTally] = await tx
      .select({ c: count() })
      .from(ppeItems)
      .where(eq(ppeItems.typeId, id))
    const customFieldCount = await countScopedCustomFields(tx, ctx.tenantId, 'ppe', id)
    return {
      type,
      groups,
      criteria,
      banks,
      itemCount: Number(itemTally?.c ?? 0),
      customFieldCount,
    }
  })

  if (!data) notFound()
  const { type, groups, criteria, banks, itemCount, customFieldCount } = data
  const activity = await recentActivityForEntity(ctx, 'ppe_type', id, 50)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/ppe/types', label: 'Back to PPE types' }}
          title={tGeneratedValue(type.name)}
          subtitle={tGeneratedValue(
            type.category
              ? tGenerated('m_069c3b200e2976', { value0: type.category.replace(/_/g, ' ') })
              : tGenerated('m_05116005c3a097'),
          )}
          badge={
            <div className="flex items-center gap-2">
              <GeneratedValue
                value={
                  type.isInspectable ? (
                    <Badge variant="success">
                      <GeneratedText id="m_17f3fef7e62178" />
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <GeneratedText id="m_026e887ee8379c" />
                    </Badge>
                  )
                }
              />
              <Badge variant="secondary">
                <GeneratedValue value={itemCount} /> <GeneratedText id="m_089f2b1abdb347" />
                <GeneratedValue
                  value={itemCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                />
              </Badge>
              <GeneratedValue
                value={
                  customFieldCount > 0 ? (
                    <Badge variant="secondary">
                      <GeneratedValue value={customFieldCount} />{' '}
                      <GeneratedText id="m_19e5b5bd99a2c5" />
                      <GeneratedValue
                        value={
                          customFieldCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />
                        }
                      />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <PpeTypeBuilder
        type={{
          id: type.id,
          name: type.name,
          category: type.category,
          isInspectable: type.isInspectable,
          everyDays: type.inspectionSchedule?.everyDays ?? null,
          requiresCertificate: type.inspectionSchedule?.requiresCertificate ?? false,
          sizingScheme: type.sizingScheme,
        }}
        groups={groups}
        criteria={criteria}
        banks={banks}
        itemCount={itemCount}
        customFieldCount={customFieldCount}
        activitySlot={
          <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
        }
      />
    </DetailPageLayout>
  )
}
