// /people/trades — the flat Trades taxonomy people are assigned to
// (people.tradeId). Standard list + create/rename flyout; delete refuses while
// the trade is still assigned. Gated to people who can manage the org.

import { people, trades } from '@beaconhs/db/schema'
import { NameTaxonomyList } from '../_components/name-taxonomy-list'
import { deleteTrade, saveTrade } from '../_actions/workforce'

export const metadata = { title: 'People — Trades' }
export const dynamic = 'force-dynamic'

export default function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <NameTaxonomyList
      active="trades"
      base="/people/trades"
      title="Trades"
      description="The trades people practise — one per person. Used for directory grouping, compliance audiences and reports."
      noun="trade"
      table={trades}
      assignmentColumn={people.tradeId}
      saveAction={saveTrade}
      deleteAction={deleteTrade}
      searchParams={searchParams}
    />
  )
}
