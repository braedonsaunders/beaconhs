import { notFound } from 'next/navigation'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import { DetailHeader } from '@beaconhs/ui'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import { ContentItemEditor } from './_editor'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Library · ${id.slice(0, 8)}` }
}

export default async function ContentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

    // Media URLs for the slide editor preview.
    const attIds = new Set<string>()
    for (const s of it.slides ?? []) {
      if (s.imageAttachmentId) attIds.add(s.imageAttachmentId)
      for (const el of s.elements ?? []) {
        if (el.kind === 'image' && el.attachmentId) attIds.add(el.attachmentId)
      }
      for (const region of [s.body, s.left, s.right]) {
        const blocks = Array.isArray(region) ? region : []
        for (const b of blocks) {
          if (
            (b.type === 'image' || b.type === 'file' || b.type === 'video') &&
            'attachmentId' in b &&
            b.attachmentId
          ) {
            attIds.add(b.attachmentId)
          }
        }
      }
    }
    const atts = attIds.size
      ? await tx
          .select({ id: attachments.id, key: attachments.r2Key })
          .from(attachments)
          .where(inArray(attachments.id, [...attIds]))
      : []
    return { it, used: Number(u?.c ?? 0), atts }
  })

  if (!data) notFound()

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/library', label: 'Content Library' }}
          title={data.it.title}
          subtitle="Reusable library item"
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
          embedUrl: data.it.embedUrl,
          contentBlocks: data.it.contentBlocks ?? [],
          slides: data.it.slides ?? [],
          importStatus: data.it.importStatus,
          importError: data.it.importError,
        }}
        usedCount={data.used}
        attachmentUrls={Object.fromEntries(
          data.atts.map((a) => [a.id, a.key ? publicUrl(a.key) : null]),
        )}
      />
    </DetailPageLayout>
  )
}
