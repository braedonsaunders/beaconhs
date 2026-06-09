import { notFound } from 'next/navigation'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { documentDrafts, documentVersions, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import { listDocumentComments } from '../_actions'
import { DocumentEditor } from './_document-editor'
import type { LayoutState } from './_appbar'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Edit · ${id.slice(0, 8)}` }
}

export default async function DocumentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
    if (!doc) return null

    const [draft] = await tx
      .select()
      .from(documentDrafts)
      .where(eq(documentDrafts.documentId, id))
      .limit(1)

    // No draft yet (legacy / file doc): seed the editor from the latest
    // published version so the author never starts on a blank page. The first
    // autosave will materialize the draft row.
    let initialJson = (draft?.contentJson ?? null) as Record<string, unknown> | null
    let initialHtml = draft?.contentHtml ?? ''
    if (!draft) {
      const [pub] = await tx
        .select({ json: documentVersions.contentJson, html: documentVersions.contentMarkdown })
        .from(documentVersions)
        .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
        .orderBy(desc(documentVersions.version))
        .limit(1)
      initialJson = (pub?.json ?? null) as Record<string, unknown> | null
      initialHtml = pub?.html ?? ''
    }

    return { doc, initialJson, initialHtml }
  })

  if (!data) notFound()
  const { doc, initialJson, initialHtml } = data

  const aiSettings = await getTenantAiSettings(ctx)
  const aiEnabled = aiSettings.enabled && aiSettings.hasKey
  const comments = await listDocumentComments(id)

  const initialLayout: LayoutState = {
    pageSize: doc.pageSize === 'A4' ? 'A4' : 'Letter',
    headerText: doc.headerText ?? '',
    footerText: doc.footerText ?? '',
    printHeader: doc.printHeader,
    printFooter: doc.printFooter,
  }

  return (
    <DocumentEditor
      documentId={id}
      initialTitle={doc.title}
      initialHtml={initialHtml}
      initialJson={initialJson}
      initialLayout={initialLayout}
      initialComments={comments}
      aiEnabled={aiEnabled}
    />
  )
}
