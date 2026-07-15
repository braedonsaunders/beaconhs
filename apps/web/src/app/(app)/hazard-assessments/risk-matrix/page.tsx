import { getGeneratedTranslations } from '@/i18n/generated.server'
// Risk matrix editor — lives in the Hazard Assessments Manage hub. Gated by the
// hazid module permission; loads the tenant's saved matrix (or the default) and
// hands it to the client editor. Saving flows back to every assessment via the
// <RiskMatrixProvider> in the app shell.

import { eq } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { PageContainer } from '@/components/page-layout'
import { DEFAULT_RISK_MATRIX } from '@/components/risk-matrix'
import { HazidSubNav } from '../_subnav'
import { RiskMatrixEditor } from './_editor'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0813de4dcd849e') }
}
export const dynamic = 'force-dynamic'

export default async function RiskMatrixPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireModuleManage('hazid')

  const saved = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ riskMatrix: tenants.riskMatrix })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId as string))
      .limit(1)
    return t?.riskMatrix ?? null
  })

  const initial =
    saved?.axes?.severity?.values?.length &&
    saved?.axes?.likelihood?.values?.length &&
    saved?.cells &&
    Object.keys(saved.cells).length > 0
      ? saved
      : DEFAULT_RISK_MATRIX

  return (
    <PageContainer>
      <div className="space-y-4">
        <HazidSubNav pathname="/hazard-assessments/risk-matrix" />
        <PageHeader
          title={tGenerated('m_0813de4dcd849e')}
          description={tGenerated('m_021d77600c13a0')}
        />
        <RiskMatrixEditor initial={initial} />
      </div>
    </PageContainer>
  )
}
