// Card loaders (plain server functions — not actions).

import { and, asc, desc, eq, isNull, or } from 'drizzle-orm'
import {
  formTemplates,
  insightCards,
  type BhqlQuery,
  type InsightCardConfig,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { discoverEntitiesWithCustomFields, scopedFormAppEntity } from '@beaconhs/analytics/server'
import type { AnalyticsEntity } from '@beaconhs/analytics'
import { canSeePublishedInsight, getInsightRoleKeys } from '../_visibility'

export type CardKind = 'question' | 'model' | 'metric' | 'ai'

export type CardRow = {
  id: string
  name: string
  description: string | null
  kind: CardKind
  query: BhqlQuery
  vizType: string
  vizSettings: Record<string, unknown>
  config: InsightCardConfig | null
  status: 'draft' | 'published'
  createdBy: string | null
  allowedRoles: string[] | null
}

const SELECT = {
  id: insightCards.id,
  name: insightCards.name,
  description: insightCards.description,
  kind: insightCards.kind,
  query: insightCards.query,
  vizType: insightCards.vizType,
  vizSettings: insightCards.vizSettings,
  config: insightCards.config,
  status: insightCards.status,
  createdBy: insightCards.createdBy,
  allowedRoles: insightCards.allowedRoles,
}

function map(row: CardRow): CardRow {
  return { ...row }
}

export async function loadCard(ctx: RequestContext, id: string): Promise<CardRow | null> {
  const [row] = await ctx.db((tx) =>
    tx
      .select(SELECT)
      .from(insightCards)
      .where(and(eq(insightCards.id, id), isNull(insightCards.deletedAt)))
      .limit(1),
  )
  if (!row) return null
  if (row.createdBy === ctx.userId) return map(row)
  const roleKeys = await getInsightRoleKeys(ctx)
  if (row.status === 'published' && canSeePublishedInsight(ctx, row.allowedRoles, roleKeys)) {
    return map(row)
  }
  return null
}

/** Reusable Metric cards (kind='metric') the user can reference in another card:
 *  their own + any published. Returns the id, name and source entity so the
 *  builder can offer them + grain-map against the metric's source. */
export async function loadMetricCards(
  ctx: RequestContext,
): Promise<{ id: string; name: string; source: string }[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: insightCards.id,
        name: insightCards.name,
        query: insightCards.query,
        createdBy: insightCards.createdBy,
        status: insightCards.status,
        allowedRoles: insightCards.allowedRoles,
      })
      .from(insightCards)
      .where(
        and(
          eq(insightCards.kind, 'metric'),
          isNull(insightCards.deletedAt),
          or(eq(insightCards.createdBy, ctx.userId), eq(insightCards.status, 'published')),
        ),
      )
      .orderBy(desc(insightCards.updatedAt)),
  )
  const roleKeys = await getInsightRoleKeys(ctx)
  return rows
    .filter(
      (r) =>
        r.createdBy === ctx.userId ||
        (r.status === 'published' && canSeePublishedInsight(ctx, r.allowedRoles, roleKeys)),
    )
    .map((r) => ({ id: r.id, name: r.name, source: r.query?.stages?.[0]?.source ?? '' }))
}

/** Cards available to drop on a dashboard: the user's own + any published. */
export async function loadCardsForPalette(ctx: RequestContext): Promise<CardRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select(SELECT)
      .from(insightCards)
      .where(
        and(
          isNull(insightCards.deletedAt),
          or(eq(insightCards.createdBy, ctx.userId), eq(insightCards.status, 'published')),
        ),
      )
      .orderBy(desc(insightCards.updatedAt)),
  )
  const roleKeys = await getInsightRoleKeys(ctx)
  return rows
    .filter(
      (r) =>
        r.createdBy === ctx.userId ||
        (r.status === 'published' && canSeePublishedInsight(ctx, r.allowedRoles, roleKeys)),
    )
    .map(map)
}

/** Entities for the card studio source picker: the schema-discovered entities PLUS
 *  one scoped entity per Builder app (the form_responses table scoped to that
 *  template), so each app is its own data source instead of a single "Builder
 *  apps" bucket. The scope rides in the entity key (`form_responses:<templateId>`),
 *  so a saved card re-renders with no tenant lookup. */
export async function loadStudioEntities(ctx: RequestContext): Promise<AnalyticsEntity[]> {
  const apps = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .where(and(eq(formTemplates.tenantId, ctx.tenantId), isNull(formTemplates.deletedAt)))
      .orderBy(asc(formTemplates.name)),
  )
  const appEntities = apps
    .map((a) => scopedFormAppEntity(a.id, a.name))
    .filter((e): e is AnalyticsEntity => e != null)
  const base = await ctx.db((tx) => discoverEntitiesWithCustomFields(tx))
  return [...base, ...appEntities]
}
