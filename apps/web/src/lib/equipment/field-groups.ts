// Registry of the equipment record's optional native field groups — the
// best-practice asset-register sections (manufacture, acquisition, ownership,
// road/registration, meters, specifications). Categories toggle groups on/off
// via equipment_categories.enabled_field_groups so a hand tool isn't cluttered
// with VIN/odometer inputs while a pickup truck gets them; items with no
// category use each group's default. Tenant custom fields can target a group
// via custom_field_definitions.group_key and render inside its section.
//
// Client-safe: plain data + pure helpers, imported by server pages and the
// category drawer alike. Field names are equipment_items camelCase columns —
// updateEquipmentField's allowlist and the record page renderer both derive
// from this registry, so adding a field here wires both ends.

export type EquipmentNativeFieldType = 'text' | 'date' | 'number' | 'select'

export type EquipmentNativeField = {
  /** equipment_items column, camelCase (matches Drizzle + the autosave allowlist). */
  field: string
  label: string
  type: EquipmentNativeFieldType
  placeholder?: string
  /** For type: 'select'. */
  options?: { value: string; label: string }[]
  /** Numeric coercion: 'int' | 'decimal' (default 'decimal' for number type). */
  numeric?: 'int' | 'decimal'
}

export type EquipmentFieldGroup = {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
  fields: EquipmentNativeField[]
}

export const EQUIPMENT_OWNERSHIP_OPTIONS = [
  { value: 'owned', label: 'Owned' },
  { value: 'rented', label: 'Rented' },
  { value: 'leased', label: 'Leased' },
]

export const EQUIPMENT_FIELD_GROUPS: EquipmentFieldGroup[] = [
  {
    key: 'manufacture',
    label: 'Make & model',
    description: 'Manufacturer, model, and model year.',
    defaultEnabled: true,
    fields: [
      { field: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'e.g. Caterpillar' },
      { field: 'model', label: 'Model', type: 'text', placeholder: 'e.g. 320 GC' },
      { field: 'modelYear', label: 'Model year', type: 'number', numeric: 'int' },
    ],
  },
  {
    key: 'acquisition',
    label: 'Purchase & warranty',
    description: 'Purchase date, price, vendor, and warranty expiry.',
    defaultEnabled: true,
    fields: [
      { field: 'purchaseDate', label: 'Purchase date', type: 'date' },
      { field: 'purchasePrice', label: 'Purchase price', type: 'number', numeric: 'decimal' },
      { field: 'purchaseVendor', label: 'Vendor', type: 'text', placeholder: 'Where it was purchased' },
      { field: 'warrantyExpiresOn', label: 'Warranty expires', type: 'date' },
    ],
  },
  {
    key: 'ownership',
    label: 'Ownership',
    description: 'Owned, rented, or leased — and from whom.',
    defaultEnabled: false,
    fields: [
      { field: 'ownership', label: 'Ownership', type: 'select', options: EQUIPMENT_OWNERSHIP_OPTIONS },
      { field: 'rentalProvider', label: 'Rental / lease provider', type: 'text' },
      { field: 'rentalEndsOn', label: 'Rental / lease ends', type: 'date' },
    ],
  },
  {
    key: 'vehicle',
    label: 'Road & registration',
    description: 'VIN, plate, registration, and insurance for road-going units.',
    defaultEnabled: false,
    fields: [
      { field: 'vin', label: 'VIN', type: 'text' },
      { field: 'licensePlate', label: 'License plate', type: 'text' },
      { field: 'registrationExpiresOn', label: 'Registration expires', type: 'date' },
      { field: 'insuranceExpiresOn', label: 'Insurance expires', type: 'date' },
    ],
  },
  {
    key: 'meters',
    label: 'Meters',
    description: 'Hour meter and odometer readings.',
    defaultEnabled: false,
    fields: [
      { field: 'currentHours', label: 'Hour meter', type: 'number', numeric: 'decimal' },
      { field: 'currentOdometer', label: 'Odometer (km)', type: 'number', numeric: 'int' },
    ],
  },
  {
    key: 'specifications',
    label: 'Specifications',
    description: 'Fuel, power, capacity, weight, and dimensions.',
    defaultEnabled: false,
    fields: [
      { field: 'fuelType', label: 'Fuel type', type: 'text', placeholder: 'e.g. Diesel' },
      { field: 'powerRating', label: 'Power rating', type: 'text', placeholder: 'e.g. 120 kW' },
      { field: 'capacity', label: 'Capacity', type: 'text', placeholder: 'e.g. 2,500 kg lift' },
      { field: 'weight', label: 'Weight', type: 'text', placeholder: 'e.g. 21,800 kg' },
      { field: 'dimensions', label: 'Dimensions', type: 'text', placeholder: 'L × W × H' },
    ],
  },
]

export const DEFAULT_ENABLED_GROUP_KEYS = EQUIPMENT_FIELD_GROUPS.filter(
  (g) => g.defaultEnabled,
).map((g) => g.key)

/**
 * Field groups to render for a record, given its category's
 * enabled_field_groups (null/undefined = registry defaults). Order always
 * follows the registry.
 */
export function resolveEnabledFieldGroups(
  enabledKeys: string[] | null | undefined,
): EquipmentFieldGroup[] {
  const keys = new Set(enabledKeys ?? DEFAULT_ENABLED_GROUP_KEYS)
  return EQUIPMENT_FIELD_GROUPS.filter((g) => keys.has(g.key))
}
