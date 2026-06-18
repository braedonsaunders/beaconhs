// Entity-attribute registry for picker-bound formulas.
//
// Picker fields (`equipment_picker`, `person_picker`, …) only store an id in
// the response payload. Downstream form fields often want to surface a *live*
// attribute from the picked entity — e.g. "Operator's current job title",
// "Crane's current status", "Site's address". The `entity_attr` formula
// operator (see schema.ts / evaluator.ts) reads from this registry to know
// what columns are safe to surface.
//
// **Allowlist contract.** Only columns named here are reachable. The server
// loader (`apps/web/src/app/(app)/forms/_lib/entity-loader.ts`) and the
// runtime fetch action both copy ONLY these columns from the DB row into the
// EvalContext — protecting us from "SELECT *" data leakage when a designer
// or attacker invents an attribute key.
//
// One EntityKind ↔ one picker FieldType:
//   person   → person_picker / multi_person_picker
//   equipment→ equipment_picker
//   site     → customer_picker / project_picker / site_picker / area_picker
//              (all resolve to org_units rows; each constrains its OPTIONS
//              query to the matching level)
//   ppe      → ppe_picker
//   document → document_picker
//   course   → course_picker
//
// Designer UIs should render the operator picker UX in two steps:
//   1. choose a picker field present in the template (we infer the kind)
//   2. choose an attribute from ENTITY_ATTRS[kind]
//
// **Adding a new attribute** is a 1-line addition here, plus a matching
// column in the entity-loader's `select({ ... })` projection.

export type EntityKind = 'person' | 'equipment' | 'site' | 'ppe' | 'document' | 'course'

export type EntityAttrValueType = 'string' | 'number' | 'date' | 'boolean'

export type EntityAttrDef = {
  /** Stable machine key — matches the DB column or a small derived field. */
  key: string
  /** Human-readable label for designer pickers. */
  label: string
  /**
   * Hint for downstream coercion. `date` values are returned as ISO strings
   * (yyyy-mm-dd or full ISO timestamps depending on the source column).
   */
  valueType: EntityAttrValueType
}

/**
 * Map of picker field types → allowed attributes. Adding an entry here
 * surfaces it in the formula builder AND tells the server loader which
 * column to select from the row.
 */
export const ENTITY_ATTRS: Record<EntityKind, EntityAttrDef[]> = {
  person: [
    { key: 'displayName', label: 'Full name', valueType: 'string' },
    { key: 'firstName', label: 'First name', valueType: 'string' },
    { key: 'lastName', label: 'Last name', valueType: 'string' },
    { key: 'jobTitle', label: 'Job title', valueType: 'string' },
    { key: 'employeeNo', label: 'Employee #', valueType: 'string' },
    { key: 'email', label: 'Email', valueType: 'string' },
    { key: 'phone', label: 'Phone', valueType: 'string' },
    { key: 'managerName', label: 'Manager (name)', valueType: 'string' },
    { key: 'departmentName', label: 'Department', valueType: 'string' },
    { key: 'tradeName', label: 'Trade', valueType: 'string' },
    { key: 'crewName', label: 'Crew', valueType: 'string' },
    { key: 'status', label: 'Status', valueType: 'string' },
    { key: 'hireDate', label: 'Hire date', valueType: 'date' },
  ],
  equipment: [
    { key: 'name', label: 'Name', valueType: 'string' },
    { key: 'assetTag', label: 'Asset tag', valueType: 'string' },
    { key: 'serialNumber', label: 'Serial number', valueType: 'string' },
    { key: 'status', label: 'Status', valueType: 'string' },
    { key: 'typeName', label: 'Type', valueType: 'string' },
    { key: 'currentSiteName', label: 'Current site', valueType: 'string' },
    { key: 'currentHolderName', label: 'Current holder', valueType: 'string' },
    { key: 'lastSeenAt', label: 'Last seen at', valueType: 'date' },
    { key: 'lastPreUseInspectionAt', label: 'Last pre-use inspection', valueType: 'date' },
    { key: 'lastAnnualInspectionOn', label: 'Last annual inspection', valueType: 'date' },
    { key: 'nextAnnualInspectionDue', label: 'Next annual inspection due', valueType: 'date' },
    { key: 'isMissing', label: 'Is missing', valueType: 'boolean' },
    { key: 'isAvailableForCheckout', label: 'Available for checkout', valueType: 'boolean' },
    { key: 'requiresOilChange', label: 'Requires oil change', valueType: 'boolean' },
    { key: 'nextOilChangeDue', label: 'Next oil change due', valueType: 'date' },
    { key: 'warrantyExpiresOn', label: 'Warranty expires on', valueType: 'date' },
  ],
  site: [
    { key: 'name', label: 'Name', valueType: 'string' },
    { key: 'code', label: 'Code', valueType: 'string' },
    { key: 'level', label: 'Level', valueType: 'string' },
    { key: 'addressLine', label: 'Address (one-line)', valueType: 'string' },
    { key: 'city', label: 'City', valueType: 'string' },
    { key: 'region', label: 'Region', valueType: 'string' },
    { key: 'postal', label: 'Postal code', valueType: 'string' },
    { key: 'country', label: 'Country', valueType: 'string' },
  ],
  ppe: [
    { key: 'serialNumber', label: 'Serial number', valueType: 'string' },
    { key: 'size', label: 'Size', valueType: 'string' },
    { key: 'status', label: 'Status', valueType: 'string' },
    { key: 'typeName', label: 'Type', valueType: 'string' },
    { key: 'category', label: 'Category', valueType: 'string' },
    { key: 'currentHolderName', label: 'Current holder', valueType: 'string' },
    { key: 'expiresOn', label: 'Expires on', valueType: 'date' },
    { key: 'lastInspectionOn', label: 'Last inspection', valueType: 'date' },
    { key: 'nextInspectionDue', label: 'Next inspection due', valueType: 'date' },
  ],
  document: [
    { key: 'key', label: 'Key', valueType: 'string' },
    { key: 'title', label: 'Title', valueType: 'string' },
    { key: 'category', label: 'Category', valueType: 'string' },
    { key: 'status', label: 'Status', valueType: 'string' },
    { key: 'nextReviewOn', label: 'Next review on', valueType: 'date' },
  ],
  course: [
    { key: 'code', label: 'Code', valueType: 'string' },
    { key: 'name', label: 'Name', valueType: 'string' },
    { key: 'deliveryType', label: 'Delivery type', valueType: 'string' },
    { key: 'durationMinutes', label: 'Duration (minutes)', valueType: 'number' },
    { key: 'validForMonths', label: 'Valid for (months)', valueType: 'number' },
    { key: 'requiresEvaluator', label: 'Requires evaluator', valueType: 'boolean' },
  ],
}

/**
 * Pickers that resolve to a single entity (one id) — the only kind that
 * `entity_attr` supports. Multi-pickers (e.g. `multi_person_picker`) are
 * not currently dereferenceable because the formula would need to choose
 * which row to surface.
 */
export const PICKER_TO_ENTITY_KIND: Record<string, EntityKind> = {
  person_picker: 'person',
  equipment_picker: 'equipment',
  // Every org-unit picker (customer/project/site/area) resolves to an org_units
  // row; their attrs are identical (name/code/level/address), so they all reuse
  // the 'site' attr loader — only the OPTIONS query differs by level.
  customer_picker: 'site',
  project_picker: 'site',
  site_picker: 'site',
  area_picker: 'site',
  ppe_picker: 'ppe',
  document_picker: 'document',
  course_picker: 'course',
}

/**
 * Lookup helper: given a picker field type, return the matching EntityKind
 * (or null if the field type is not a single-entity picker).
 */
export function entityKindForPicker(fieldType: string): EntityKind | null {
  return PICKER_TO_ENTITY_KIND[fieldType] ?? null
}

/**
 * Lookup helper: given a kind and an attribute key, return the definition
 * (or null if the attribute isn't allowlisted). Used by the evaluator to
 * decide whether to surface a value at all.
 */
export function getEntityAttrDef(kind: EntityKind, attrKey: string): EntityAttrDef | null {
  const list = ENTITY_ATTRS[kind]
  if (!list) return null
  return list.find((a) => a.key === attrKey) ?? null
}

/**
 * Pick the human label out of a loaded entity-attr map. The "name" column
 * varies by kind (person → displayName, site/equipment/course → name,
 * document → title, …) so we probe a fixed priority list. Shared by the
 * response viewer and the PDF renderer so a picked entity reads the same in
 * both places. Returns null when no usable label is present.
 */
export function entityDisplayName(
  attrs: Record<string, unknown> | null | undefined,
): string | null {
  if (!attrs) return null
  for (const k of ['displayName', 'name', 'title', 'serialNumber', 'assetTag', 'code']) {
    const v = attrs[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}
