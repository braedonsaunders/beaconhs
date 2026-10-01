import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { FilterChips } from './filter-bar'

/** Shared active / historical choice policy for people-based record filters. */
export async function PeopleStatusFilter({
  basePath,
  currentParams,
  personParamKey,
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  personParamKey: string
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  return (
    <FilterChips
      basePath={basePath}
      currentParams={currentParams}
      paramKey="peopleStatus"
      label={tGeneratedValue('People')}
      defaultValue="active"
      hideAll
      clearParams={[personParamKey]}
      options={[
        { value: 'active', label: 'Active only' },
        { value: 'all', label: 'Include inactive' },
      ]}
    />
  )
}
