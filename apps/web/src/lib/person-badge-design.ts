// Tenant-configurable person ID-badge design (mirrors equipment-label-design.ts
// and the training Card studio). ONE two-sided CR80 document per tenant, stored
// in `tenants.settings.personBadgeDesign`; the badge QR opens the person's
// public live training transcript. Every read goes through
// `normalizePersonBadgeDesign` so hand-edited or stale settings can never
// break rendering.

import {
  createPersonBadgeDesignDocument,
  normalizeDesignDocument,
  type DesignDocument,
} from '@beaconhs/design-studio'

export const PERSON_BADGE_DESIGN_SETTINGS_KEY = 'personBadgeDesign'

export function defaultPersonBadgeDesign(): DesignDocument {
  return createPersonBadgeDesignDocument()
}

/** Resolve the tenant's badge design from `tenants.settings` (default when unset). */
export function normalizePersonBadgeDesign(settings: unknown): DesignDocument {
  const raw =
    settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)[PERSON_BADGE_DESIGN_SETTINGS_KEY]
      : null
  const fallback = defaultPersonBadgeDesign()
  if (!raw) return fallback
  return normalizeDesignDocument(raw, fallback)
}
