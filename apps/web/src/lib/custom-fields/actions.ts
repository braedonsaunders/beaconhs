'use server'

// Server actions for the custom-field system: value writes on record pages, and
// definition CRUD in the designer. Both gate on the host entity's permission so
// the custom-field layer is never looser than the module it decorates.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  CUSTOM_FIELD_ENTITY_KINDS,
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPE_META,
  CUSTOM_FIELD_TYPES,
  coerceCustomFieldValue,
  isValidCustomFieldKey,
  normalizeCustomFieldConfig,
  slugifyCustomFieldKey,
  type CustomFieldConfig,
  type CustomFieldEntityKind,
  type CustomFieldType,
} from '@beaconhs/forms-core'
import {
  customFieldDefinitions,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { EQUIPMENT_FIELD_GROUPS } from '@/lib/equipment/field-groups'
import { isUuid } from '@/lib/list-params'
import { findCustomFieldAnalyticsDependencies } from './analytics-dependencies'
import { customFieldDependencyMessage } from './analytics-dependency-policy'
import { entityConfig } from './config'

const AUDIT_ENTITY: Record<CustomFieldEntityKind, string> = {
  equipment: 'equipment',
  ppe: 'ppe_item',
  person: 'person',
  location: 'org_unit',
}

function isEntityKind(v: string): v is CustomFieldEntityKind {
  return (CUSTOM_FIELD_ENTITY_KINDS as readonly string[]).includes(v)
}

// The metadata column for each kind, plus the table-typed updater. Switching
// here (rather than a generic PgTable ref) keeps the drizzle update type-safe.
function metadataValueExpr(
  col: AnyColumn,
  key: string,
  value: string | number | boolean | string[] | null,
): SQL {
  // Keep the path parameterized even though definition keys are validated.
  // This also fails safely if an older/imported row ever contains a bad key.
  const path = sql`ARRAY['custom', ${key}]::text[]`
  if (value === null) return sql`coalesce(${col}, '{}'::jsonb) #- ${path}`
  return sql`jsonb_set(coalesce(${col}, '{}'::jsonb), ${path}, ${JSON.stringify(value)}::jsonb, true)`
}

async function writeMetadataInTransaction(
  tx: Database,
  kind: CustomFieldEntityKind,
  id: string,
  key: string,
  value: string | number | boolean | string[] | null,
  subtypeId: string | null,
): Promise<boolean> {
  switch (kind) {
    case 'equipment': {
      const [updated] = await tx
        .update(equipmentItems)
        .set({ metadata: metadataValueExpr(equipmentItems.metadata, key, value) })
        .where(
          and(
            eq(equipmentItems.id, id),
            isNull(equipmentItems.deletedAt),
            subtypeId ? eq(equipmentItems.typeId, subtypeId) : undefined,
          ),
        )
        .returning({ id: equipmentItems.id })
      return Boolean(updated)
    }
    case 'ppe': {
      const [updated] = await tx
        .update(ppeItems)
        .set({ metadata: metadataValueExpr(ppeItems.metadata, key, value) })
        .where(
          and(
            eq(ppeItems.id, id),
            isNull(ppeItems.deletedAt),
            subtypeId ? eq(ppeItems.typeId, subtypeId) : undefined,
          ),
        )
        .returning({ id: ppeItems.id })
      return Boolean(updated)
    }
    case 'person': {
      const [updated] = await tx
        .update(people)
        .set({ metadata: metadataValueExpr(people.metadata, key, value) })
        .where(and(eq(people.id, id), isNull(people.deletedAt)))
        .returning({ id: people.id })
      return Boolean(updated)
    }
    case 'location': {
      const [updated] = await tx
        .update(orgUnits)
        .set({ metadata: metadataValueExpr(orgUnits.metadata, key, value) })
        .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
        .returning({ id: orgUnits.id })
      return Boolean(updated)
    }
  }
}

function metadataContainsKey(col: AnyColumn, key: string): SQL {
  return sql`coalesce(${col}->'custom', '{}'::jsonb) ? ${key}`
}

function currentMetadataValue(col: AnyColumn, key: string): SQL {
  return sql`coalesce(${col}->'custom'->${key}, 'null'::jsonb)`
}

function choiceValueNeedsNormalization(
  col: AnyColumn,
  key: string,
  allowedValues: string[],
  multiple: boolean,
): SQL {
  const current = currentMetadataValue(col, key)
  const allowed = JSON.stringify(allowedValues)
  if (multiple) {
    return sql`jsonb_typeof(${current}) IS DISTINCT FROM 'array'
      OR NOT (${current} <@ ${allowed}::jsonb)`
  }
  return sql`NOT (${allowed}::jsonb @> jsonb_build_array(${current}))`
}

function normalizedChoiceMetadataExpr(
  col: AnyColumn,
  key: string,
  allowedValues: string[],
  multiple: boolean,
): SQL {
  if (!multiple) return metadataValueExpr(col, key, null)

  const current = currentMetadataValue(col, key)
  const allowed = JSON.stringify(allowedValues)
  const source = sql`CASE
    WHEN jsonb_typeof(${current}) = 'array' THEN ${current}
    ELSE '[]'::jsonb
  END`
  const filtered = sql`(
    SELECT coalesce(jsonb_agg(entry.value ORDER BY entry.ordinality), '[]'::jsonb)
    FROM jsonb_array_elements(${source}) WITH ORDINALITY AS entry(value, ordinality)
    WHERE ${allowed}::jsonb @> jsonb_build_array(entry.value)
  )`
  return sql`CASE
    WHEN jsonb_array_length(${filtered}) = 0 THEN ${metadataValueExpr(col, key, null)}
    ELSE jsonb_set(coalesce(${col}, '{}'::jsonb), ARRAY['custom', ${key}]::text[], ${filtered}, true)
  END`
}

/** Remove retired options while preserving still-valid multi-select choices. */
async function normalizeChoiceValuesInTransaction(
  tx: Database,
  kind: CustomFieldEntityKind,
  key: string,
  fieldType: 'select' | 'multi_select',
  allowedValues: string[],
): Promise<void> {
  const multiple = fieldType === 'multi_select'
  switch (kind) {
    case 'equipment':
      await tx
        .update(equipmentItems)
        .set({
          metadata: normalizedChoiceMetadataExpr(
            equipmentItems.metadata,
            key,
            allowedValues,
            multiple,
          ),
        })
        .where(
          and(
            metadataContainsKey(equipmentItems.metadata, key),
            choiceValueNeedsNormalization(equipmentItems.metadata, key, allowedValues, multiple),
          ),
        )
      return
    case 'ppe':
      await tx
        .update(ppeItems)
        .set({
          metadata: normalizedChoiceMetadataExpr(ppeItems.metadata, key, allowedValues, multiple),
        })
        .where(
          and(
            metadataContainsKey(ppeItems.metadata, key),
            choiceValueNeedsNormalization(ppeItems.metadata, key, allowedValues, multiple),
          ),
        )
      return
    case 'person':
      await tx
        .update(people)
        .set({
          metadata: normalizedChoiceMetadataExpr(people.metadata, key, allowedValues, multiple),
        })
        .where(
          and(
            metadataContainsKey(people.metadata, key),
            choiceValueNeedsNormalization(people.metadata, key, allowedValues, multiple),
          ),
        )
      return
    case 'location':
      await tx
        .update(orgUnits)
        .set({
          metadata: normalizedChoiceMetadataExpr(orgUnits.metadata, key, allowedValues, multiple),
        })
        .where(
          and(
            metadataContainsKey(orgUnits.metadata, key),
            choiceValueNeedsNormalization(orgUnits.metadata, key, allowedValues, multiple),
          ),
        )
  }
}

function numericValueNeedsNormalization(
  col: AnyColumn,
  key: string,
  config: CustomFieldConfig | null,
): SQL {
  const current = currentMetadataValue(col, key)
  const numeric = sql`(${current} #>> '{}')::numeric`
  const min = config?.min
  const max = config?.max
  const step = config?.step
  const base = min ?? 0
  return sql`CASE
    WHEN jsonb_typeof(${current}) IS DISTINCT FROM 'number' THEN true
    ELSE ${min == null ? sql`false` : sql`${numeric} < ${min}`}
      OR ${max == null ? sql`false` : sql`${numeric} > ${max}`}
      OR ${
        step == null ? sql`false` : sql`mod(${numeric} - ${base}::numeric, ${step}::numeric) <> 0`
      }
  END`
}

/** Clear values that a newly tightened numeric definition can no longer accept. */
async function normalizeNumericValuesInTransaction(
  tx: Database,
  kind: CustomFieldEntityKind,
  key: string,
  config: CustomFieldConfig | null,
): Promise<void> {
  const updateWhere = (col: AnyColumn) =>
    and(metadataContainsKey(col, key), numericValueNeedsNormalization(col, key, config))
  switch (kind) {
    case 'equipment':
      await tx
        .update(equipmentItems)
        .set({ metadata: metadataValueExpr(equipmentItems.metadata, key, null) })
        .where(updateWhere(equipmentItems.metadata))
      return
    case 'ppe':
      await tx
        .update(ppeItems)
        .set({ metadata: metadataValueExpr(ppeItems.metadata, key, null) })
        .where(updateWhere(ppeItems.metadata))
      return
    case 'person':
      await tx
        .update(people)
        .set({ metadata: metadataValueExpr(people.metadata, key, null) })
        .where(updateWhere(people.metadata))
      return
    case 'location':
      await tx
        .update(orgUnits)
        .set({ metadata: metadataValueExpr(orgUnits.metadata, key, null) })
        .where(updateWhere(orgUnits.metadata))
  }
}

/** Remove one definition's value without rewriting records that never had it. */
async function purgeMetadataKeyInTransaction(
  tx: Database,
  kind: CustomFieldEntityKind,
  key: string,
  keepSubtypeId?: string | null,
): Promise<void> {
  switch (kind) {
    case 'equipment':
      await tx
        .update(equipmentItems)
        .set({ metadata: metadataValueExpr(equipmentItems.metadata, key, null) })
        .where(
          and(
            metadataContainsKey(equipmentItems.metadata, key),
            keepSubtypeId
              ? sql`${equipmentItems.typeId} IS DISTINCT FROM ${keepSubtypeId}`
              : undefined,
          ),
        )
      return
    case 'ppe':
      await tx
        .update(ppeItems)
        .set({ metadata: metadataValueExpr(ppeItems.metadata, key, null) })
        .where(
          and(
            metadataContainsKey(ppeItems.metadata, key),
            keepSubtypeId ? sql`${ppeItems.typeId} IS DISTINCT FROM ${keepSubtypeId}` : undefined,
          ),
        )
      return
    case 'person':
      await tx
        .update(people)
        .set({ metadata: metadataValueExpr(people.metadata, key, null) })
        .where(metadataContainsKey(people.metadata, key))
      return
    case 'location':
      await tx
        .update(orgUnits)
        .set({ metadata: metadataValueExpr(orgUnits.metadata, key, null) })
        .where(metadataContainsKey(orgUnits.metadata, key))
  }
}

async function assertValidSubtype(
  tx: Database,
  kind: CustomFieldEntityKind,
  subtypeId: string | null,
): Promise<void> {
  if (!subtypeId) return
  if (kind === 'equipment') {
    const [type] = await tx
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(eq(equipmentTypes.id, subtypeId))
      .limit(1)
      .for('key share')
    if (!type) throw new Error('INVALID_SUBTYPE')
    return
  }
  if (kind === 'ppe') {
    const [type] = await tx
      .select({ id: ppeTypes.id })
      .from(ppeTypes)
      .where(eq(ppeTypes.id, subtypeId))
      .limit(1)
      .for('key share')
    if (!type) throw new Error('INVALID_SUBTYPE')
    return
  }
  throw new Error('INVALID_SUBTYPE')
}

/**
 * Autosave a single custom-field value onto a record's `metadata.custom`.
 * Mirrors the per-module inline-edit actions (validate → write → audit →
 * revalidate). FormData: `entityKind`, `id`, `key`, `value`.
 */
export async function updateCustomFieldValueAction(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const kindRaw = String(formData.get('entityKind') ?? '')
  if (!isEntityKind(kindRaw)) throw new Error('Unknown entity kind')
  const kind = kindRaw
  const cfg = entityConfig(kind)
  assertCan(ctx, cfg.permission)

  const id = String(formData.get('id') ?? '').trim()
  const key = String(formData.get('key') ?? '').trim()
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!isUuid(id) || !isValidCustomFieldKey(key)) throw new Error('Invalid id/key')

  await ctx.db(async (tx) => {
    // The definition is the contract. A shared row lock allows concurrent
    // record edits while serializing them against definition changes/deletion.
    const [row] = await tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.entityKind, kind),
          eq(customFieldDefinitions.key, key),
          eq(customFieldDefinitions.isActive, true),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .limit(1)
      .for('share')
    if (!row) throw new Error('Unknown custom field')

    const coerced = coerceCustomFieldValue(
      {
        key: row.key,
        label: row.label,
        fieldType: row.fieldType as CustomFieldType,
        required: row.required,
        config: (row.config ?? null) as CustomFieldConfig | null,
      },
      value,
    )
    if (!coerced.ok) throw new Error(coerced.error)

    const updated = await writeMetadataInTransaction(
      tx,
      kind,
      id,
      key,
      coerced.value,
      row.subtypeId,
    )
    if (!updated)
      throw new Error(`This custom field does not apply to the selected ${cfg.singular}.`)

    await recordAuditInTransaction(tx, ctx, {
      entityType: AUDIT_ENTITY[kind],
      entityId: id,
      action: 'update',
      summary: `Updated custom field "${row.label}"`,
      after: { [`custom.${key}`]: coerced.value },
    })
  })
  revalidatePath(cfg.detail(id))
  revalidatePath(cfg.list)
}

export type SaveCustomFieldInput = {
  kind: CustomFieldEntityKind
  id?: string
  label: string
  helpText: string | null
  fieldType: CustomFieldType
  config: CustomFieldConfig | null
  required: boolean
  groupLabel: string | null
  /** Native field-group placement (equipment only) — see EQUIPMENT_FIELD_GROUPS. */
  groupKey: string | null
  subtypeId: string | null
  sortOrder: number
  isActive: boolean
}

export type SaveResult = { ok: true } | { ok: false; error: string }

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSaveInputShape(value: unknown): value is SaveCustomFieldInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  const config = input.config
  if (config !== null && (typeof config !== 'object' || Array.isArray(config))) return false
  if (config) {
    const candidate = config as Record<string, unknown>
    if (
      candidate.options !== undefined &&
      (!Array.isArray(candidate.options) ||
        candidate.options.some(
          (option) =>
            !option ||
            typeof option !== 'object' ||
            typeof (option as Record<string, unknown>).value !== 'string' ||
            typeof (option as Record<string, unknown>).label !== 'string',
        ))
    )
      return false
    for (const key of ['min', 'max', 'step'] as const) {
      const numeric = candidate[key]
      if (numeric !== undefined && numeric !== null && typeof numeric !== 'number') return false
    }
    for (const key of ['unit', 'placeholder'] as const) {
      const text = candidate[key]
      if (text !== undefined && !isNullableString(text)) return false
    }
  }
  return (
    typeof input.kind === 'string' &&
    (input.id === undefined || typeof input.id === 'string') &&
    typeof input.label === 'string' &&
    isNullableString(input.helpText) &&
    typeof input.fieldType === 'string' &&
    typeof input.required === 'boolean' &&
    isNullableString(input.groupLabel) &&
    isNullableString(input.groupKey) &&
    isNullableString(input.subtypeId) &&
    typeof input.sortOrder === 'number' &&
    typeof input.isActive === 'boolean'
  )
}

function validateDefinitionInput(
  input: SaveCustomFieldInput,
  meta: (typeof CUSTOM_FIELD_TYPE_META)[CustomFieldType],
): string | null {
  if (input.label.trim().length > CUSTOM_FIELD_LIMITS.label)
    return `Label must be ${CUSTOM_FIELD_LIMITS.label} characters or fewer.`
  if ((input.helpText?.trim().length ?? 0) > CUSTOM_FIELD_LIMITS.helpText)
    return `Help text must be ${CUSTOM_FIELD_LIMITS.helpText.toLocaleString()} characters or fewer.`
  if ((input.groupLabel?.trim().length ?? 0) > CUSTOM_FIELD_LIMITS.groupLabel)
    return `Group name must be ${CUSTOM_FIELD_LIMITS.groupLabel} characters or fewer.`
  if (
    !Number.isSafeInteger(input.sortOrder) ||
    input.sortOrder < -1_000_000 ||
    input.sortOrder > 1_000_000
  )
    return 'Sort order must be a whole number between -1,000,000 and 1,000,000.'

  const rawOptions = input.config?.options ?? []
  if (meta.hasOptions) {
    if (rawOptions.length > CUSTOM_FIELD_LIMITS.options)
      return `Choice fields support up to ${CUSTOM_FIELD_LIMITS.options} options.`
    const seen = new Set<string>()
    for (const option of rawOptions) {
      const value = String(option?.value ?? '').trim()
      const label = String(option?.label ?? '').trim() || value
      if (!value) return 'Every choice option needs a value.'
      if (value.length > CUSTOM_FIELD_LIMITS.optionValue)
        return `Choice values must be ${CUSTOM_FIELD_LIMITS.optionValue} characters or fewer.`
      if (label.length > CUSTOM_FIELD_LIMITS.optionLabel)
        return `Choice labels must be ${CUSTOM_FIELD_LIMITS.optionLabel} characters or fewer.`
      if (seen.has(value)) return `Choice value "${value}" is duplicated.`
      seen.add(value)
    }
  }

  const unit = input.config?.unit
  if (unit != null && String(unit).trim().length > CUSTOM_FIELD_LIMITS.unit)
    return `Unit must be ${CUSTOM_FIELD_LIMITS.unit} characters or fewer.`
  const placeholder = input.config?.placeholder
  if (placeholder != null && String(placeholder).length > CUSTOM_FIELD_LIMITS.placeholder)
    return `Placeholder must be ${CUSTOM_FIELD_LIMITS.placeholder} characters or fewer.`

  if (meta.supportsRange) {
    const min = input.config?.min
    const max = input.config?.max
    const step = input.config?.step
    if (min != null && !Number.isFinite(Number(min))) return 'Minimum must be a finite number.'
    if (max != null && !Number.isFinite(Number(max))) return 'Maximum must be a finite number.'
    if (step != null && (!Number.isFinite(Number(step)) || Number(step) <= 0))
      return 'Step must be a finite number greater than zero.'
    if (min != null && max != null && Number(min) > Number(max))
      return 'Minimum cannot be greater than maximum.'
  }
  return null
}

function definitionSnapshot(
  value: Pick<
    SaveCustomFieldInput,
    | 'label'
    | 'helpText'
    | 'fieldType'
    | 'config'
    | 'required'
    | 'groupLabel'
    | 'groupKey'
    | 'subtypeId'
    | 'sortOrder'
    | 'isActive'
  >,
): Record<string, unknown> {
  return {
    label: value.label,
    helpText: value.helpText,
    fieldType: value.fieldType,
    config: value.config,
    required: value.required,
    groupLabel: value.groupLabel,
    groupKey: value.groupKey,
    subtypeId: value.subtypeId,
    sortOrder: value.sortOrder,
    isActive: value.isActive,
  }
}

/** Create or update a custom-field definition. */
export async function saveCustomFieldDefAction(input: SaveCustomFieldInput): Promise<SaveResult> {
  const ctx = await requireRequestContext()
  if (!isSaveInputShape(input)) return { ok: false, error: 'Invalid custom field input.' }
  if (!isEntityKind(input.kind)) return { ok: false, error: 'Unknown entity kind.' }
  const cfg = entityConfig(input.kind)
  assertCan(ctx, cfg.permission)

  const label = input.label.trim()
  if (!label) return { ok: false, error: 'Label is required.' }
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(input.fieldType))
    return { ok: false, error: 'Invalid field type.' }

  const meta = CUSTOM_FIELD_TYPE_META[input.fieldType]
  const validationError = validateDefinitionInput(input, meta)
  if (validationError) return { ok: false, error: validationError }
  const config = normalizeCustomFieldConfig(input.fieldType, input.config)
  if (meta.hasOptions && (!config?.options || config.options.length === 0))
    return { ok: false, error: 'Add at least one option for a choice field.' }

  // Subtype scope only applies to kinds that have subtypes.
  const subtypeId = cfg.hasSubtype ? input.subtypeId || null : null
  if (subtypeId && !isUuid(subtypeId))
    return { ok: false, error: `Choose an existing ${cfg.subtypeLabel?.toLowerCase() ?? 'type'}.` }
  if (input.id && !isUuid(input.id)) return { ok: false, error: 'Invalid custom field.' }
  const groupLabel = input.groupLabel?.trim() || null
  // Native-group placement is an equipment concept; validate against the
  // registry so a stale key can never orphan the field.
  const groupKey =
    input.kind === 'equipment' &&
    input.groupKey &&
    EQUIPMENT_FIELD_GROUPS.some((g) => g.key === input.groupKey)
      ? input.groupKey
      : null
  const helpText = input.helpText?.trim() || null

  try {
    const savedId = await ctx.db(async (tx) => {
      await assertValidSubtype(tx, input.kind, subtypeId)
      if (input.id) {
        // Key is immutable after creation (stored values are keyed by it).
        // The entityKind filter pins the row to the kind whose permission was
        // checked above — an id from another module never matches.
        const [existing] = await tx
          .select()
          .from(customFieldDefinitions)
          .where(
            and(
              eq(customFieldDefinitions.id, input.id),
              eq(customFieldDefinitions.entityKind, input.kind),
              isNull(customFieldDefinitions.deletedAt),
            ),
          )
          .limit(1)
          .for('update')
        if (!existing) return undefined
        if (existing.fieldType !== input.fieldType) throw new Error('IMMUTABLE_FIELD_TYPE')

        if (existing.isActive && !input.isActive) {
          const dependencies = await findCustomFieldAnalyticsDependencies(
            tx,
            ctx.tenantId,
            input.kind,
            existing.key,
          )
          if (dependencies.reports || dependencies.cards) {
            throw new Error(`CUSTOM_FIELD_IN_USE:${customFieldDependencyMessage(dependencies)}`)
          }
        }

        if (input.fieldType === 'select' || input.fieldType === 'multi_select') {
          await normalizeChoiceValuesInTransaction(
            tx,
            input.kind,
            existing.key,
            input.fieldType,
            (config?.options ?? []).map((option) => option.value),
          )
        } else if (input.fieldType === 'number') {
          await normalizeNumericValuesInTransaction(tx, input.kind, existing.key, config)
        }

        const [updated] = await tx
          .update(customFieldDefinitions)
          .set({
            label,
            helpText,
            fieldType: input.fieldType,
            config,
            required: input.required,
            groupLabel,
            groupKey,
            subtypeId,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          })
          .where(
            and(
              eq(customFieldDefinitions.id, input.id),
              eq(customFieldDefinitions.entityKind, input.kind),
            ),
          )
          .returning({ id: customFieldDefinitions.id })
        if (updated && existing.subtypeId !== subtypeId && subtypeId) {
          // Narrowing or moving a scoped definition must not leave hidden
          // values on records where the field no longer applies.
          await purgeMetadataKeyInTransaction(tx, input.kind, existing.key, subtypeId)
        }
        if (updated) {
          await recordAuditInTransaction(tx, ctx, {
            entityType: 'custom_field_definition',
            entityId: updated.id,
            action: 'update',
            summary: `Updated ${cfg.label} custom field "${label}"`,
            before: definitionSnapshot({
              label: existing.label,
              helpText: existing.helpText,
              fieldType: existing.fieldType as CustomFieldType,
              config: (existing.config ?? null) as CustomFieldConfig | null,
              required: existing.required,
              groupLabel: existing.groupLabel,
              groupKey: existing.groupKey,
              subtypeId: existing.subtypeId,
              sortOrder: existing.sortOrder,
              isActive: existing.isActive,
            }),
            after: definitionSnapshot({
              label,
              helpText,
              fieldType: input.fieldType,
              config,
              required: input.required,
              groupLabel,
              groupKey,
              subtypeId,
              sortOrder: input.sortOrder,
              isActive: input.isActive,
            }),
          })
        }
        return updated?.id
      }
      const key = slugifyCustomFieldKey(label)
      if (!isValidCustomFieldKey(key)) throw new Error('INVALID_KEY')
      const [created] = await tx
        .insert(customFieldDefinitions)
        .values({
          tenantId: ctx.tenantId,
          entityKind: input.kind,
          subtypeId,
          key,
          label,
          helpText,
          fieldType: input.fieldType,
          config,
          required: input.required,
          groupLabel,
          groupKey,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .returning({ id: customFieldDefinitions.id })
      if (created) {
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'custom_field_definition',
          entityId: created.id,
          action: 'create',
          summary: `Created ${cfg.label} custom field "${label}"`,
          after: definitionSnapshot({
            label,
            helpText,
            fieldType: input.fieldType,
            config,
            required: input.required,
            groupLabel,
            groupKey,
            subtypeId,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          }),
        })
      }
      return created?.id
    })
    if (!savedId) return { ok: false, error: 'Failed to save the field.' }
    revalidatePath(cfg.designerPath)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'INVALID_KEY')
      return { ok: false, error: 'Could not derive a valid field key from that label.' }
    if (msg === 'INVALID_SUBTYPE')
      return {
        ok: false,
        error: `Choose an existing ${cfg.subtypeLabel?.toLowerCase() ?? 'type'}.`,
      }
    if (msg === 'IMMUTABLE_FIELD_TYPE')
      return { ok: false, error: 'Field type cannot be changed after creation.' }
    if (msg.startsWith('CUSTOM_FIELD_IN_USE:'))
      return { ok: false, error: msg.slice('CUSTOM_FIELD_IN_USE:'.length) }
    if (/unique|duplicate/i.test(msg))
      return { ok: false, error: 'A field with a matching key already exists for this entity.' }
    return { ok: false, error: 'Failed to save the field.' }
  }
}

/** Hard-delete a definition and every value stored under its now-retired key. */
export async function deleteCustomFieldDefAction(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const kindRaw = String(formData.get('kind') ?? '')
  if (!isEntityKind(kindRaw)) throw new Error('Unknown entity kind')
  const cfg = entityConfig(kindRaw)
  assertCan(ctx, cfg.permission)
  const id = String(formData.get('id') ?? '').trim()
  if (!isUuid(id)) return
  const outcome = await ctx.db(async (tx) => {
    // Lock the definition before clearing values. Value writers hold a shared
    // lock, so deletion cannot race a late write and recreate orphaned data.
    const [existing] = await tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.entityKind, kindRaw),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!existing) return { kind: 'missing' as const }

    if (existing.isActive) {
      const dependencies = await findCustomFieldAnalyticsDependencies(
        tx,
        ctx.tenantId,
        kindRaw,
        existing.key,
      )
      if (dependencies.reports || dependencies.cards) {
        return { kind: 'blocked' as const, dependencies }
      }
    }

    await purgeMetadataKeyInTransaction(tx, kindRaw, existing.key)
    const [removed] = await tx
      .delete(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.entityKind, kindRaw)))
      .returning({ id: customFieldDefinitions.id })
    if (!removed) throw new Error('Custom field could not be deleted.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'custom_field_definition',
      entityId: id,
      action: 'delete',
      summary: `Deleted ${cfg.label} custom field "${existing.label}" and its captured values`,
      before: {
        key: existing.key,
        label: existing.label,
        fieldType: existing.fieldType,
        subtypeId: existing.subtypeId,
      },
    })
    return { kind: 'deleted' as const }
  })
  if (outcome.kind === 'blocked') {
    const params = new URLSearchParams({
      deleteError: 'analytics_dependencies',
      reports: String(outcome.dependencies.reports),
      cards: String(outcome.dependencies.cards),
    })
    redirect(`${cfg.designerPath}?${params.toString()}` as never)
  }
  if (outcome.kind !== 'deleted') return
  revalidatePath(cfg.designerPath)
}
