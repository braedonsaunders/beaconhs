import { PageHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { NewReferenceForm } from './new-reference-form'

export const metadata = { title: 'New reference' }

export default function NewReferencePage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="New reference"
          description="Point to an external file or URL. Use this for SDS sheets, equipment manuals, standards, or other reference material you don't need to version inside the platform."
          back={{ href: '/documents/reference', label: 'Back to references' }}
        />
        <NewReferenceForm />
      </div>
    </PageContainer>
  )
}
