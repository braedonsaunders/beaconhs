import type { AnalyticsEntity } from '@beaconhs/analytics'
import {
  canAccessTemplate,
  type RequestContext,
  type TemplateAccessDescriptor,
} from '@beaconhs/tenant'

type AnalyticsTemplate = TemplateAccessDescriptor & { id: string; name: string }

/** Builder apps visible to analytics use the same operational policy as the
 * app launcher: live, published, and allowed for the current effective role. */
export function accessibleAnalyticsTemplates(
  ctx: RequestContext,
  templates: readonly AnalyticsTemplate[],
  effectiveRoleKeys: ReadonlySet<string>,
): AnalyticsTemplate[] {
  return templates.filter((template) =>
    canAccessTemplate(ctx, template, effectiveRoleKeys, 'operate'),
  )
}

/** Defence-in-depth for catalogs assembled from schema discovery. Raw Builder
 * storage is never a custom analytics source; only authorized scoped entities
 * are added after this filter. */
export function removeRawBuilderEntities(entities: readonly AnalyticsEntity[]): AnalyticsEntity[] {
  const scopedAppKey =
    /^form_responses:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const safe = entities.filter(
    (entity) => !entity.table.startsWith('form_') || scopedAppKey.test(entity.key),
  )
  const keys = new Set(safe.map((entity) => entity.key))
  return safe.map((entity) => ({
    ...entity,
    relations: entity.relations?.filter((relation) => keys.has(relation.target)),
  }))
}

/** Result-cache namespace. Active-role identity is included even if two roles
 * happen to authorize the same templates today, preventing role-switch cache
 * reuse and leaving revocation changes isolated by the authorized app set. */
export function analyticsAccessScopeKey(args: {
  activeRoleId?: string | null
  effectiveRoleKeys: ReadonlySet<string>
  templateIds: readonly string[]
}): string {
  return JSON.stringify({
    role: args.activeRoleId ?? 'all',
    roleKeys: [...args.effectiveRoleKeys].sort(),
    templates: [...args.templateIds].sort(),
  })
}
