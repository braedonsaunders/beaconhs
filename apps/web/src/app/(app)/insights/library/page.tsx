import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights, canViewInsights } from '../_access'
import { loadCardsForPalette } from '../cards/_data'
import { ensureSystemCards } from '../_system-cards'
import { loadLibraryDashboards } from './_data'
import { LibraryTabs } from './_library-tabs.client'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a53ccdfb8e7be') }
}

export default async function LibraryPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')
  // Seed the built-in BHQL cards (idempotent) so the Library is populated even
  // when this page is the first one the user lands on.
  await ensureSystemCards(ctx)
  const [cards, dashboards] = await Promise.all([
    loadCardsForPalette(ctx),
    loadLibraryDashboards(ctx),
  ])

  return (
    <div className="app-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-4 lg:p-6">
      <PageHeader
        title={tGenerated('m_002a2afc4c73f9')}
        description={tGenerated('m_076a7b0910891f')}
        actions={
          <div className="flex items-center gap-2">
            <GeneratedValue
              value={
                canCreateInsights(ctx) ? (
                  <Link href="/insights/cards/new">
                    <Button type="button" className="h-9 text-xs">
                      <Plus size={14} className="mr-1" /> <GeneratedText id="m_03e463ccb0a147" />
                    </Button>
                  </Link>
                ) : null
              }
            />
            <Link href="/insights">
              <Button type="button" variant="outline" className="h-9 text-xs">
                <ArrowLeft size={13} className="mr-1" /> <GeneratedText id="m_1170723b40d679" />
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
        dashboards={dashboards}
      />
    </div>
  )
}
