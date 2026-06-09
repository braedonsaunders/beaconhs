// /feed — the company activity timeline. A read-only, infinite-scrolling stream
// of recent journals, incidents, corrective actions, and form submissions,
// scoped per-module to what the viewer is allowed to see (see _data.ts).

import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { getFeed } from './_data'
import { FeedTimeline } from './_feed'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Feed' }

export default async function FeedPage() {
  const ctx = await requireRequestContext()
  const initial = await getFeed(ctx, {})

  return (
    <ListPageLayout
      header={
        <PageHeader
          title="Feed"
          description="Recent activity across the team — journals, incidents, corrective actions, and forms, filtered to what you’re allowed to see."
        />
      }
    >
      <FeedTimeline initial={initial} />
    </ListPageLayout>
  )
}
