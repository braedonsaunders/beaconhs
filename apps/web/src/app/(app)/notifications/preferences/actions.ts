'use server'

// Upsert per-(user, tenant, category, channel) notification preferences.
//
// One row per (category, channel) combination. We accept the full matrix from
// the client and upsert each cell — the unique index on
// (tenant_id, user_id, category, channel) drives onConflictDoUpdate.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { notificationPreferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from './_constants'

const categoryEnum = z.enum(NOTIFICATION_CATEGORIES)
const channelEnum = z.enum(NOTIFICATION_CHANNELS)

const PrefSchema = z.object({
  category: categoryEnum,
  channel: channelEnum,
  enabled: z.boolean(),
})

const InputSchema = z.object({
  prefs: z.array(PrefSchema).max(NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length),
})

export async function saveNotificationPreferences(input: unknown) {
  const ctx = await requireRequestContext()
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.message }
  }

  await ctx.db(async (tx) => {
    for (const pref of parsed.data.prefs) {
      await tx
        .insert(notificationPreferences)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          category: pref.category,
          channel: pref.channel,
          enabled: pref.enabled,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.tenantId,
            notificationPreferences.userId,
            notificationPreferences.category,
            notificationPreferences.channel,
          ],
          set: {
            enabled: pref.enabled,
            updatedAt: new Date(),
          },
        })
    }
  })

  revalidatePath('/notifications/preferences')
  return { ok: true as const }
}
