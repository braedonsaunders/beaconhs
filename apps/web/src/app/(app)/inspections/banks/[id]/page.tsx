import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { Badge, DetailHeader } from '@beaconhs/ui'
import { inspectionBankCriteria, inspectionBanks } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recentActivityForEntity } from '@/lib/audit'
import { DetailPageLayout } from '@/components/page-layout'
import { ActivityFeed } from '@/components/activity-feed'
import { isUuid } from '@/lib/list-params'
import { InspectionBankBuilder } from './_bank-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_10ce03c64bd970', { value0: id.slice(0, 8) }) }
}

export default async function InspectionBankDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireModuleManage('inspections')

  const data = await ctx.db(async (tx) => {
    const [bank] = await tx
      .select()
      .from(inspectionBanks)
      .where(eq(inspectionBanks.id, id))
      .limit(1)
    if (!bank) return null
    const criteria = await tx
      .select({
        id: inspectionBankCriteria.id,
        sequence: inspectionBankCriteria.sequence,
        text: inspectionBankCriteria.text,
        responseType: inspectionBankCriteria.responseType,
        choiceOptions: inspectionBankCriteria.choiceOptions,
        requiresPhoto: inspectionBankCriteria.requiresPhoto,
        requiresComment: inspectionBankCriteria.requiresComment,
      })
      .from(inspectionBankCriteria)
      .where(eq(inspectionBankCriteria.bankId, id))
      .orderBy(asc(inspectionBankCriteria.sequence))
    return { bank, criteria }
  })

  if (!data) notFound()
  const { bank, criteria } = data
  const activity = await recentActivityForEntity(ctx, 'inspection_bank', id, 50)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/banks', label: 'Back to banks' }}
          title={tGeneratedValue(bank.name)}
          subtitle={tGeneratedValue(bank.category ? bank.category.replace(/_/g, ' ') : undefined)}
          badge={
            <Badge variant={bank.isPublished ? 'success' : 'secondary'}>
              <GeneratedValue
                value={
                  bank.isPublished ? (
                    <GeneratedText id="m_0a65097103ae1b" />
                  ) : (
                    <GeneratedText id="m_13f3db1d0ca2fe" />
                  )
                }
              />
            </Badge>
          }
        />
      }
      className="h-full max-w-none p-0"
    >
      <InspectionBankBuilder
        bank={{
          id: bank.id,
          name: bank.name,
          description: bank.description,
          category: bank.category,
          isPublished: bank.isPublished,
        }}
        criteria={criteria}
        activitySlot={
          <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
        }
      />
    </DetailPageLayout>
  )
}
