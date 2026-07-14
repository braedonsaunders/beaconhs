// Full-screen Writer for a document's DOCX master. Editing happens inline in
// Collabora (page setup, comments and track changes live in the file);
// `?version=<id>` opens a published snapshot read-only instead. Publishing and
// import/replace live on the document page's Write pane.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { Download } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { attachments, documentVersions, documents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { SmartBackLink } from '@/components/smart-back-link'
import { isUuid } from '@/lib/list-params'
import { DocumentWriter } from './_writer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Edit · ${id.slice(0, 8)}` }
}

export default async function DocumentEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const versionId = typeof sp.version === 'string' ? sp.version : null
  if (!isUuid(id) || (versionId !== null && !isUuid(versionId))) notFound()

  const ctx = await requireRequestContext()
  // The live master is a manage-only surface (it exposes unpublished edits).
  if (!can(ctx, 'documents.manage')) notFound()
  // The Write pane on the document page is THE editing surface (with AI panel
  // and fullscreen). This route only serves read-only version snapshots.
  if (!versionId) redirect(`/documents/${id}`)

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({
        title: documents.title,
        key: documents.key,
        sourceAttachmentId: documents.sourceAttachmentId,
      })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc) return null

    let viewingVersion: { id: string; version: number; docxAttachmentId: string } | null = null
    if (versionId) {
      const [v] = await tx
        .select({
          id: documentVersions.id,
          version: documentVersions.version,
          docxAttachmentId: documentVersions.docxAttachmentId,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, id),
            isNotNull(documentVersions.publishedAt),
          ),
        )
        .limit(1)
      if (!v?.docxAttachmentId) return null
      viewingVersion = { id: v.id, version: v.version, docxAttachmentId: v.docxAttachmentId }
    }

    const [latest] = await tx
      .select({ version: documentVersions.version })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    const masterAttachmentId = viewingVersion?.docxAttachmentId ?? doc.sourceAttachmentId
    const att = masterAttachmentId
      ? await tx
          .select({ id: attachments.id, filename: attachments.filename })
          .from(attachments)
          .where(eq(attachments.id, masterAttachmentId))
          .limit(1)
      : []

    return { doc, viewingVersion, latestVersion: latest?.version ?? null, att: att[0] ?? null }
  })
  if (!data) notFound()

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        <SmartBackLink href={`/documents/${id}`} label="Back" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {data.doc.title}
          </h1>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {data.viewingVersion
              ? `Version ${data.viewingVersion.version} — read-only snapshot`
              : data.latestVersion
                ? `Working draft — last published v${data.latestVersion}`
                : 'Working draft — never published'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {data.viewingVersion ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/documents/${id}/editor`}>Back to draft</Link>
            </Button>
          ) : null}
          {data.att ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={
                  data.viewingVersion
                    ? `/documents/${id}/versions/${data.viewingVersion.id}/download?kind=docx`
                    : `/documents/${id}/master`
                }
              >
                <Download size={13} /> DOCX
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <DocumentWriter
        documentId={id}
        versionId={data.viewingVersion?.id ?? null}
        attachmentId={data.att?.id ?? null}
      />
    </div>
  )
}
