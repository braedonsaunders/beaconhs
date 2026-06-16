import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights, canViewInsights } from '../_access'
import { loadCardsForPalette } from '../cards/_data'
import { loadLibrary } from './_data'
import { LibraryTabs } from './_library-tabs.client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Library · Insights' }

export default async function LibraryPage() {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')
  const [cards, lib] = await Promise.all([loadCardsForPalette(ctx), loadLibrary(ctx)])

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <PageHeader
        title="Library"
        description="Your cards and the dashboards shared across your team. Pin a dashboard to add it as a tab."
        actions={
          <div className="flex items-center gap-2">
            {canCreateInsights(ctx) ? (
              <Link href="/insights/cards/new">
                <Button type="button" className="h-9 text-xs">
                  <Plus size={14} className="mr-1" /> New card
                </Button>
              </Link>
            ) : null}
            <Link href="/insights">
              <Button type="button" variant="outline" className="h-9 text-xs">
                <ArrowLeft size={13} className="mr-1" /> Back to Insights
              </Button>
            </Link>
          </div>
        }
      />
      <LibraryTabs
        cards={cards.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          vizType: c.vizType,
          status: c.status,
        }))}
        dashboards={lib.dashboards}
      />
    </div>
  )
}
