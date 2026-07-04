// Static descriptors for each native entity that supports custom fields. Pure
// data (no DB / server imports) so both server pages and the client designer
// can import it. Table-specific reads/writes switch on `kind` in queries.ts /
// actions.ts to stay type-safe.

import type { CustomFieldEntityKind } from '@beaconhs/forms-core'

export type EntityKindConfig = {
  kind: CustomFieldEntityKind
  /** Plural label for headings ("Equipment"). */
  label: string
  /** Singular noun for copy ("equipment item"). */
  singular: string
  /**
   * Permission gating BOTH value writes on the record page AND definition
   * management in the designer. Mirrors the entity's own update action so the
   * custom-field layer can never be looser than the host module.
   */
  permission: string
  /** Module-admin registry key when the designer mounts under a Manage hub. */
  moduleKey: string | null
  /** Whether definitions can be scoped to a subtype (equipment/ppe types). */
  hasSubtype: boolean
  /** Label for the subtype scope ("Type"). */
  subtypeLabel: string | null
  /** Route to a record's detail page (for revalidation + designer back-links). */
  detail: (id: string) => string
  /** Module home / list route. */
  list: string
  /** The designer page route. */
  designerPath: string
}

export const CUSTOM_FIELD_ENTITY_CONFIG: Record<CustomFieldEntityKind, EntityKindConfig> = {
  equipment: {
    kind: 'equipment',
    label: 'Equipment',
    singular: 'equipment item',
    permission: 'equipment.manage',
    moduleKey: 'equipment',
    hasSubtype: true,
    subtypeLabel: 'Type',
    detail: (id) => `/equipment/${id}`,
    list: '/equipment',
    designerPath: '/equipment/custom-fields',
  },
  ppe: {
    kind: 'ppe',
    label: 'PPE',
    singular: 'PPE item',
    permission: 'ppe.manage',
    moduleKey: 'ppe',
    hasSubtype: true,
    subtypeLabel: 'Type',
    detail: (id) => `/ppe/${id}`,
    list: '/ppe',
    designerPath: '/ppe/custom-fields',
  },
  person: {
    kind: 'person',
    label: 'People',
    singular: 'person',
    permission: 'admin.org.manage',
    moduleKey: 'people',
    hasSubtype: false,
    subtypeLabel: null,
    detail: (id) => `/people/${id}`,
    list: '/people',
    designerPath: '/people/custom-fields',
  },
  location: {
    kind: 'location',
    label: 'Locations',
    singular: 'location',
    permission: 'admin.org.manage',
    moduleKey: 'locations',
    hasSubtype: false,
    subtypeLabel: null,
    detail: (id) => `/locations/${id}`,
    list: '/locations',
    designerPath: '/locations/custom-fields',
  },
}

export function entityConfig(kind: CustomFieldEntityKind): EntityKindConfig {
  return CUSTOM_FIELD_ENTITY_CONFIG[kind]
}
