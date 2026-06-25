import { notFound } from 'next/navigation'
import { Card, CardContent, PageHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { LazyRecordProvider } from '@/components/lazy-record'
import { LiveField } from '@/components/live-field'
import { createBlankDocument, updateDocumentTitle } from '../_actions'

export const metadata = { title: 'New document' }
export const dynamic = 'force-dynamic'

export default async function NewDocumentPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'documents.manage')) notFound()

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader
          title="New document"
          description="Name it to get started — it saves as you type and opens the editor. Leave without typing and nothing is created."
          back={{ href: '/documents', label: 'Back to documents' }}
        />
        <LazyRecordProvider createDraft={createBlankDocument} recordHref="/documents/{id}">
          <Card>
            <CardContent className="pt-6">
              <LiveField
                field="title"
                label="Title"
                initialValue=""
                placeholder="e.g. Site Safety Manual"
                updateAction={updateDocumentTitle}
              />
            </CardContent>
          </Card>
        </LazyRecordProvider>
      </div>
    </PageContainer>
  )
}
