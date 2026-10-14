// Permission gates for the public REST API.
//
// API keys use the same permission catalogue as tenant roles. Read access is
// derived from the report entity category, while write access is declared next
// to each write handler. OpenAPI and runtime gates both call these helpers, so
// docs and enforcement move together.

import { PERMISSION_CATALOGUE, type CataloguePermission } from '@beaconhs/db/schema'
import { REPORT_ENTITIES } from '@beaconhs/reports'
import type { ReportEntity } from '@beaconhs/reports/entities'

const VALID_PERMISSIONS = new Set<string>(PERMISSION_CATALOGUE as unknown as string[])

const READ_PERMISSION_BY_CATEGORY: Record<string, CataloguePermission> = {
  forms: 'forms.response.read.all',
  incidents: 'incidents.read.all',
  inspections: 'inspections.read.all',
  hazid: 'hazid.read.all',
  training: 'training.read.all',
  documents: 'documents.read',
  equipment: 'equipment.read.all',
  ppe: 'ppe.read.all',
  corrective_actions: 'ca.read.all',
  compliance: 'compliance.read',
}

/** Report entities served by /api/v1/{entity}. Builder-app data — including
 *  monitored sessions — is reachable only through /api/v1/apps, where every app
 *  needs an explicit grant on the key, so the `apps` category is excluded. */
export const PUBLIC_API_ENTITIES: readonly ReportEntity[] = REPORT_ENTITIES.filter(
  (entity) => entity.category in READ_PERMISSION_BY_CATEGORY,
)

const PUBLIC_API_ENTITY_MAP = new Map(PUBLIC_API_ENTITIES.map((entity) => [entity.key, entity]))

export function publicApiEntity(key: string): ReportEntity | undefined {
  return PUBLIC_API_ENTITY_MAP.get(key)
}

function isApiPermission(permission: string): boolean {
  return VALID_PERMISSIONS.has(permission)
}

export function sanitizeApiPermissions(permissions: string[]): CataloguePermission[] {
  return [
    ...new Set(permissions.map((p) => p.trim()).filter(isApiPermission) as CataloguePermission[]),
  ]
}

export function keyHasPermission(permissions: string[], required: string): boolean {
  if (permissions.includes(required)) return true
  for (const permission of permissions) {
    if (permission.endsWith('.*') && required.startsWith(permission.slice(0, -1))) return true
  }
  return false
}

export function hasBuilderAppGrant(grantedTemplateIds: readonly string[], templateId: string) {
  return grantedTemplateIds.includes(templateId)
}

export function readPermissionForEntity(
  entity: Pick<ReportEntity, 'category'>,
): CataloguePermission {
  const permission = READ_PERMISSION_BY_CATEGORY[entity.category]
  if (!permission) {
    throw new Error(`No public API read permission mapped for entity category "${entity.category}"`)
  }
  return permission
}
