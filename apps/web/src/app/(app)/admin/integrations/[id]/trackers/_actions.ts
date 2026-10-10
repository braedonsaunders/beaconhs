'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { equipmentItems, equipmentTelemetryAssets, syncConnections } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import type { PickerOptionsResponse } from '@/lib/picker-options'

export async function findTrackerEquipment(input: {
  query: string
  selected: string | null
}): Promise<PickerOptionsResponse> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.integrations.manage')
  if (
    typeof input?.query !== 'string' ||
    (input.selected !== null && typeof input.selected !== 'string')
  )
    return { options: [], hasMore: false }
  const query = input.query.slice(0, 100).trim()
  const { rows, selected } = await ctx.db(async (tx) => {
    const fields = {
      id: equipmentItems.id,
      name: equipmentItems.name,
      assetTag: equipmentItems.assetTag,
    }
    const [selected] =
      input.selected && isUuid(input.selected)
        ? await tx
            .select(fields)
            .from(equipmentItems)
            .where(and(eq(equipmentItems.id, input.selected), isNull(equipmentItems.deletedAt)))
            .limit(1)
        : []
    const rows = await tx
      .select(fields)
      .from(equipmentItems)
      .where(
        and(
          isNull(equipmentItems.deletedAt),
          query
            ? or(
                ilike(equipmentItems.name, `%${query}%`),
                ilike(equipmentItems.assetTag, `%${query}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(equipmentItems.assetTag), asc(equipmentItems.id))
      .limit(31)
    return { rows, selected }
  })
  const options = rows.slice(0, 30)
  if (selected && !options.some((row) => row.id === selected.id)) options.push(selected)
  return {
    options: options.map((row) => ({ value: row.id, label: `${row.assetTag} · ${row.name}` })),
    hasMore: rows.length > 30,
  }
}

export async function saveTrackerBinding(input: {
  trackerId: string
  itemId: string | null
  excluded: boolean
  expectedItemId: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.integrations.manage')
  if (
    !isUuid(input.trackerId) ||
    (input.itemId !== null && !isUuid(input.itemId)) ||
    (input.expectedItemId !== null && !isUuid(input.expectedItemId)) ||
    typeof input.excluded !== 'boolean'
  )
    return { ok: false, error: 'Choose a valid equipment record.' }
  if (input.excluded && input.itemId)
    return { ok: false, error: 'An excluded tracker cannot be linked to equipment.' }
  try {
    const connectionId = await ctx.db(async (tx) => {
      const [identity] = await tx
        .select({ connectionId: equipmentTelemetryAssets.connectionId })
        .from(equipmentTelemetryAssets)
        .where(eq(equipmentTelemetryAssets.id, input.trackerId))
        .limit(1)
      if (!identity) throw new Error('Tracker not found.')
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`telemetry:${ctx.tenantId}:${identity.connectionId}`}, 0))`,
      )
      const [tracker] = await tx
        .select()
        .from(equipmentTelemetryAssets)
        .where(eq(equipmentTelemetryAssets.id, input.trackerId))
        .for('update')
        .limit(1)
      if (!tracker) throw new Error('Tracker not found.')
      if (tracker.itemId !== input.expectedItemId)
        throw new Error('The tracker assignment changed. Refresh before saving.')
      const [connection] = await tx
        .select({ id: syncConnections.id })
        .from(syncConnections)
        .where(and(eq(syncConnections.id, tracker.connectionId), isNull(syncConnections.deletedAt)))
        .limit(1)
      if (!connection) throw new Error('The integration has been deleted.')
      if (input.itemId) {
        const [equipment] = await tx
          .select({ id: equipmentItems.id })
          .from(equipmentItems)
          .where(and(eq(equipmentItems.id, input.itemId), isNull(equipmentItems.deletedAt)))
          .for('update')
          .limit(1)
        if (!equipment) throw new Error('Select active equipment.')
        const [owner] = await tx
          .select({ id: equipmentTelemetryAssets.id })
          .from(equipmentTelemetryAssets)
          .where(eq(equipmentTelemetryAssets.itemId, input.itemId))
          .limit(1)
        if (owner && owner.id !== tracker.id)
          throw new Error('This equipment already has a tracker. Unlink its current tracker first.')
      }
      const boundAt =
        tracker.itemId === input.itemId ? tracker.boundAt : input.itemId ? new Date() : null
      await tx
        .update(equipmentTelemetryAssets)
        .set({ itemId: input.itemId, boundAt, excluded: input.excluded })
        .where(eq(equipmentTelemetryAssets.id, tracker.id))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_telemetry_asset',
        entityId: tracker.id,
        action: 'update',
        summary: input.excluded
          ? 'Excluded tracker from equipment tracking'
          : 'Updated tracker equipment assignment',
        before: { itemId: tracker.itemId, excluded: tracker.excluded },
        after: {
          itemId: input.itemId,
          excluded: input.excluded,
          boundAt: boundAt?.toISOString() ?? null,
        },
      })
      return tracker.connectionId
    })
    revalidatePath(`/admin/integrations/${connectionId}/trackers`)
    revalidatePath('/equipment/location')
    revalidatePath('/equipment/[id]', 'page')
    return { ok: true }
  } catch (error) {
    // Do not expose database errors or payloads through the browser.
    const message = error instanceof Error ? error.message : ''
    const safe = [
      'Tracker not found.',
      'The tracker assignment changed. Refresh before saving.',
      'The integration has been deleted.',
      'Select active equipment.',
      'This equipment already has a tracker. Unlink its current tracker first.',
    ]
    return {
      ok: false,
      error: safe.includes(message)
        ? message
        : 'Could not save the tracker assignment. Refresh and retry.',
    }
  }
}
