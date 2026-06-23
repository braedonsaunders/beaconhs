// /feed — the company activity timeline. A read-only, infinite-scrolling stream
// of recent journals, incidents, corrective actions, and form submissions,
// scoped per-module to what the viewer is allowed to see (see _data.ts).

import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { getFeed, getFeedSummary } from './_data'
import { FeedTimeline } from './_feed'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Feed' }

export default async function FeedPage() {
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
          title="Activity feed"
          description="Everything happening across your organisation, newest first."
        />
      }
    >
      <FeedTimeline initial={initial} summary={summary} />
    </ListPageLayout>
  )
}
