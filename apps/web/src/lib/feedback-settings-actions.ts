'use server'

import { revalidatePath } from 'next/cache'
import { PLATFORM_SETTINGS_ID } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { clearPlatformFeedbackToken, savePlatformFeedbackSettings } from '@/lib/feedback-config'

async function gatePlatform() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin) {
    throw new Error('Only platform super-admins can change issue reporting settings.')
  }
  return ctx
}

export async function savePlatformFeedback(formData: FormData) {
  const ctx = await gatePlatform()
  const input = {
    enabled: formData.get('enabled') === 'on',
    owner: String(formData.get('owner') ?? ''),
    repo: String(formData.get('repo') ?? ''),
    labels: String(formData.get('labels') ?? ''),
    searchDuplicates: formData.get('searchDuplicates') === 'on',
    token: String(formData.get('token') ?? '').trim() || undefined,
  }
  await savePlatformFeedbackSettings(input)
  await recordAudit(ctx, {
    entityType: 'platform_settings',
    entityId: PLATFORM_SETTINGS_ID,
    action: 'update',
    summary: 'Updated in-app issue reporting settings',
    metadata: {
      enabled: input.enabled,
      owner: input.owner.trim(),
      repo: input.repo.trim(),
      keyChanged: Boolean(input.token),
      searchDuplicates: input.searchDuplicates,
    },
  })
  revalidatePath('/platform/feedback')
  revalidatePath('/platform')
}

export async function clearPlatformFeedback() {
  const ctx = await gatePlatform()
  await clearPlatformFeedbackToken()
  await recordAudit(ctx, {
    entityType: 'platform_settings',
    entityId: PLATFORM_SETTINGS_ID,
    action: 'update',
    summary: 'Removed the issue reporting access token',
  })
  revalidatePath('/platform/feedback')
  revalidatePath('/platform')
}
