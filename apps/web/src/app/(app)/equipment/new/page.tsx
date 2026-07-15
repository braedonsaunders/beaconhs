import { getGeneratedTranslations } from '@/i18n/generated.server'
import { Card, CardContent, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { LazyRecordProvider } from '@/components/lazy-record'
import { LiveField } from '@/components/live-field'
import { createEquipmentDraft, updateEquipmentName } from '../_draft-actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_105ebaff0d3ac5') }
}
export const dynamic = 'force-dynamic'

export default async function NewEquipmentPage() {
  const tGenerated = await getGeneratedTranslations()
  await requireRequestContext()

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader
          title={tGenerated('m_105ebaff0d3ac5')}
          description={tGenerated('m_1310124269c3fc')}
          back={{ href: '/equipment', label: 'Back to equipment' }}
        />
        <LazyRecordProvider createDraft={createEquipmentDraft} recordHref="/equipment/{id}">
          <Card>
            <CardContent className="pt-6">
              <LiveField
                field="name"
                label={tGenerated('m_02b18d5c7f6f2d')}
                initialValue=""
                placeholder={tGenerated('m_06e0b8ac2ca0b1')}
                updateAction={updateEquipmentName}
              />
            </CardContent>
          </Card>
        </LazyRecordProvider>
      </div>
    </PageContainer>
  )
}
