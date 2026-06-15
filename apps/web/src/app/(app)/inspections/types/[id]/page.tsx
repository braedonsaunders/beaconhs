import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { ClipboardCheck } from 'lucide-react'
import { Badge, Button, DetailHeader } from '@beaconhs/ui'
import {
  inspectionBankCriteria,
  inspectionBanks,
  inspectionTypeCriteria,
  inspectionTypeGroups,
  inspectionTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { InspectionTypeBuilder } from './_type-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Inspection type · ${id.slice(0, 8)}` }
}

export default async function InspectionTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireModuleManage('inspections')

  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(inspectionTypes)
      .where(and(eq(inspectionTypes.id, id), isNull(inspectionTypes.deletedAt)))
      .limit(1)
    if (!type) return null
    const groups = await tx
      .select({
        id: inspectionTypeGroups.id,
        label: inspectionTypeGroups.label,
        sequence: inspectionTypeGroups.sequence,
      })
      .from(inspectionTypeGroups)
      .where(eq(inspectionTypeGroups.typeId, id))
      .orderBy(asc(inspectionTypeGroups.sequence))
    const criteria = await tx
      .select({
        id: inspectionTypeCriteria.id,
        groupId: inspectionTypeCriteria.groupId,
        sequence: inspectionTypeCriteria.sequence,
        text: inspectionTypeCriteria.text,
        responseType: inspectionTypeCriteria.responseType,
        requiresPhoto: inspectionTypeCriteria.requiresPhoto,
        requiresComment: inspectionTypeCriteria.requiresComment,
      })
      .from(inspectionTypeCriteria)
      .where(eq(inspectionTypeCriteria.typeId, id))
      .orderBy(asc(inspectionTypeCriteria.sequence))
    const banks = await tx
      .select({
        id: inspectionBanks.id,
        name: inspectionBanks.name,
        category: inspectionBanks.category,
        criteriaCount: sql<number>`count(${inspectionBankCriteria.id})`.mapWith(Number),
      })
      .from(inspectionBanks)
      .leftJoin(inspectionBankCriteria, eq(inspectionBankCriteria.bankId, inspectionBanks.id))
      .where(eq(inspectionBanks.isPublished, true))
      .groupBy(inspectionBanks.id)
      .orderBy(asc(inspectionBanks.name))
    return { type, groups, criteria, banks }
  })

  if (!data) notFound()
  const { type, groups, criteria, banks } = data
  const activity = await recentActivityForEntity(ctx, 'inspection_type', id, 50)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/types', label: 'Back to inspection types' }}
          title={type.name}
          badge={
            <Badge variant={type.isPublished ? 'success' : 'secondary'}>
              {type.isPublished ? 'Published' : 'Draft'}
            </Badge>
          }
          actions={
            <Link href={`/inspections/records/new?typeId=${id}`}>
              <Button variant="outline">
                <ClipboardCheck size={14} /> Start inspection
              </Button>
            </Link>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <InspectionTypeBuilder
        type={{
          id: type.id,
          name: type.name,
          description: type.description,
          defaultCadence: type.defaultCadence,
          requiresForeman: type.requiresForeman,
          requiresCustomerSignature: type.requiresCustomerSignature,
          enableCorrectiveActions: type.enableCorrectiveActions,
          allowCompliantNotes: type.allowCompliantNotes,
          isPublished: type.isPublished,
        }}
        groups={groups}
        criteria={criteria}
        banks={banks}
        activitySlot={<ActivityFeed entries={activity} />}
      />
    </DetailPageLayout>
  )
}
