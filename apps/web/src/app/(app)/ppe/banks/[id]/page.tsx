import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Badge, DetailHeader } from '@beaconhs/ui'
import { ppeCriteriaBankCriteria, ppeCriteriaBanks } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { PpeBankBuilder } from './_bank-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `PPE bank · ${id.slice(0, 8)}` }
}

export default async function PpeBankDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireModuleManage('ppe')

  const data = await ctx.db(async (tx) => {
    const [bank] = await tx
      .select()
      .from(ppeCriteriaBanks)
      .where(eq(ppeCriteriaBanks.id, id))
      .limit(1)
    if (!bank) return null
    const criteria = await tx
      .select({
        id: ppeCriteriaBankCriteria.id,
        sequence: ppeCriteriaBankCriteria.sequence,
        question: ppeCriteriaBankCriteria.question,
        description: ppeCriteriaBankCriteria.description,
        severity: ppeCriteriaBankCriteria.severity,
        requiresPhoto: ppeCriteriaBankCriteria.requiresPhoto,
      })
      .from(ppeCriteriaBankCriteria)
      .where(eq(ppeCriteriaBankCriteria.bankId, id))
      .orderBy(asc(ppeCriteriaBankCriteria.sequence))
    return { bank, criteria }
  })

  if (!data) notFound()
  const { bank, criteria } = data
  const activity = await recentActivityForEntity(ctx, 'ppe_criteria_bank', id, 50)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/ppe/banks', label: 'Back to criteria banks' }}
          title={bank.name}
          subtitle={bank.category ? bank.category.replace(/_/g, ' ') : undefined}
          badge={
            <Badge variant={bank.isPublished ? 'success' : 'secondary'}>
              {bank.isPublished ? 'Published' : 'Draft'}
            </Badge>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <PpeBankBuilder
        bank={{
          id: bank.id,
          name: bank.name,
          description: bank.description,
          category: bank.category,
          isPublished: bank.isPublished,
        }}
        criteria={criteria}
        activitySlot={<ActivityFeed entries={activity} />}
      />
    </DetailPageLayout>
  )
}
