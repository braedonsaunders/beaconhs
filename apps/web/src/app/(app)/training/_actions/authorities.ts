'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { trainingSkillAuthorities } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

/**
 * Instant-create a skill authority and land in its detail editor (name, code,
 * jurisdiction, and its skill types) — no separate create form. A blank name
 * defaults to a placeholder the admin renames there.
 */
export async function createAuthority(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const name = String(formData.get('name') ?? '').trim() || 'Untitled authority'
  const code = String(formData.get('code') ?? '').trim() || null
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(trainingSkillAuthorities)
      .values({ tenantId: ctx.tenantId, name, code, jurisdiction, notes })
      .returning()
    return r
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'training_skill_authority',
      entityId: row.id,
      action: 'create',
      summary: `Created authority "${name}"`,
      after: { name, code, jurisdiction },
    })
  }
  revalidatePath('/training/authorities')
  if (row) redirect(`/training/authorities/${row.id}?tab=skill_types`)
  redirect('/training/authorities')
}
