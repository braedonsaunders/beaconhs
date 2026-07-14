// Custom-field substrate for native entities (equipment, PPE, people, locations).
//
// This is the single source of truth for the *tenant-configurable extra
// attributes* layer that replaces the legacy "bolt another column onto the
// table with no UI" pattern (e.g. the legacy EQUIPMENT.AtmosphericEquipment
// flag + Sensor1..4ID columns). A tenant defines fields in the module admin UI;
// values are stored on each record's existing `metadata` jsonb column under the
// reserved `custom` namespace (`metadata.custom[key]`).
//
// We deliberately reuse the *concepts* of the form field registry
// (`field-types.ts`) but expose a curated, static-attribute-friendly subset:
// no media/signature/formula/picker types — those belong to forms, not to a
// flat attribute on an asset. Keeping this list small keeps validation,
// storage, rendering, and reporting tractable.

/** Native entities that support tenant-defined custom fields. */
export type CustomFieldEntityKind = 'equipment' | 'ppe' | 'person' | 'location'

export const CUSTOM_FIELD_ENTITY_KINDS = [
  'equipment',
  'ppe',
  'person',
  'location',
] as const satisfies readonly CustomFieldEntityKind[]

/** Allowlisted field types for custom fields (subset of the form registry). */
export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'email'
  | 'phone'

export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'boolean',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
] as const satisfies readonly CustomFieldType[]

/** The runtime value shape stored in `metadata.custom[key]`. */
export type CustomFieldValueKind = 'string' | 'number' | 'boolean' | 'string_array'

export type CustomFieldOption = { value: string; label: string }

export type CustomFieldConfig = {
  /** Choices for `select` / `multi_select`. */
  options?: CustomFieldOption[]
  /** Optional unit suffix shown beside `number` inputs (e.g. "ppm", "%", "kg"). */
  unit?: string | null
  /** Optional numeric bounds / step for `number`. */
  min?: number | null
  max?: number | null
  step?: number | null
  /** Optional placeholder for text-like inputs. */
  placeholder?: string | null
}

/** A definition as the runtime needs it to validate, coerce and render a value. */
export type CustomFieldDefinition = {
  key: string
  label: string
  helpText?: string | null
  fieldType: CustomFieldType
  required: boolean
  config: CustomFieldConfig | null
}

export type CustomFieldTypeMeta = {
  type: CustomFieldType
  label: string
  description: string
  valueKind: CustomFieldValueKind
  /** Whether the type is backed by an option list. */
  hasOptions: boolean
  /** Whether a unit suffix is meaningful. */
  supportsUnit: boolean
  /** Whether min/max/step are meaningful. */
  supportsRange: boolean
  /** Whether the rendered input supports placeholder text. */
  supportsPlaceholder: boolean
}

export const CUSTOM_FIELD_TYPE_META: Record<CustomFieldType, CustomFieldTypeMeta> = {
  text: {
    type: 'text',
    label: 'Short text',
    description: 'Single-line text',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: true,
  },
  textarea: {
    type: 'textarea',
    label: 'Long text',
    description: 'Multi-line text',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: true,
  },
  number: {
    type: 'number',
    label: 'Number',
    description: 'Numeric value with optional unit and range',
    valueKind: 'number',
    hasOptions: false,
    supportsUnit: true,
    supportsRange: true,
    supportsPlaceholder: true,
  },
  date: {
    type: 'date',
    label: 'Date',
    description: 'Calendar date',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: false,
  },
  datetime: {
    type: 'datetime',
    label: 'Date & time',
    description: 'Date with a time of day',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: false,
  },
  boolean: {
    type: 'boolean',
    label: 'Yes / No',
    description: 'A toggle',
    valueKind: 'boolean',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: false,
  },
  select: {
    type: 'select',
    label: 'Dropdown',
    description: 'Pick one option',
    valueKind: 'string',
    hasOptions: true,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: false,
  },
  multi_select: {
    type: 'multi_select',
    label: 'Multi-select',
    description: 'Pick one or more options',
    valueKind: 'string_array',
    hasOptions: true,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: false,
  },
  url: {
    type: 'url',
    label: 'URL',
    description: 'A web link',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: true,
  },
  email: {
    type: 'email',
    label: 'Email',
    description: 'An email address',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: true,
  },
  phone: {
    type: 'phone',
    label: 'Phone',
    description: 'A phone number',
    valueKind: 'string',
    hasOptions: false,
    supportsUnit: false,
    supportsRange: false,
    supportsPlaceholder: true,
  },
}

/** The reserved key on a record's `metadata` jsonb that holds custom values. */
export const CUSTOM_FIELD_METADATA_NAMESPACE = 'custom' as const

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HTTP_URL_RE = /^https?:\/\/(?:\[[0-9a-f:.]+\]|[^\s/?#:@]+)(?::\d{1,5})?(?:[/?#][^\s]*)?$/i
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/

/** Shared server and input bounds for the metadata-backed custom-field layer. */
export const CUSTOM_FIELD_LIMITS = {
  label: 200,
  helpText: 2_000,
  groupLabel: 200,
  unit: 64,
  placeholder: 500,
  options: 100,
  optionValue: 128,
  optionLabel: 200,
  text: 10_000,
  textarea: 100_000,
  url: 2_048,
  email: 320,
  phone: 100,
} as const

/**
 * Derive a stable machine key from a human label. Lower-cased, non-alnum runs
 * collapsed to `_`, leading digit prefixed, clamped to 63 chars. Returns
 * `'field'` for an empty/garbage label so callers always get a valid key.
 */
export function slugifyCustomFieldKey(label: string): string {
  let key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63)
  if (!key) key = 'field'
  if (/^[0-9]/.test(key)) key = `f_${key}`.slice(0, 63)
  return key
}

export function isValidCustomFieldKey(key: string): boolean {
  return KEY_RE.test(key)
}

/** Read the custom-value map off a record's metadata jsonb. */
export function readCustomFieldValues(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {}
  const ns = (metadata as Record<string, unknown>)[CUSTOM_FIELD_METADATA_NAMESPACE]
  if (!ns || typeof ns !== 'object') return {}
  return ns as Record<string, unknown>
}

export type CoerceResult =
  { ok: true; value: string | number | boolean | string[] | null } | { ok: false; error: string }

/**
 * Validate + coerce a raw string (as it arrives from a form submission) into
 * the typed value stored in `metadata.custom[key]`. `multi_select` raw values
 * are a JSON-encoded string array. An empty raw value clears the field to
 * `null` (unless the field is required, which is an error for value-bearing
 * types — booleans always accept their `false` state).
 */
export function coerceCustomFieldValue(def: CustomFieldDefinition, raw: string): CoerceResult {
  const trimmed = (raw ?? '').trim()
  const required = !!def.required
  const label = def.label || def.key

  // Bound attacker-controlled input before Number(), JSON.parse(), URL(), or
  // any regular expression. Long text is the largest supported value type.
  if ((raw ?? '').length > CUSTOM_FIELD_LIMITS.textarea) return tooLongErr(label)

  switch (def.fieldType) {
    case 'boolean': {
      // A toggle is never "missing"; absence reads as false.
      return { ok: true, value: trimmed === 'true' || trimmed === 'on' || trimmed === '1' }
    }
    case 'number': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (trimmed.length > 128) return { ok: false, error: `${label} must be a number.` }
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` }
      const cfg = def.config ?? {}
      if (cfg.min != null && n < cfg.min)
        return { ok: false, error: `${label} must be at least ${cfg.min}.` }
      if (cfg.max != null && n > cfg.max)
        return { ok: false, error: `${label} must be at most ${cfg.max}.` }
      if (cfg.step != null && cfg.step > 0) {
        const base = cfg.min ?? 0
        const quotient = (n - base) / cfg.step
        const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8
        if (Math.abs(quotient - Math.round(quotient)) > tolerance)
          return { ok: false, error: `${label} must use increments of ${cfg.step}.` }
      }
      return { ok: true, value: n }
    }
    case 'select': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (trimmed.length > CUSTOM_FIELD_LIMITS.optionValue)
        return { ok: false, error: `${label}: invalid selection.` }
      const options = def.config?.options ?? []
      if (!options.some((o) => o.value === trimmed))
        return { ok: false, error: `${label}: "${trimmed}" is not an allowed option.` }
      return { ok: true, value: trimmed }
    }
    case 'multi_select': {
      let arr: unknown
      if (trimmed === '' || trimmed === '[]') arr = []
      else {
        try {
          arr = JSON.parse(trimmed)
        } catch {
          return { ok: false, error: `${label}: invalid selection.` }
        }
      }
      if (!Array.isArray(arr) || arr.some((v) => typeof v !== 'string'))
        return { ok: false, error: `${label}: invalid selection.` }
      const options = def.config?.options ?? []
      if (
        arr.length > CUSTOM_FIELD_LIMITS.options ||
        arr.some((v) => (v as string).length > CUSTOM_FIELD_LIMITS.optionValue)
      )
        return { ok: false, error: `${label}: invalid selection.` }
      const allowed = new Set(options.map((o) => o.value))
      const values = [...new Set(arr as string[])]
      for (const v of values)
        if (!allowed.has(v))
          return { ok: false, error: `${label}: "${v}" is not an allowed option.` }
      if (required && values.length === 0) return requiredErr(label)
      return { ok: true, value: values.length === 0 ? null : values }
    }
    case 'date': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (!hasValidCalendarDate(trimmed))
        return { ok: false, error: `${label} must be a valid date.` }
      return { ok: true, value: trimmed }
    }
    case 'datetime': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      const match = ISO_DATETIME_RE.exec(trimmed)
      if (!match || !hasValidCalendarParts(match[1], match[2], match[3]))
        return { ok: false, error: `${label} must be a valid date & time.` }
      return { ok: true, value: trimmed }
    }
    case 'email': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      // Bound input before the backtracking email expression. Apart from
      // matching the practical maximum address length, this prevents a long
      // attacker-controlled local part from turning metadata validation into
      // a CPU-amplification path.
      if (trimmed.length > CUSTOM_FIELD_LIMITS.email || !EMAIL_RE.test(trimmed))
        return { ok: false, error: `${label} must be a valid email address.` }
      return { ok: true, value: trimmed }
    }
    case 'url': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (trimmed.length > CUSTOM_FIELD_LIMITS.url || !isHttpUrl(trimmed))
        return { ok: false, error: `${label} must be a URL starting with http:// or https://.` }
      return { ok: true, value: trimmed }
    }
    case 'phone': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (trimmed.length > CUSTOM_FIELD_LIMITS.phone) return tooLongErr(label)
      return { ok: true, value: trimmed }
    }
    case 'textarea': {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (trimmed.length > CUSTOM_FIELD_LIMITS.textarea) return tooLongErr(label)
      return { ok: true, value: trimmed }
    }
    case 'text':
    default: {
      if (trimmed === '') return required ? requiredErr(label) : { ok: true, value: null }
      if (trimmed.length > CUSTOM_FIELD_LIMITS.text) return tooLongErr(label)
      return { ok: true, value: trimmed }
    }
  }
}

function requiredErr(label: string): CoerceResult {
  return { ok: false, error: `${label} is required.` }
}

function tooLongErr(label: string): CoerceResult {
  return { ok: false, error: `${label} is too long.` }
}

function hasValidCalendarDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value)
  return Boolean(match && hasValidCalendarParts(match[1], match[2], match[3]))
}

function hasValidCalendarParts(
  yearRaw: string | undefined,
  monthRaw: string | undefined,
  dayRaw: string | undefined,
): boolean {
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= (days[month - 1] ?? 0)
}

function isHttpUrl(value: string): boolean {
  return HTTP_URL_RE.test(value)
}

/**
 * Normalise / sanitise a raw config object for a given type — drop irrelevant
 * keys and de-dupe option values. Used by the designer save action so a stored
 * config never carries fields that don't apply to the chosen type.
 */
export function normalizeCustomFieldConfig(
  type: CustomFieldType,
  config: CustomFieldConfig | null | undefined,
): CustomFieldConfig | null {
  const meta = CUSTOM_FIELD_TYPE_META[type]
  const src = config ?? {}
  const out: CustomFieldConfig = {}
  if (meta.hasOptions) {
    const seen = new Set<string>()
    const options: CustomFieldOption[] = []
    for (const o of (src.options ?? []).slice(0, CUSTOM_FIELD_LIMITS.options)) {
      const value = (o?.value ?? '').toString().trim().slice(0, CUSTOM_FIELD_LIMITS.optionValue)
      const optLabel = ((o?.label ?? '').toString().trim() || value).slice(
        0,
        CUSTOM_FIELD_LIMITS.optionLabel,
      )
      if (!value || seen.has(value)) continue
      seen.add(value)
      options.push({ value, label: optLabel })
    }
    out.options = options
  }
  if (meta.supportsUnit && src.unit)
    out.unit = String(src.unit).trim().slice(0, CUSTOM_FIELD_LIMITS.unit) || null
  if (meta.supportsRange) {
    if (src.min != null && Number.isFinite(Number(src.min))) out.min = Number(src.min)
    if (src.max != null && Number.isFinite(Number(src.max))) out.max = Number(src.max)
    if (src.step != null && Number.isFinite(Number(src.step)) && Number(src.step) > 0)
      out.step = Number(src.step)
  }
  if (meta.supportsPlaceholder && src.placeholder)
    out.placeholder = String(src.placeholder).trim().slice(0, CUSTOM_FIELD_LIMITS.placeholder)
  return Object.keys(out).length > 0 ? out : null
}
