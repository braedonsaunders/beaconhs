import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { tenantNotificationPolicy } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { PageHeader, Button } from '@beaconhs/ui'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { EquipmentReminderForm } from './_form'
export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Equipment reminders') }
}
export const dynamic = 'force-dynamic'
export default async function EquipmentReminderSettingsPage() {
  const t = await getGeneratedValueTranslations(),
    ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const [policy] = await ctx.db((tx) =>
    tx
      .select()
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, ctx.tenantId))
      .limit(1),
  )
  return (
    <PageContainer>
      <PageHeader
        title={t('Equipment reminders')}
        actions={
          <Link href="/equipment/maintenance">
            <Button variant="outline">
              <GeneratedValue value="Maintenance" />
            </Button>
          </Link>
        }
      />
      <EquipmentSubNav active="maintenance" />
      <EquipmentReminderForm
        enabled={policy?.equipmentRemindersEnabled ?? true}
        cron={policy?.equipmentReminderCron ?? '0 6 * * *'}
        timezone={policy?.scanTimezone ?? 'UTC'}
      />
    </PageContainer>
  )
}
