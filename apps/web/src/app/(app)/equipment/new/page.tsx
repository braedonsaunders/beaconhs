import { Card, CardContent, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { LazyRecordProvider } from '@/components/lazy-record'
import { LiveField } from '@/components/live-field'
import { createEquipmentDraft, updateEquipmentName } from '../_draft-actions'

export const metadata = { title: 'Add equipment' }
export const dynamic = 'force-dynamic'

export default async function NewEquipmentPage() {
  await requireRequestContext()

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader
          title="Add equipment"
          description="Name the asset to get started — it saves as you type and opens the full editor. Leave without typing and nothing is created."
          back={{ href: '/equipment', label: 'Back to equipment' }}
        />
        <LazyRecordProvider
          createDraft={createEquipmentDraft}
          recordHref="/equipment/{id}?tab=edit"
        >
          <Card>
            <CardContent className="pt-6">
              <LiveField
                field="name"
                label="Name"
                initialValue=""
                placeholder="e.g. Genie S-65 Boom Lift"
                updateAction={updateEquipmentName}
              />
            </CardContent>
          </Card>
        </LazyRecordProvider>
      </div>
    </PageContainer>
  )
}
