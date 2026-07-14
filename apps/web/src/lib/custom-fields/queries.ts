// Server-side reads for the custom-field system. Plain helpers (not server
// actions) — callers already hold a RequestContext and run inside its
// RLS-scoped db executor.

import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { customFieldDefinitions, equipmentTypes, ppeTypes } from '@beaconhs/db/schema'
import type {
  CustomFieldConfig,
  CustomFieldEntityKind,
  CustomFieldType,
} from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

export type CustomFieldDefRow = {
  id: string
  entityKind: CustomFieldEntityKind
  subtypeId: string | null
  key: string
  label: string
  helpText: string | null
  fieldType: CustomFieldType
  config: CustomFieldConfig | null
  required: boolean
  groupLabel: string | null
  groupKey: string | null
  sortOrder: number
  isActive: boolean
}

function mapRow(r: typeof customFieldDefinitions.$inferSelect): CustomFieldDefRow {
  return {
    id: r.id,
    entityKind: r.entityKind as CustomFieldEntityKind,
    subtypeId: r.subtypeId,
    key: r.key,
    label: r.label,
    helpText: r.helpText,
    fieldType: r.fieldType as CustomFieldType,
    config: (r.config ?? null) as CustomFieldConfig | null,
    required: r.required,
    groupLabel: r.groupLabel,
    groupKey: r.groupKey,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  }
}

const orderCols = [
  asc(customFieldDefinitions.groupLabel),
  asc(customFieldDefinitions.sortOrder),
  asc(customFieldDefinitions.label),
]

/**
 * Active definitions visible for a single record — every field for the kind
 * with NULL subtype scope, plus those scoped to the record's own subtype.
 */
export async function loadVisibleCustomFieldDefs(
  ctx: Ctx,
  kind: CustomFieldEntityKind,
  subtypeId: string | null,
): Promise<CustomFieldDefRow[]> {
  const scope = subtypeId
    ? or(isNull(customFieldDefinitions.subtypeId), eq(customFieldDefinitions.subtypeId, subtypeId))
    : isNull(customFieldDefinitions.subtypeId)
  const rows = await ctx.db((tx) =>
    tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.entityKind, kind),
          eq(customFieldDefinitions.isActive, true),
          isNull(customFieldDefinitions.deletedAt),
          scope,
        ),
      )
      .orderBy(...orderCols),
  )
  return rows.map(mapRow)
}

/** One definition for the designer drawer, including rows outside the current page. */
export async function loadCustomFieldDefById(
  ctx: Ctx,
  kind: CustomFieldEntityKind,
  id: string,
): Promise<CustomFieldDefRow | null> {
  const [row] = await ctx.db((tx) =>
    tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.entityKind, kind),
          isNull(customFieldDefinitions.deletedAt),
        ),
      )
      .limit(1),
  )
  return row ? mapRow(row) : null
}

/** Searchable, bounded designer-table page for one entity kind. */
export async function loadCustomFieldDefPage(
  ctx: Ctx,
  kind: CustomFieldEntityKind,
  options: {
    q?: string
    status?: 'active' | 'hidden'
    page: number
    perPage: number
  },
): Promise<{ rows: CustomFieldDefRow[]; total: number }> {
  const conditions: SQL<unknown>[] = [
    eq(customFieldDefinitions.entityKind, kind),
    isNull(customFieldDefinitions.deletedAt),
  ]
  if (options.q) {
    const term = `%${options.q}%`
    const search = or(
      ilike(customFieldDefinitions.label, term),
      ilike(customFieldDefinitions.key, term),
      ilike(customFieldDefinitions.helpText, term),
      ilike(customFieldDefinitions.groupLabel, term),
    )
    if (search) conditions.push(search)
  }
  if (options.status) {
    conditions.push(eq(customFieldDefinitions.isActive, options.status === 'active'))
  }
  const where = and(...conditions)
  const [rows, [totalRow]] = await ctx.db((tx) =>
    Promise.all([
      tx
        .select()
        .from(customFieldDefinitions)
        .where(where)
        .orderBy(...orderCols)
        .limit(options.perPage)
        .offset((options.page - 1) * options.perPage),
      tx.select({ c: count() }).from(customFieldDefinitions).where(where),
    ]),
  )
  return { rows: rows.map(mapRow), total: Number(totalRow?.c ?? 0) }
}

/** Subtype options for the designer scope picker (equipment/ppe types). */
export async function loadSubtypeOptions(
  ctx: Ctx,
  kind: CustomFieldEntityKind,
): Promise<{ id: string; name: string }[]> {
  if (kind === 'equipment') {
    return ctx.db((tx) =>
      tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .orderBy(asc(equipmentTypes.name)),
    )
  }
  if (kind === 'ppe') {
    return ctx.db((tx) =>
      tx
        .select({ id: ppeTypes.id, name: ppeTypes.name })
        .from(ppeTypes)
        .orderBy(asc(ppeTypes.name)),
    )
  }
  return []
}
