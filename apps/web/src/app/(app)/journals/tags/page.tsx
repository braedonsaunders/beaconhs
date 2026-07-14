// /journals/tags — tenant admin manages the journal tag vocabulary: rename,
// merge duplicates, recolour, describe, and prune. Gated by journals.assign
// (same as Compliance). Mutations rewrite journal_entry_tags + the per-entry
// cache, so changes propagate across every entry.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { parseListParams, pickString } from '@/lib/list-params'
import { listManagedTags } from './_data'
import { TagsAdmin } from './_tags-admin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journal tags' }

const SORTS = ['usage'] as const

export default async function JournalTagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'journals.assign')) redirect('/journals')

  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'usage',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const requestedStatus = pickString(sp.status)
  const status =
    requestedStatus === 'defined' || requestedStatus === 'ad_hoc' ? requestedStatus : undefined
  const tags = await listManagedTags(ctx, {
    q: listParams.q,
    status,
    page: listParams.page,
    perPage: listParams.perPage,
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader title="Journal tags" description="Tag vocabulary for daily journals." />
          <ModuleNav moduleKey="journals" active="tags" />
        </>
      }
    >
      <TagsAdmin
        initialTags={tags.rows}
        total={tags.total}
        allTotal={tags.allTotal}
        totalUses={tags.totalUses}
        page={listParams.page}
        perPage={listParams.perPage}
        currentParams={sp}
      />
    </ListPageLayout>
  )
}
