import { redirect } from 'next/navigation'
import { PageHeader } from '@beaconhs/ui'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { ListPageLayout } from '@/components/page-layout'
import { requireRequestContext } from '@/lib/auth'
import { normalizeCredentialOutputs } from '@/lib/credential-designs'
import { canDesignTrainingCredentials } from '@/lib/training-credential-access'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { CredentialDesignStudio } from './studio'
import { saveCredentialOutputs } from './_actions'

export const metadata = { title: 'Card studio' }

export default async function CredentialDesignsPage() {
  const ctx = await requireRequestContext()
  if (!canDesignTrainingCredentials(ctx)) redirect('/training')

  const initialOutputs = await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return normalizeCredentialOutputs(tenant?.settings)
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Card studio"
            description="Design the certificates and wallet cards available from training records and skills."
          />
          <TrainingSubNav active="credential-designs" />
        </>
      }
    >
      <CredentialDesignStudio initialOutputs={initialOutputs} onSave={saveCredentialOutputs} />
    </ListPageLayout>
  )
}
