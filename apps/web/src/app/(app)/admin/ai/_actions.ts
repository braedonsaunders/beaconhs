'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import {
  isAiProvider,
  listModels,
  pingModel,
  type AiProvider,
  type ModelListItem,
} from '@beaconhs/ai'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { clearTenantAiKey, getTenantAiConfig, saveTenantAiSettings } from '@/lib/ai-config'

function gate(ctx: RequestContext) {
  if (!ctx.isSuperAdmin) assertCan(ctx, 'admin.settings.manage')
}

export async function saveAiSettings(formData: FormData) {
  const ctx = await requireRequestContext()
  gate(ctx)
  const enabled = formData.get('enabled') === 'on'
  const providerRaw = String(formData.get('provider') ?? '')
  const provider: AiProvider = isAiProvider(providerRaw) ? providerRaw : 'anthropic'
  const modelFast = String(formData.get('modelFast') ?? '').trim()
  const modelSmart = String(formData.get('modelSmart') ?? '').trim()
  const baseUrl = String(formData.get('baseUrl') ?? '').trim()
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const autoJournalAi = formData.get('autoJournalAi') === 'on'

  await saveTenantAiSettings(ctx, {
    enabled,
    provider,
    modelFast,
    modelSmart,
    baseUrl,
    apiKey: apiKey || undefined,
    autoJournalAi,
  })
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated AI settings',
    metadata: { provider, enabled, keyChanged: Boolean(apiKey) },
  })
  revalidatePath('/admin/ai')
}

export async function clearAiKey() {
  const ctx = await requireRequestContext()
  gate(ctx)
  await clearTenantAiKey(ctx)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed AI API key',
  })
  revalidatePath('/admin/ai')
}

export async function testAiConnection(): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireRequestContext()
  gate(ctx)
  const config = await getTenantAiConfig(ctx)
  return pingModel(config)
}

/**
 * List the models a provider exposes, for the settings dropdowns. Uses the key
 * typed into the form; falls back to the saved key when the provider is unchanged.
 */
export async function listAiModels(input: {
  provider: string
  baseUrl: string
  apiKey: string
}): Promise<{ ok: boolean; models: ModelListItem[]; message?: string }> {
  const ctx = await requireRequestContext()
  gate(ctx)
  const provider: AiProvider = isAiProvider(input.provider) ? input.provider : 'anthropic'
  let apiKey = input.apiKey.trim()
  let baseUrl = input.baseUrl.trim()
  if (!apiKey) {
    const saved = await getTenantAiConfig(ctx)
    if (saved && saved.provider === provider) {
      apiKey = saved.apiKey
      if (!baseUrl) baseUrl = saved.baseUrl ?? ''
    }
  }
  if (!apiKey) {
    return {
      ok: false,
      models: [],
      message: 'Enter an API key for this provider to load its models.',
    }
  }
  try {
    const models = await listModels({ provider, apiKey, baseUrl: baseUrl || null })
    if (!models.length) {
      return {
        ok: false,
        models: [],
        message: 'The provider returned no models — enter the id manually.',
      }
    }
    return { ok: true, models }
  } catch (e) {
    return {
      ok: false,
      models: [],
      message: e instanceof Error ? e.message.slice(0, 180) : 'Could not load models.',
    }
  }
}
