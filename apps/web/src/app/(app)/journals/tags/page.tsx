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
import { listManagedTags } from './_data'
import { TagsAdmin } from './_tags-admin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journal tags' }

export default async function JournalTagsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'journals.assign')) redirect('/journals')

  const tags = await listManagedTags(ctx)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader title="Journal tags" description="Tag vocabulary for daily journals." />
          <ModuleNav moduleKey="journals" active="tags" />
        </>
      }
    >
      <TagsAdmin initialTags={tags} />
    </ListPageLayout>
  )
}
