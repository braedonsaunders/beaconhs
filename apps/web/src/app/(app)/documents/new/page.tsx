import { PageHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { NewDocumentForm } from './_new-document-form'

export const metadata = { title: 'New document' }

export default function NewDocumentPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="New document"
          description="Write the body in-app with rich text, or upload a PDF / DOCX as the v1 source. Publish + assign acknowledgements from the detail page once it's ready."
          back={{ href: '/documents', label: 'Back to documents' }}
        />
        <div className="mt-6">
          <NewDocumentForm />
        </div>
      </div>
    </PageContainer>
  )
}
