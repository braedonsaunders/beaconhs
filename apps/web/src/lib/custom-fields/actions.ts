'use server'

// Server actions for the custom-field system: value writes on record pages, and
// definition CRUD in the designer. Both gate on the host entity's permission so
// the custom-field layer is never looser than the module it decorates.

import { revalidatePath } from 'next/cache'
import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import {
  CUSTOM_FIELD_ENTITY_KINDS,
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
  orgUnits,
  people,
  ppeItems,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { entityConfig } from './config'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

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
  // `key` is validated against the strict slug regex before we get here, so
  // interpolating it into the jsonb path literal is safe.
  const path = sql.raw(`'{custom,${key}}'`)
  if (value === null) return sql`coalesce(${col}, '{}'::jsonb) #- ${path}`
  return sql`jsonb_set(coalesce(${col}, '{}'::jsonb), ${path}, ${JSON.stringify(value)}::jsonb, true)`
}

async function writeMetadata(
  ctx: Ctx,
  kind: CustomFieldEntityKind,
  id: string,
  key: string,
  value: string | number | boolean | string[] | null,
): Promise<void> {
  await ctx.db((tx) => {
    switch (kind) {
      case 'equipment':
        return tx
          .update(equipmentItems)
          .set({ metadata: metadataValueExpr(equipmentItems.metadata, key, value) })
          .where(eq(equipmentItems.id, id))
      case 'ppe':
        return tx
          .update(ppeItems)
          .set({ metadata: metadataValueExpr(ppeItems.metadata, key, value) })
          .where(eq(ppeItems.id, id))
      case 'person':
        return tx
          .update(people)
          .set({ metadata: metadataValueExpr(people.metadata, key, value) })
          .where(eq(people.id, id))
      case 'location':
        return tx
          .update(orgUnits)
          .set({ metadata: metadataValueExpr(orgUnits.metadata, key, value) })
          .where(eq(orgUnits.id, id))
    }
  })
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
  if (!id || !key) throw new Error('Missing id/key')

  // The definition is the contract: only an active field for this kind/key may
  // be written, and it dictates the coercion + validation.
  const def = await ctx.db((tx) =>
    tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.entityKind, kind),
          eq(customFieldDefinitions.key, key),
          eq(customFieldDefinitions.isActive, true),
        ),
      )
      .limit(1),
  )
  const row = def[0]
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

  await writeMetadata(ctx, kind, id, key, coerced.value)
  await recordAudit(ctx, {
    entityType: AUDIT_ENTITY[kind],
    entityId: id,
    action: 'update',
    summary: `Updated custom field "${row.label}"`,
    after: { [`custom.${key}`]: coerced.value },
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
  subtypeId: string | null
  sortOrder: number
  isActive: boolean
}

export type SaveResult = { ok: true } | { ok: false; error: string }

/** Create or update a custom-field definition. */
export async function saveCustomFieldDefAction(input: SaveCustomFieldInput): Promise<SaveResult> {
  const ctx = await requireRequestContext()
  if (!isEntityKind(input.kind)) return { ok: false, error: 'Unknown entity kind.' }
  const cfg = entityConfig(input.kind)
  assertCan(ctx, cfg.permission)

  const label = input.label.trim()
  if (!label) return { ok: false, error: 'Label is required.' }
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(input.fieldType))
    return { ok: false, error: 'Invalid field type.' }

  const meta = CUSTOM_FIELD_TYPE_META[input.fieldType]
  const config = normalizeCustomFieldConfig(input.fieldType, input.config)
  if (meta.hasOptions && (!config?.options || config.options.length === 0))
    return { ok: false, error: 'Add at least one option for a choice field.' }

  // Subtype scope only applies to kinds that have subtypes.
  const subtypeId = cfg.hasSubtype ? input.subtypeId || null : null
  const groupLabel = input.groupLabel?.trim() || null
  const helpText = input.helpText?.trim() || null

  try {
    const savedId = await ctx.db(async (tx) => {
      if (input.id) {
        // Key is immutable after creation (stored values are keyed by it).
        // The entityKind filter pins the row to the kind whose permission was
        // checked above — an id from another module never matches.
        const [updated] = await tx
          .update(customFieldDefinitions)
          .set({
            label,
            helpText,
            fieldType: input.fieldType,
            config,
            required: input.required,
            groupLabel,
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
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        })
        .returning({ id: customFieldDefinitions.id })
      return created?.id
    })
    if (!savedId) return { ok: false, error: 'Failed to save the field.' }

    await recordAudit(ctx, {
      entityType: 'custom_field_definition',
      entityId: savedId,
      action: input.id ? 'update' : 'create',
      summary: `${input.id ? 'Updated' : 'Created'} ${cfg.label} custom field "${label}"`,
    })
    revalidatePath(cfg.designerPath)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'INVALID_KEY')
      return { ok: false, error: 'Could not derive a valid field key from that label.' }
    if (/unique|duplicate/i.test(msg))
      return { ok: false, error: 'A field with a matching key already exists for this entity.' }
    return { ok: false, error: 'Failed to save the field.' }
  }
}

/**
 * Hard-delete a definition. Any values already stored on records under this
 * key are left in place (harmless — they're simply no longer rendered) so the
 * delete stays O(1) and the key is freed for reuse.
 */
export async function deleteCustomFieldDefAction(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const kindRaw = String(formData.get('kind') ?? '')
  if (!isEntityKind(kindRaw)) throw new Error('Unknown entity kind')
  const cfg = entityConfig(kindRaw)
  assertCan(ctx, cfg.permission)
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  // The entityKind filter pins the row to the kind whose permission was checked
  // above — an id from another module never matches (and is never audited).
  const [deleted] = await ctx.db((tx) =>
    tx
      .delete(customFieldDefinitions)
      .where(
        and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.entityKind, kindRaw)),
      )
      .returning({ id: customFieldDefinitions.id }),
  )
  if (!deleted) return
  await recordAudit(ctx, {
    entityType: 'custom_field_definition',
    entityId: id,
    action: 'delete',
    summary: `Deleted ${cfg.label} custom field`,
  })
  revalidatePath(cfg.designerPath)
}
