import { getGeneratedTranslations } from '@/i18n/generated.server'
// /feed — the company activity timeline. A read-only, infinite-scrolling stream
// of recent journals, incidents, corrective actions, and form submissions,
// scoped per-module to what the viewer is allowed to see (see _data.ts).

import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { getFeed, getFeedSummary } from './_data'
import { FeedTimeline } from './_feed'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_07f03a3df132f8') }
}

export default async function FeedPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  // The summary rail is best-effort — a count failure must not break the feed.
  const [initial, summary] = await Promise.all([
    getFeed(ctx, {}),
    getFeedSummary(ctx).catch(() => null),
  ])

  return (
    <ListPageLayout
      header={
        <PageHeader
          title={tGenerated('m_1f00bd25ea2dd1')}
          description={tGenerated('m_1d77ae60e97be1')}
        />
      }
    >
      <FeedTimeline initial={initial} summary={summary} />
    </ListPageLayout>
  )
}
