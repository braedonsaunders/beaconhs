import 'server-only'

import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { formResponses, formTemplates } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { isUuid } from '@/lib/list-params'
import {
  canAccessTemplate,
  isTemplateBuilder,
  type TemplateAccessDescriptor,
  type TemplateAccessMode,
} from './access-policy'

export { canAccessTemplate, canEditResponsePayload, isTemplateBuilder } from './access-policy'

function roleKeyArray(roleKeys: ReadonlySet<string>): SQL {
  return sql`array[${sql.join(
    [...roleKeys].map((role) => sql`${role}`),
    sql`, `,
  )}]::text[]`
}

/** SQL equivalent of canAccessTemplate for queries joining form_templates. */
export function templateAccessWhere(
  ctx: RequestContext,
  effectiveRoleKeys: ReadonlySet<string>,
  mode: TemplateAccessMode,
): SQL {
  const live = isNull(formTemplates.deletedAt)
  const builder = isTemplateBuilder(ctx)

  if (mode === 'builder-edit') {
    return builder ? live : sql`false`
  }
  if (mode === 'browse-records' && builder) return live

  const published = eq(formTemplates.status, 'published')
  if (builder) return and(live, published)!

  const openAudience = sql`(
    ${formTemplates.allowedRoles} is null
    or jsonb_array_length(${formTemplates.allowedRoles}) = 0
  )`
  const audience =
    effectiveRoleKeys.size === 0
      ? openAudience
      : sql`(${openAudience} or jsonb_exists_any(${formTemplates.allowedRoles}, ${roleKeyArray(effectiveRoleKeys)}))`
  return and(live, published, audience)!
}

async function loadTemplateAccess(
  ctx: RequestContext,
  templateId: string,
  tx?: Database,
): Promise<(TemplateAccessDescriptor & { id: string }) | null> {
  if (!isUuid(templateId)) return null
  const load = async (db: Database) => {
    const [template] = await db
      .select({
        id: formTemplates.id,
        status: formTemplates.status,
        allowedRoles: formTemplates.allowedRoles,
        deletedAt: formTemplates.deletedAt,
      })
      .from(formTemplates)
      .where(and(eq(formTemplates.id, templateId), eq(formTemplates.tenantId, ctx.tenantId)))
      .limit(1)
    return template ?? null
  }
  return tx ? load(tx) : ctx.db(load)
}

export async function canAccessTemplateById(
  ctx: RequestContext,
  templateId: string,
  mode: TemplateAccessMode,
): Promise<boolean> {
  if (!isUuid(templateId)) return false
  const [template, roleKeys] = await Promise.all([
    loadTemplateAccess(ctx, templateId),
    getEffectiveRoleKeys(ctx),
  ])
  return !!template && canAccessTemplate(ctx, template, roleKeys, mode)
}

export async function canAccessResponseTemplate(
  ctx: RequestContext,
  responseId: string,
  mode: TemplateAccessMode = 'browse-records',
): Promise<boolean> {
  if (!isUuid(responseId)) return false
  const [template, roleKeys] = await Promise.all([
    ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          status: formTemplates.status,
          allowedRoles: formTemplates.allowedRoles,
          deletedAt: formTemplates.deletedAt,
        })
        .from(formResponses)
        .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
        .where(
          and(
            eq(formResponses.id, responseId),
            eq(formResponses.tenantId, ctx.tenantId),
            isNull(formResponses.deletedAt),
          ),
        )
        .limit(1)
      return row ?? null
    }),
    getEffectiveRoleKeys(ctx),
  ])
  return !!template && canAccessTemplate(ctx, template, roleKeys, mode)
}
