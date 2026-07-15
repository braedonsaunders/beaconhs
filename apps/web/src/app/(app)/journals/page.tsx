import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { getEntry, getWorkspaceData, listEntries } from './_data'
import { JournalWorkspace } from './_workspace'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_06f47737661294') }
}

export default async function JournalsPage() {
  const ctx = await requireRequestContext()
  const groupBy = 'date' as const

  const [data, recent] = await Promise.all([
    getWorkspaceData(ctx, groupBy, {}),
    // Open the user's OWN most-recent entry (the workspace is personal).
    listEntries(ctx, {}, { limit: 1 }, true),
  ])
  const initialEntry = recent[0] ? await getEntry(ctx, recent[0].id) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Desktop only — on a phone the entry header + Browse drawer carry nav,
          so the module tabs don't need a row of their own. */}
      <div className="hidden shrink-0 border-b border-slate-200 bg-white sm:block sm:px-4 sm:py-2 dark:border-slate-800 dark:bg-slate-900">
        <ModuleNav moduleKey="journals" active="workspace" />
      </div>
      <div className="min-h-0 flex-1">
        <JournalWorkspace initialData={data} initialEntry={initialEntry} initialGroupBy={groupBy} />
      </div>
    </div>
  )
}
