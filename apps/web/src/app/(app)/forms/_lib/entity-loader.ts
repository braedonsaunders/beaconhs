// Thin web-app wrapper around @beaconhs/db's shared entity-attr loader.
//
// The loader proper (see @beaconhs/db/form-picker-entities) accepts a plain
// Database executor — both web and worker call it. This file binds the
// RequestContext.db() helper for ergonomic use from RSCs + server actions,
// and exposes a `fetchSingleEntityAttrs` helper used by the on-picker-change
// runtime refresh.

import 'server-only'
import {
  loadEntitiesForFormPickers,
  type EntitiesByField,
} from '@beaconhs/db'
import {
  ENTITY_ATTRS,
  entityKindForPicker,
  type FormField,
  type FormSchemaV1,
} from '@beaconhs/forms-core'
import type { RequestContext } from '@beaconhs/tenant'

export type { EntitiesByField }

/**
 * Resolve entity-attr maps for every picker field in the form schema.
 * Returns `{ pickerFieldKey: attrMap | null }` keyed by the picker's field
 * id — null when the picker has no selection. RLS is enforced by the
 * RequestContext's bound db helper.
 */
export async function loadEntitiesForPickers(
  ctx: RequestContext,
  schema: FormSchemaV1,
  values: Record<string, unknown>,
): Promise<EntitiesByField> {
  return await ctx.db(async (tx) =>
    loadEntitiesForFormPickers(tx, schema, values),
  )
}

/**
 * Single-entity refresh used when a picker changes in the filler. The
 * server re-derives the EntityKind from the picker field type, so callers
 * can't trick us into surfacing the wrong entity kind.
 */
export async function fetchSingleEntityAttrs(
  ctx: RequestContext,
  pickerFieldType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  const kind = entityKindForPicker(pickerFieldType)
  if (!kind) return null
  // We build a one-field synthetic schema and reuse the bulk loader so the
  // per-kind SELECT lists stay in lockstep with the first-render path.
  const synthSchema: FormSchemaV1 = {
    schemaVersion: 1,
    title: { en: '__synth__' },
    sections: [
      {
        id: '__synth__',
        fields: [
          {
            id: '__synth__',
            type: pickerFieldType as FormField['type'],
            label: { en: '__synth__' },
          },
        ],
      },
    ],
    workflow: {
      steps: [
        {
          key: '__synth__',
          title: { en: '__synth__' },
          assignee: { type: 'role', role: 'worker' },
        },
      ],
    },
  }
  const map = await ctx.db(async (tx) =>
    loadEntitiesForFormPickers(tx, synthSchema, {
      __synth__: entityId,
    }),
  )
  return map['__synth__'] ?? null
}

// Re-export so call sites have a single import.
export { ENTITY_ATTRS }
