import { getGeneratedTranslations } from '@/i18n/generated.server'
import { useGeneratedTranslations } from '@/i18n/generated'
// /people/trades — the flat Trades taxonomy people are assigned to
// (people.tradeId). Standard list + create/rename flyout; delete refuses while
// the trade is still assigned. Gated to people who can manage the org.

import { people, trades } from '@beaconhs/db/schema'
import { NameTaxonomyList } from '../_components/name-taxonomy-list'
import { deleteTrade, saveTrade } from '../_actions/workforce'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_09fb0ecb08fab7') }
}
export const dynamic = 'force-dynamic'

export default function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <NameTaxonomyList
      active="trades"
      base="/people/trades"
      title={tGenerated('m_0b8f72486dc279')}
      description={tGenerated('m_0bd0e0d7ef8101')}
      noun="trade"
      table={trades}
      assignmentColumn={people.tradeId}
      saveAction={saveTrade}
      deleteAction={deleteTrade}
      searchParams={searchParams}
    />
  )
}
