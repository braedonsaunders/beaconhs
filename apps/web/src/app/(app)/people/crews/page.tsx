import { getGeneratedTranslations } from '@/i18n/generated.server'
import { useGeneratedTranslations } from '@/i18n/generated'
// /people/crews — the flat Crews taxonomy people are assigned to
// (people.crewId). Standard list + create/rename flyout; delete refuses while
// the crew is still assigned. Gated to people who can manage the org.

import { crews, people } from '@beaconhs/db/schema'
import { NameTaxonomyList } from '../_components/name-taxonomy-list'
import { deleteCrew, saveCrew } from '../_actions/workforce'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0382eac85d92a7') }
}
export const dynamic = 'force-dynamic'

export default function CrewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <NameTaxonomyList
      active="crews"
      base="/people/crews"
      title={tGenerated('m_1bb102ed438954')}
      description={tGenerated('m_16f81219425310')}
      noun="crew"
      table={crews}
      assignmentColumn={people.crewId}
      saveAction={saveCrew}
      deleteAction={deleteCrew}
      searchParams={searchParams}
    />
  )
}
