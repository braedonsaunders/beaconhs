// Config-driven AI client. Provider + API key + models (+ base URL) are passed
// in per call (resolved from per-tenant settings), NOT read from the environment.

import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'

export type AiProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'xai'
  | 'deepseek'
  | 'mistral'
  | 'custom'

export type ModelTier = 'fast' | 'smart'

export type AiConfig = {
  provider: AiProvider
  apiKey: string
  modelFast?: string | null
  modelSmart?: string | null
  /**
   * Endpoint for OpenAI-compatible providers. Required for `custom`; for the
   * named compatible providers it is an optional override of the built-in URL.
   */
  baseUrl?: string | null
}

// How a provider's language model is constructed. The OpenAI-compatible kind
// covers OpenRouter, Groq, xAI, DeepSeek, Mistral and any user `custom` endpoint.
type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openai-compatible'

export type ProviderSpec = {
  value: AiProvider
  label: string
  kind: ProviderKind
  /** Built-in endpoint for a named OpenAI-compatible provider (null otherwise). */
  baseUrl: string | null
  /** True when the tenant MUST supply their own base URL (i.e. `custom`). */
  requiresBaseUrl: boolean
  /** Default fast/smart model ids (placeholders + fallbacks). Empty for `custom`. */
  fast: string
  smart: string
  /** Placeholder shown in the API-key field. */
  keyHint: string
  /** Optional note about the model-id format for this provider. */
  modelHint?: string
}

/**
 * Provider catalogue — single source of truth for the settings UI, the model
 * factory and config validation. Add a provider here and it lights up everywhere.
 */
export const AI_PROVIDER_SPECS: ProviderSpec[] = [
  {
    value: 'anthropic',
    label: 'Anthropic — Claude',
    kind: 'anthropic',
    baseUrl: null,
    requiresBaseUrl: false,
    fast: 'claude-haiku-4-5-20251001',
    smart: 'claude-sonnet-4-6',
    keyHint: 'sk-ant-…',
  },
  {
    value: 'openai',
    label: 'OpenAI — GPT',
    kind: 'openai',
    baseUrl: null,
    requiresBaseUrl: false,
    fast: 'gpt-4o-mini',
    smart: 'gpt-4o',
    keyHint: 'sk-…',
  },
  {
    value: 'google',
    label: 'Google — Gemini',
    kind: 'google',
    baseUrl: null,
    requiresBaseUrl: false,
    fast: 'gemini-2.5-flash',
    smart: 'gemini-2.5-pro',
    keyHint: 'AIza…',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter — any model, one key',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresBaseUrl: false,
    fast: 'anthropic/claude-3.5-haiku',
    smart: 'anthropic/claude-3.5-sonnet',
    keyHint: 'sk-or-…',
    modelHint: 'Use vendor/model slugs, e.g. anthropic/claude-3.5-sonnet or openai/gpt-4o.',
  },
  {
    value: 'groq',
    label: 'Groq — fast inference',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresBaseUrl: false,
    fast: 'llama-3.1-8b-instant',
    smart: 'llama-3.3-70b-versatile',
    keyHint: 'gsk_…',
  },
  {
    value: 'xai',
    label: 'xAI — Grok',
    kind: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    requiresBaseUrl: false,
    fast: 'grok-2-1212',
    smart: 'grok-2-vision-1212',
    keyHint: 'xai-…',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    requiresBaseUrl: false,
    fast: 'deepseek-chat',
    smart: 'deepseek-chat',
    keyHint: 'sk-…',
  },
  {
    value: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    requiresBaseUrl: false,
    fast: 'mistral-small-latest',
    smart: 'mistral-large-latest',
    keyHint: 'Your Mistral API key',
  },
  {
    value: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai-compatible',
    baseUrl: null,
    requiresBaseUrl: true,
    fast: '',
    smart: '',
    keyHint: 'Your provider API key',
    modelHint:
      'Point Base URL at any OpenAI-compatible endpoint (Together, Fireworks, Perplexity, Ollama, vLLM, …) and set explicit model ids.',
  },
]

const SPEC_BY_VALUE = Object.fromEntries(AI_PROVIDER_SPECS.map((s) => [s.value, s])) as Record<
  AiProvider,
  ProviderSpec
>

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && value in SPEC_BY_VALUE
}

export function providerSpec(provider: AiProvider): ProviderSpec {
  return SPEC_BY_VALUE[provider]
}

export function defaultModel(provider: AiProvider, tier: ModelTier): string {
  const spec = SPEC_BY_VALUE[provider] ?? SPEC_BY_VALUE.anthropic
  return tier === 'smart' ? spec.smart : spec.fast
}

export function isAiConfigured(config: AiConfig | null | undefined): config is AiConfig {
  if (!config || !config.apiKey) return false
  const spec = SPEC_BY_VALUE[config.provider]
  if (!spec) return false
  if (spec.requiresBaseUrl && !config.baseUrl?.trim()) return false
  return true
}

/** Resolve a language model from a tenant's config, or null when not configured. */
export function getModel(
  config: AiConfig | null | undefined,
  tier: ModelTier = 'fast',
): LanguageModel | null {
  if (!isAiConfigured(config)) return null
  const spec = SPEC_BY_VALUE[config.provider]
  const modelId =
    (tier === 'smart' ? config.modelSmart : config.modelFast) || defaultModel(config.provider, tier)
  // `custom` has no default model — without an explicit one, AI stays disabled.
  if (!modelId) return null

  switch (spec.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(modelId)
    case 'openai-compatible': {
      const baseURL = config.baseUrl?.trim() || spec.baseUrl
      if (!baseURL) return null
      return createOpenAICompatible({ name: spec.value, apiKey: config.apiKey, baseURL })(modelId)
    }
  }
}

export class AIDisabledError extends Error {
  override readonly name = 'AIDisabledError'
  constructor() {
    super('AI is not configured for this tenant. Set a provider + API key under Admin → AI.')
  }
}

/** Live test of a config — sends a tiny prompt and reports success/failure. */
export async function pingModel(
  config: AiConfig | null | undefined,
): Promise<{ ok: boolean; message: string }> {
  const model = getModel(config, 'fast')
  if (!model) {
    return {
      ok: false,
      message: 'Not configured yet — check the provider, API key, model and base URL.',
    }
  }
  try {
    const { text } = await generateText({ model, prompt: 'Reply with the single word: ok' })
    return { ok: true, message: `Connected — the model replied “${text.trim().slice(0, 24)}”.` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 180) : 'Request failed.' }
  }
}
