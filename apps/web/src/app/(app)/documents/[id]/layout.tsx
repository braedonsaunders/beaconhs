import { isUuid } from '@/lib/list-params'
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
  return (
    <>
      {children}
      {model ? <DocumentEditorPortal model={model} /> : null}
    </>
  )
}
