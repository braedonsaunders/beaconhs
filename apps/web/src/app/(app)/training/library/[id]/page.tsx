import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound } from 'next/navigation'
import { and, count, eq, isNull } from 'drizzle-orm'
import { DetailHeader } from '@beaconhs/ui'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { safeTrainingExternalUrl } from '@/lib/training-external-url'
import { configuredTrainingBlockedOrigins } from '@/lib/training-external-url.server'
import { DetailPageLayout } from '@/components/page-layout'
import { ContentItemEditor } from './_editor'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_02251624555d90', { value0: id.slice(0, 8) }) }
}

export default async function ContentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    const [it] = await tx
      .select()
      .from(trainingContentItems)
      .where(eq(trainingContentItems.id, id))
      .limit(1)
    if (!it) return null
    const [u] = await tx
      .select({ c: count() })
      .from(trainingLessons)
      .where(and(eq(trainingLessons.contentItemId, id), isNull(trainingLessons.deletedAt)))

    const [source] = it.sourceAttachmentId
      ? await tx
          .select({ filename: attachments.filename })
          .from(attachments)
          .where(eq(attachments.id, it.sourceAttachmentId))
          .limit(1)
      : []
    return { it, used: Number(u?.c ?? 0), source }
  })

  if (!data) notFound()
  const trainingUrlOptions = { blockedOrigins: configuredTrainingBlockedOrigins() }

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/library', label: 'Content Library' }}
          title={tGeneratedValue(data.it.title)}
          subtitle={tGenerated('m_10e52d390b591f')}
        />
      }
    >
      <ContentItemEditor
        item={{
          id: data.it.id,
          title: data.it.title,
          kind: data.it.kind,
          description: data.it.description ?? '',
          tags: data.it.tags ?? [],
          durationMinutes: data.it.durationMinutes,
          attachmentId: data.it.attachmentId,
          embedUrl: safeTrainingExternalUrl(data.it.embedUrl, trainingUrlOptions)?.url ?? null,
          contentHtml: data.it.contentHtml,
          sourceAttachmentId: data.it.sourceAttachmentId,
          sourceFilename: data.source?.filename ?? null,
        }}
        usedCount={data.used}
      />
    </DetailPageLayout>
  )
}
