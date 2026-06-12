import { PageHeader } from '@beaconhs/ui'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { ListPageLayout } from '@/components/page-layout'
import { requireRequestContext } from '@/lib/auth'
import { CREDENTIAL_DESIGN_SETTINGS_KEY, normalizeCredentialDesign } from '@/lib/credential-designs'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { CredentialDesignStudio } from './studio'
import { saveCredentialDesign } from './_actions'

export const metadata = { title: 'Credential Designs' }

export default async function CredentialDesignsPage() {
  const ctx = await requireRequestContext()
  const initialDesign = await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return normalizeCredentialDesign(
      (tenant?.settings as Record<string, unknown> | undefined)?.[CREDENTIAL_DESIGN_SETTINGS_KEY],
    )
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Credential Designs"
            description="Design certificate and wallet-card output for training credentials."
          />
          <TrainingSubNav active="credential-designs" />
        </>
      }
    >
      <CredentialDesignStudio initialDesign={initialDesign} onSave={saveCredentialDesign} />
    </ListPageLayout>
  )
}
