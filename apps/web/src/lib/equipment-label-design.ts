// Tenant-configurable equipment QR-label design (mirrors credential-designs.ts
// for the training Card studio). ONE design document per tenant, stored in
// `tenants.settings.equipmentLabelDesign`; the default reproduces the legacy
// 4×6in thermal label. Every read goes through `normalizeEquipmentLabelDesign`
// so hand-edited or stale settings can never break rendering.

import {
  createEquipmentLabelDesignDocument,
  normalizeDesignDocument,
  type DesignDocument,
} from '@beaconhs/design-studio'

export const EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY = 'equipmentLabelDesign'

export function defaultEquipmentLabelDesign(): DesignDocument {
  return createEquipmentLabelDesignDocument()
}

/** Resolve the tenant's label design from `tenants.settings` (default when unset). */
export function normalizeEquipmentLabelDesign(settings: unknown): DesignDocument {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)[EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY]
      : null
  const fallback = defaultEquipmentLabelDesign()
  if (!raw) return fallback
  return normalizeDesignDocument(raw, fallback)
}
