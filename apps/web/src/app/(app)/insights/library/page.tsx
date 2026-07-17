import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button, PageHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canCreateInsights, canViewInsights } from '../_access'
import { loadCardsForPalette } from '../cards/_data'
import { ensureSystemCards } from '../_system-cards'
import { loadLibraryDashboards } from './_data'
import { LibraryTabs } from './_library-tabs.client'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a53ccdfb8e7be') }
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) redirect('/dashboard')
  // Seed the built-in BHQL cards (idempotent) so the Library is populated even
  // when this page is the first one the user lands on.
  await ensureSystemCards(ctx)
  const [cards, dashboards, currentParams] = await Promise.all([
    loadCardsForPalette(ctx),
    loadLibraryDashboards(ctx),
    searchParams,
  ])
  const tab = pickString(currentParams.tab) === 'dashboards' ? 'dashboards' : 'cards'
  const status = pickString(currentParams.status)
  const list = parseListParams(currentParams, {
    sort: 'name',
    dir: 'asc',
    perPage: 18,
    allowedSorts: ['name'] as const,
  })
  const needle = list.q?.trim().toLowerCase()
  const direction = list.dir === 'asc' ? 1 : -1
  const filteredCards = cards
    .filter(
      (card) =>
        (!needle ||
          card.name.toLowerCase().includes(needle) ||
          (card.description ?? '').toLowerCase().includes(needle)) &&
        (!status || status === 'all' || card.status === status),
    )
    .sort((left, right) => direction * left.name.localeCompare(right.name))
  const filteredDashboards = dashboards
    .filter((dashboard) => !needle || dashboard.name.toLowerCase().includes(needle))
    .sort((left, right) => direction * left.name.localeCompare(right.name))
  const activeItems = tab === 'cards' ? filteredCards : filteredDashboards
  const pageStart = (list.page - 1) * list.perPage
  const pageCards = tab === 'cards' ? filteredCards.slice(pageStart, pageStart + list.perPage) : []
  const pageDashboards =
    tab === 'dashboards' ? filteredDashboards.slice(pageStart, pageStart + list.perPage) : []

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
        canExport={can(ctx, 'admin.data.export') && !ctx.impersonation}
        tab={tab}
        query={list.q ?? ''}
        page={list.page}
        perPage={list.perPage}
        total={activeItems.length}
        cardCount={cards.length}
        dashboardCount={dashboards.length}
        currentParams={currentParams}
        cards={pageCards.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          vizType: c.vizType,
          status: c.status,
        }))}
        dashboards={pageDashboards}
      />
    </div>
  )
}
