import type { AnalyticsEntity } from '@beaconhs/analytics'
import type { ReportCustomQuery } from '@beaconhs/db/schema'
import type { CustomFieldEntityKind } from '@beaconhs/forms-core'

/** Physical analytics entity that owns each custom-field namespace. */
const CUSTOM_FIELD_ANALYTICS_ENTITY: Record<CustomFieldEntityKind, string> = {
  equipment: 'equipment_items',
  ppe: 'ppe_items',
  person: 'people',
  location: 'org_units',
}

/** Synthetic analytics key used for values stored at metadata.custom.<key>. */
export function customFieldAnalyticsColumn(key: string): string {
  return `cf_${key}`
}

/** Reports expose custom fields only on their owning base entity. */
export function reportQueryReferencesCustomField(
  query: ReportCustomQuery | null,
  kind: CustomFieldEntityKind,
  key: string,
): boolean {
  if (!query || query.entity !== CUSTOM_FIELD_ANALYTICS_ENTITY[kind]) return false
  const column = customFieldAnalyticsColumn(key)
  if (query.columns.includes(column)) return true
  if (query.breakouts?.some((breakout) => breakout.column === column)) return true
  if (query.measures?.some((measure) => measure.column === column)) return true
  if (query.groupBy === column || query.sort?.column === column) return true

  const stack = query.filters ? [query.filters] : []
  while (stack.length) {
    const group = stack.pop()!
    for (const rule of group.rules) {
      if ('rules' in rule) stack.push(rule)
      else if (rule.field === column) return true
    }
  }
  return false
}

/** Clone an analytics map with one custom column removed from its owner. */
export function entityMapWithoutCustomField(
  entityMap: Record<string, AnalyticsEntity>,
  kind: CustomFieldEntityKind,
  key: string,
): Record<string, AnalyticsEntity> {
  const entityKey = CUSTOM_FIELD_ANALYTICS_ENTITY[kind]
  const entity = entityMap[entityKey]
  if (!entity) return entityMap
  const column = customFieldAnalyticsColumn(key)
  if (!entity.columns.some((candidate) => candidate.key === column)) return entityMap
  return {
    ...entityMap,
    [entityKey]: {
      ...entity,
      columns: entity.columns.filter((candidate) => candidate.key !== column),
    },
  }
}

export type CustomFieldAnalyticsDependencies = {
  reports: number
  cards: number
}

export function customFieldDependencyMessage({
  reports,
  cards,
}: CustomFieldAnalyticsDependencies): string {
  const parts: string[] = []
  if (reports) parts.push(`${reports} saved report${reports === 1 ? '' : 's'}`)
  if (cards) parts.push(`${cards} Insights Card${cards === 1 ? '' : 's'}`)
  return `This field is used by ${parts.join(' and ')}. Remove those references before hiding or deleting it.`
}
