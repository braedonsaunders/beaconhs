'use server'

import { revalidatePath } from 'next/cache'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import {
  isAiProvider,
  listModels,
  pingModel,
  type AiPolicyMode,
  type AiProvider,
  type ModelListItem,
} from '@beaconhs/ai'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  clearPlatformAiKey,
  clearTenantAiKey,
  getPlatformAiConfig,
  getTenantOwnAiConfig,
  savePlatformAiSettings,
  saveTenantAiSettings,
  type AiSettingsInput,
} from '@/lib/ai-config'

function gateTenant(ctx: RequestContext) {
  if (!ctx.isSuperAdmin) assertCan(ctx, 'admin.settings.manage')
}

function gatePlatform(ctx: RequestContext) {
  if (!ctx.isSuperAdmin)
    throw new Error('Only platform super-admins can change global AI settings.')
}

function parseInput(fd: FormData): AiSettingsInput {
  const providerRaw = String(fd.get('provider') ?? '')
  const provider: AiProvider = isAiProvider(providerRaw) ? providerRaw : 'anthropic'
  return {
    enabled: fd.get('enabled') === 'on',
    provider,
    modelFast: String(fd.get('modelFast') ?? '').trim(),
    modelSmart: String(fd.get('modelSmart') ?? '').trim(),
    baseUrl: String(fd.get('baseUrl') ?? '').trim(),
    apiKey: String(fd.get('apiKey') ?? '').trim() || undefined,
  }
}

export async function saveTenantAi(formData: FormData) {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  const input = parseInput(formData)
  const autoJournalAi = formData.get('autoJournalAi') === 'on'
  await saveTenantAiSettings(ctx, { ...input, autoJournalAi })
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Updated AI settings',
    metadata: {
      provider: input.provider,
      enabled: input.enabled,
      keyChanged: Boolean(input.apiKey),
    },
  })
  revalidatePath('/admin/ai')
}

export async function clearTenantAi() {
  const ctx = await requireRequestContext()
  gateTenant(ctx)
  await clearTenantAiKey(ctx)
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed AI API key',
  })
  revalidatePath('/admin/ai')
}

export async function savePlatformAi(formData: FormData) {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  const input = parseInput(formData)
  const modeRaw = String(formData.get('mode') ?? 'tenant_optional')
  const mode: AiPolicyMode =
    modeRaw === 'global_only' || modeRaw === 'disabled' ? modeRaw : 'tenant_optional'
  await savePlatformAiSettings({ ...input, mode })
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: `Updated platform AI settings (policy: ${mode})`,
    metadata: { provider: input.provider, mode, enabled: input.enabled },
  })
  revalidatePath('/platform/ai')
}

export async function clearPlatformAi() {
  const ctx = await requireRequestContext()
  gatePlatform(ctx)
  await clearPlatformAiKey()
  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Removed platform AI API key',
  })
  revalidatePath('/platform/ai')
}

/** Live test of the SAVED config for the given scope (own config, not the policy fallback). */
export async function testAiConnection(input: {
  scope: 'tenant' | 'platform'
}): Promise<{ ok: boolean; message: string }> {
  const ctx = await requireRequestContext()
  if (input.scope === 'platform') gatePlatform(ctx)
  else gateTenant(ctx)
  const config =
    input.scope === 'platform' ? await getPlatformAiConfig() : await getTenantOwnAiConfig(ctx)
  return pingModel(config)
}

/**
 * List the models a provider exposes, for the settings dropdowns. Uses the key
 * typed into the form; falls back to the scope's saved key when the provider is
 * unchanged.
 */
export async function listAiModels(input: {
  scope: 'tenant' | 'platform'
  provider: string
  baseUrl: string
  apiKey: string
}): Promise<{ ok: boolean; models: ModelListItem[]; message?: string }> {
  const ctx = await requireRequestContext()
  if (input.scope === 'platform') gatePlatform(ctx)
  else gateTenant(ctx)
  const provider: AiProvider = isAiProvider(input.provider) ? input.provider : 'anthropic'
  let apiKey = input.apiKey.trim()
  let baseUrl = input.baseUrl.trim()
  if (!apiKey) {
    const saved =
      input.scope === 'platform' ? await getPlatformAiConfig() : await getTenantOwnAiConfig(ctx)
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
