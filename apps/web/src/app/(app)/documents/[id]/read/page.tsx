import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound } from 'next/navigation'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { documentAcknowledgments, documentVersions, documents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { DocumentReader } from './_reader'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0431e4b7409595') }
}

export default async function DocumentReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  const canManage = ctx.isSuperAdmin || can(ctx, 'documents.manage')
  const canRead = canManage || can(ctx, 'documents.read')
  if (!canRead) notFound()
  const canAcknowledge = ctx.isSuperAdmin || can(ctx, 'documents.acknowledge')

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({
        id: documents.id,
        title: documents.title,
        key: documents.key,
        status: documents.status,
      })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc) return null
    if (!canManage && doc.status !== 'published') return null

    const [publishedVersion] = await tx
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
      })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    const myAck =
      ctx.personId && publishedVersion
        ? ((
            await tx
              .select({ acknowledgedAt: documentAcknowledgments.acknowledgedAt })
              .from(documentAcknowledgments)
              .where(
                and(
                  eq(documentAcknowledgments.documentId, id),
                  eq(documentAcknowledgments.personId, ctx.personId),
                  eq(documentAcknowledgments.versionId, publishedVersion.id),
                ),
              )
              .orderBy(desc(documentAcknowledgments.acknowledgedAt))
              .limit(1)
          )[0] ?? null)
        : null

    return { doc, publishedVersion: publishedVersion ?? null, myAck }
  })

  if (!data) notFound()

  const selfStatus: 'can' | 'acked' | 'unpublished' | 'no-person' | 'no-permission' =
    !canAcknowledge
      ? 'no-permission'
      : !ctx.personId
        ? 'no-person'
        : data.myAck
          ? 'acked'
          : !data.publishedVersion
            ? 'unpublished'
            : 'can'

  return (
    <DocumentReader
      documentId={id}
      title={data.doc.title}
      documentKey={data.doc.key}
      versionNumber={data.publishedVersion?.version ?? null}
      selfStatus={selfStatus}
      selfAckedAt={data.myAck?.acknowledgedAt.toISOString() ?? null}
      canManage={canManage}
    />
  )
}
