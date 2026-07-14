import 'server-only'

import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { parseBhqlQuery } from '@beaconhs/analytics'
import { discoverEntitiesWithScopedApps } from '@beaconhs/analytics/server'
import type { Database } from '@beaconhs/db'
import { formTemplates, insightCards, reportDefinitions, type BhqlQuery } from '@beaconhs/db/schema'
import type { CustomFieldEntityKind } from '@beaconhs/forms-core'
import {
  type CustomFieldAnalyticsDependencies,
  entityMapWithoutCustomField,
  reportQueryReferencesCustomField,
} from './analytics-dependency-policy'

function parsesBhql(query: BhqlQuery, entityMap: Parameters<typeof parseBhqlQuery>[1]): boolean {
  try {
    parseBhqlQuery(query, entityMap)
    return true
  } catch {
    return false
  }
}

/**
 * Find saved analytics plans that would become invalid if a custom field
 * disappeared. The caller holds an UPDATE lock on the definition; catalog
 * loading takes KEY SHARE locks, so concurrent report/Card saves serialize
 * against retirement instead of creating a late dangling reference.
 */
export async function findCustomFieldAnalyticsDependencies(
  tx: Database,
  tenantId: string,
  kind: CustomFieldEntityKind,
  key: string,
): Promise<CustomFieldAnalyticsDependencies> {
  const [templates, reports, cards] = await Promise.all([
    tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .where(isNull(formTemplates.deletedAt)),
    tx
      .select({ query: reportDefinitions.customQuery })
      .from(reportDefinitions)
      .where(
        and(
          eq(reportDefinitions.tenantId, tenantId),
          eq(reportDefinitions.kind, 'custom'),
          isNotNull(reportDefinitions.customQuery),
        ),
      ),
    tx
      .select({ query: insightCards.query })
      .from(insightCards)
      .where(and(eq(insightCards.tenantId, tenantId), isNull(insightCards.deletedAt))),
  ])

  const entities = await discoverEntitiesWithScopedApps(tx, templates)
  const before = Object.fromEntries(entities.map((entity) => [entity.key, entity]))
  const after = entityMapWithoutCustomField(before, kind, key)

  return {
    reports: reports.filter(({ query }) => reportQueryReferencesCustomField(query, kind, key))
      .length,
    cards: cards.filter(({ query }) => parsesBhql(query, before) && !parsesBhql(query, after))
      .length,
  }
}
