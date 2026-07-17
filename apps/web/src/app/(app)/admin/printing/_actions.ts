'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  DIRECT_PRINT_PROVIDER_LABELS,
  isDirectPrintProvider,
  saveTenantPrintingProvider,
} from '@/lib/direct-printing'

export async function savePrintingProvider(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.settings.manage')
  const provider = String(formData.get('provider') ?? '')
  if (!isDirectPrintProvider(provider)) throw new Error('Select a valid printer provider.')

  try {
    await saveTenantPrintingProvider(ctx, {
      provider,
      enabled: formData.get('enabled') === 'on',
      url: String(formData.get('url') ?? ''),
      printer: String(formData.get('printer') ?? ''),
      token: String(formData.get('token') ?? ''),
      clearToken: formData.get('clearToken') === 'on',
      basicAuthUsername: String(formData.get('basicAuthUsername') ?? ''),
      basicAuthPassword: String(formData.get('basicAuthPassword') ?? ''),
      clearBasicAuthPassword: formData.get('clearBasicAuthPassword') === 'on',
      loginName: String(formData.get('loginName') ?? ''),
      loginPassword: String(formData.get('loginPassword') ?? ''),
      clearLoginPassword: formData.get('clearLoginPassword') === 'on',
      cardDocument: String(formData.get('cardDocument') ?? ''),
      frontItemId: String(formData.get('frontItemId') ?? ''),
      backItemId: String(formData.get('backItemId') ?? ''),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Printer settings could not be saved.'
    redirect(`/admin/printing?error=${encodeURIComponent(message)}#${provider}`)
  }

  await recordAudit(ctx, {
    entityType: 'tenant_printing_settings',
    entityId: ctx.tenantId,
    action: 'update',
    summary: `Updated ${DIRECT_PRINT_PROVIDER_LABELS[provider]} settings`,
    after: { provider, enabled: formData.get('enabled') === 'on' },
  })
  revalidatePath('/admin/printing')
  revalidatePath('/people')
  revalidatePath('/training')
  redirect(
    `/admin/printing?notice=${encodeURIComponent(`${DIRECT_PRINT_PROVIDER_LABELS[provider]} saved.`)}#${provider}`,
  )
}
