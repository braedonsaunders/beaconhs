// /people/crews — the flat Crews taxonomy people are assigned to
// (people.crewId). Standard list + create/rename flyout; delete refuses while
// the crew is still assigned. Gated to people who can manage the org.

import { crews, people } from '@beaconhs/db/schema'
import { NameTaxonomyList } from '../_components/name-taxonomy-list'
import { deleteCrew, saveCrew } from '../_actions/workforce'

export const metadata = { title: 'People — Crews' }
export const dynamic = 'force-dynamic'

export default function CrewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <NameTaxonomyList
      active="crews"
      base="/people/crews"
      title="Crews"
      description="The crews people are assigned to — one per person. Used for check-in, compliance audiences and reports."
      noun="crew"
      table={crews}
      assignmentColumn={people.crewId}
      saveAction={saveCrew}
      deleteAction={deleteCrew}
      searchParams={searchParams}
    />
  )
}
