import { notFound } from 'next/navigation'
import Link from 'next/link'
import { asc, eq } from 'drizzle-orm'
import { Badge, Button, DetailHeader } from '@beaconhs/ui'
import { ClipboardCheck } from 'lucide-react'
import {
  equipmentInspectionCriteria,
  equipmentInspectionGroups,
  equipmentInspectionTypes,
  equipmentTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { formatInterval } from '@/lib/equipment/intervals'
import { DetailPageLayout } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { isUuid } from '@/lib/list-params'
import { EquipmentInspectionTypeBuilder } from './_type-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Equipment inspection type · ${id.slice(0, 8)}` }
}

export default async function EquipmentInspectionTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const ctx = await requireModuleManage('equipment')

  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(equipmentInspectionTypes)
      .where(eq(equipmentInspectionTypes.id, id))
      .limit(1)
    if (!type) return null
    const groups = await tx
      .select({
        id: equipmentInspectionGroups.id,
        label: equipmentInspectionGroups.label,
        sequence: equipmentInspectionGroups.sequence,
      })
      .from(equipmentInspectionGroups)
      .where(eq(equipmentInspectionGroups.inspectionTypeId, id))
      .orderBy(asc(equipmentInspectionGroups.sequence))
    const criteria = await tx
      .select({
        id: equipmentInspectionCriteria.id,
        groupId: equipmentInspectionCriteria.groupId,
        sequence: equipmentInspectionCriteria.sequence,
        question: equipmentInspectionCriteria.question,
        description: equipmentInspectionCriteria.description,
        kind: equipmentInspectionCriteria.kind,
        severity: equipmentInspectionCriteria.severity,
        requiresPhoto: equipmentInspectionCriteria.requiresPhoto,
        requiresComment: equipmentInspectionCriteria.requiresComment,
        isRequired: equipmentInspectionCriteria.isRequired,
        isCritical: equipmentInspectionCriteria.isCritical,
      })
      .from(equipmentInspectionCriteria)
      .where(eq(equipmentInspectionCriteria.inspectionTypeId, id))
      .orderBy(asc(equipmentInspectionCriteria.sequence))
    const allTypes = await tx
      .select({ id: equipmentTypes.id, name: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name))
    return { type, groups, criteria, allTypes }
  })

  if (!data) notFound()
  const { type, groups, criteria, allTypes } = data
  const activity = await recentActivityForEntity(ctx, 'equipment_inspection_type', id, 50)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/equipment/inspection-types', label: 'Back to inspection types' }}
          title={type.name}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {formatInterval(type.intervalValue, type.intervalUnit, { preUse: type.isPreUse })}
              </Badge>
              {!type.isActive ? <Badge variant="secondary">Inactive</Badge> : null}
            </div>
          }
          actions={
            <Link href={`/equipment/inspections/new?typeId=${id}`}>
              <Button variant="outline">
                <ClipboardCheck size={14} /> Start inspection
              </Button>
            </Link>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <EquipmentInspectionTypeBuilder
        type={{
          id: type.id,
          name: type.name,
          description: type.description,
          intervalValue: type.intervalValue,
          intervalUnit: type.intervalUnit,
          isPreUse: type.isPreUse,
          appliesToTypeId: type.appliesToTypeId,
          allowPassAll: type.allowPassAll,
          failsSpawnWorkOrders: type.failsSpawnWorkOrders,
          isActive: type.isActive,
        }}
        groups={groups}
        criteria={criteria}
        appliesToOptions={allTypes}
        activitySlot={<ActivityFeed entries={activity} timeZone={ctx.timezone} />}
      />
    </DetailPageLayout>
  )
}
