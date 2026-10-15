import { isUuid } from '@/lib/list-params'
import { OfflineRecordProvider } from '@/lib/offline-drafts/offline-record'
import { loadDocumentEditorModel } from './_editor-model'
import { DocumentEditorPortal } from './_editor-portal'

export default async function DocumentDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) return children
  const model = await loadDocumentEditorModel(id)
  // Readers (no model) use the read page and edit nothing.
  if (!model) return children
  // One record provider for the whole authoring workspace: the Overview
  // metadata queues edits on this device, and they keep syncing while
  // another tab is open — so Publish and the PDF preview (in the editor pane)
  // always wait for them through flushRecordSaves().
  return (
    <OfflineRecordProvider module="documents" recordId={id}>
      {children}
      <DocumentEditorPortal model={model} />
    </OfflineRecordProvider>
  )
}
