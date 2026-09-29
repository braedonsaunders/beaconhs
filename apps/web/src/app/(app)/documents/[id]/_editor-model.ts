import 'server-only'

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { attachments, documentVersions, documents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import { isUuid } from '@/lib/list-params'
import type { DocumentMode } from './_mode-switch'

export type DocumentEditorModel = {
  documentId: string
  defaultMode: DocumentMode
  master: { attachmentId: string; filename: string } | null
  latestPublished: { version: number; renderStatus: string | null } | null
  aiEnabled: boolean
}

/** Props for the write/PDF pane. Null for readers; they use the read page. */
export async function loadDocumentEditorModel(
  documentId: string,
): Promise<DocumentEditorModel | null> {
  if (!isUuid(documentId)) return null
  const ctx = await requireRequestContext()
  const canManage = ctx.isSuperAdmin || can(ctx, 'documents.manage')
  if (!canManage) return null

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc) return null

    const [published] = await tx
      .select({
        version: documentVersions.version,
        renderStatus: documentVersions.renderStatus,
      })
      .from(documentVersions)
      .where(
        and(eq(documentVersions.documentId, documentId), isNotNull(documentVersions.publishedAt)),
      )
      .orderBy(desc(documentVersions.version))
      .limit(1)

    const [current] = await tx
      .select({ contentAttachmentId: documentVersions.contentAttachmentId })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    const [master] = doc.sourceAttachmentId
      ? await tx
          .select({ id: attachments.id, filename: attachments.filename })
          .from(attachments)
          .where(eq(attachments.id, doc.sourceAttachmentId))
          .limit(1)
      : []

    return {
      sourceAttachmentId: doc.sourceAttachmentId,
      published: published ?? null,
      contentAttachmentId: current?.contentAttachmentId ?? null,
      master: master ?? null,
    }
  })
  if (!data) return null

  const ai = await getTenantAiSettings(ctx)
  const isFileDoc = !data.sourceAttachmentId && Boolean(data.contentAttachmentId)
  return {
    documentId,
    defaultMode: isFileDoc ? 'pdf' : 'write',
    master: data.master ? { attachmentId: data.master.id, filename: data.master.filename } : null,
    latestPublished: data.published
      ? { version: data.published.version, renderStatus: data.published.renderStatus }
      : null,
    aiEnabled: ai.enabled && ai.hasKey,
  }
}
