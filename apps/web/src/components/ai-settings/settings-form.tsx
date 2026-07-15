'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button, Input, Label, SearchSelect, type SelectOption } from '@beaconhs/ui'
import { listAiModels } from '@/lib/ai-settings-actions'

// Serializable slice of a provider spec (no SDK code reaches the client bundle).
export type ProviderSpecLite = {
  value: string
  label: string
  baseUrl: string | null
  requiresBaseUrl: boolean
  fast: string
  smart: string
  keyHint: string
  modelHint?: string
}

type AiFormInitial = {
  enabled: boolean
  provider: string
  modelFast: string
  modelSmart: string
  baseUrl: string
  hasKey: boolean
  autoJournalAi?: boolean
  mode?: string
}

const MODE_OPTIONS = [
  { value: 'tenant_optional', label: 'Tenants choose their own (recommended)' },
  { value: 'global_only', label: 'Force the platform default for all tenants' },
  { value: 'disabled', label: 'Disable all AI (kill switch)' },
]

const MODE_HELP: Record<string, string> = {
  tenant_optional:
    'Each tenant may configure its own provider below. Tenants with none fall back to this platform default.',
  global_only: 'Every tenant uses this platform default. Per-tenant provider settings are ignored.',
  disabled: 'No AI runs for any tenant. Every AI feature is turned off platform-wide.',
}

// Reactive AI settings form: the provider selector drives the base-URL field, the
// API-key hint and the model dropdowns. Model lists are fetched live from the
// provider's API (via listAiModels). Reused for the per-tenant and platform
// (super-admin) scope — the platform scope adds the policy selector and omits the
// tenant-only journal automation toggle.
export function AiSettingsForm({
  action,
  specs,
  initial,
  scope,
}: {
  action: (formData: FormData) => void | Promise<void>
  specs: ProviderSpecLite[]
  initial: AiFormInitial
  scope: 'tenant' | 'platform'
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [provider, setProvider] = useState(initial.provider)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [modelFast, setModelFast] = useState(initial.modelFast)
  const [modelSmart, setModelSmart] = useState(initial.modelSmart)
  const [mode, setMode] = useState(initial.mode ?? 'tenant_optional')

  const [models, setModels] = useState<{ id: string; label?: string }[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [loading, startLoad] = useTransition()
  const modelRequestId = useRef(0)

  const requestModels = useCallback(
    (requestedProvider: string, key: string, requestedBaseUrl: string) => {
      const requestId = ++modelRequestId.current
      startLoad(async () => {
        const result = await listAiModels({
          scope,
          provider: requestedProvider,
          baseUrl: requestedBaseUrl,
          apiKey: key,
        })
        if (requestId !== modelRequestId.current) return

        if (result.ok) {
          setModels(result.models)
          setModelsError(null)
        } else {
          setModels([])
          setModelsError(result.message ?? 'Could not load models.')
        }
      })
      return requestId
    },
    [scope],
  )

  // Auto-load the saved provider's models on first render (a key is on file).
  // Must run before any early return so the hook order stays stable.
  useEffect(() => {
    if (!initial.hasKey) return

    const requestId = requestModels(initial.provider, '', initial.baseUrl)
    return () => {
      if (modelRequestId.current === requestId) modelRequestId.current += 1
    }
  }, [initial.baseUrl, initial.hasKey, initial.provider, requestModels])

  const spec = specs.find((s) => s.value === provider) ?? specs[0]
  if (!spec) return null
  const showBaseUrl = spec.requiresBaseUrl || spec.baseUrl !== null
  const savedProvider = provider === initial.provider

  function invalidateModels() {
    modelRequestId.current += 1
    setModels([])
    setModelsError(null)
  }

  function onProviderChange(next: string) {
    invalidateModels()
    setProvider(next)
    // Carry saved values only when switching back to the saved provider.
    const isSaved = next === initial.provider
    setModelFast(isSaved ? initial.modelFast : '')
    setModelSmart(isSaved ? initial.modelSmart : '')
    setBaseUrl(isSaved ? initial.baseUrl : '')
    setManual(false)
  }

  const keyPlaceholder =
    initial.hasKey && savedProvider
      ? '•••••••••••• (saved — type to replace)'
      : spec.keyHint || 'Paste your provider API key'

  function modelOptions(value: string): SelectOption[] {
    const opts: SelectOption[] = models.map((m) => ({
      value: m.id,
      label: m.label ? `${m.label} — ${m.id}` : m.id,
    }))
    // Keep a saved/typed value selectable even if the live list lacks it.
    if (value && !models.some((m) => m.id === value)) {
      opts.unshift({ value, label: `${value} (current)` })
    }
    return opts
  }

  function modelField(opts: {
    name: string
    label: string
    hint: string
    value: string
    setValue: (v: string) => void
    placeholder: string
  }) {
    return (
      <div className="space-y-1.5">
        <Label>
          <GeneratedValue value={opts.label} />
          <GeneratedValue value={' '} />
          <span className="font-normal text-slate-400 dark:text-slate-500">
            (<GeneratedValue value={opts.hint} />)
          </span>
        </Label>
        <GeneratedValue
          value={
            manual ? (
              <Input
                name={opts.name}
                value={opts.value}
                onChange={(e) => opts.setValue(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={tGeneratedValue(opts.placeholder)}
              />
            ) : (
              <>
                <input type="hidden" name={opts.name} value={opts.value} />
                <SearchSelect
                  value={opts.value}
                  onChange={opts.setValue}
                  options={modelOptions(opts.value)}
                  disabled={!models.length && !opts.value}
                  clearable
                  emptyLabel={tGenerated('m_0f5935102b1557')}
                  placeholder={tGeneratedValue(
                    models.length ? tGenerated('m_1b12223f2489f8') : tGenerated('m_1210a7c1d86404'),
                  )}
                  sheetTitle={opts.label}
                  ariaLabel={opts.label}
                />
              </>
            )
          }
        />
      </div>
    )
  }

  return (
    <form action={action} className="space-y-5">
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={initial.enabled}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600"
        />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
          <GeneratedValue
            value={
              scope === 'platform' ? (
                <GeneratedText id="m_1d70faa3e3f8d7" />
              ) : (
                <GeneratedText id="m_1a28808a0e935a" />
              )
            }
          />
        </span>
      </label>

      <GeneratedValue
        value={
          scope === 'platform' ? (
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_08099822651b95" />
              </Label>
              <input type="hidden" name="mode" value={mode} />
              <SearchSelect
                value={mode}
                onChange={setMode}
                options={MODE_OPTIONS}
                sheetTitle="AI policy"
                ariaLabel="AI policy"
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={MODE_HELP[mode]} />
              </p>
            </div>
          ) : null
        }
      />

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_1c4d663fc7d77f" />
        </Label>
        <input type="hidden" name="provider" value={provider} />
        <SearchSelect
          value={provider}
          onChange={onProviderChange}
          options={specs.map((s) => ({ value: s.value, label: s.label }))}
          sheetTitle="Provider"
          ariaLabel="AI provider"
        />
      </div>

      <GeneratedValue
        value={
          showBaseUrl ? (
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_07585a641ed71e" />
                <GeneratedValue value={' '} />
                <span className="font-normal text-slate-400 dark:text-slate-500">
                  <GeneratedValue
                    value={
                      spec.requiresBaseUrl ? (
                        <GeneratedText id="m_10e150ecbb7cd1" />
                      ) : (
                        <GeneratedText id="m_1c91a7c43f1f5d" />
                      )
                    }
                  />
                </span>
              </Label>
              <Input
                name="baseUrl"
                value={baseUrl}
                onChange={(e) => {
                  invalidateModels()
                  setBaseUrl(e.target.value)
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder={tGeneratedValue(spec.baseUrl ?? 'https://your-endpoint/v1')}
              />
              <GeneratedValue
                value={
                  spec.baseUrl ? (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      <GeneratedText id="m_0889454d3fecc6" />{' '}
                      <GeneratedValue value={spec.baseUrl} />
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      <GeneratedText id="m_1cb94938c5c3bb" />
                    </p>
                  )
                }
              />
            </div>
          ) : (
            <input type="hidden" name="baseUrl" value="" />
          )
        }
      />

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_04689ff1b29440" />
        </Label>
        <Input
          type="password"
          name="apiKey"
          value={apiKey}
          onChange={(e) => {
            invalidateModels()
            setApiKey(e.target.value)
          }}
          autoComplete="off"
          placeholder={tGeneratedValue(keyPlaceholder)}
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          <GeneratedValue
            value={
              initial.hasKey && savedProvider ? (
                <GeneratedText id="m_0a7e9f655c3e2c" />
              ) : (
                <GeneratedText id="m_0ae8c197586ac1" />
              )
            }
          />
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>
            <GeneratedText id="m_0dd2fff8805856" />
          </Label>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => setManual((m) => !m)}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            >
              <GeneratedValue
                value={
                  manual ? (
                    <GeneratedText id="m_131965c9346832" />
                  ) : (
                    <GeneratedText id="m_01a2ee1bbf5c87" />
                  )
                }
              />
            </button>
            <button
              type="button"
              onClick={() => requestModels(provider, apiKey, baseUrl)}
              disabled={loading}
              className="inline-flex items-center gap-1 font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              <GeneratedValue
                value={
                  loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />
                }
              />
              <GeneratedValue
                value={
                  loading ? (
                    <GeneratedText id="m_0e65697ec32c03" />
                  ) : models.length ? (
                    <GeneratedText id="m_19e1952e7364a8" />
                  ) : (
                    <GeneratedText id="m_08abcaeca1ff27" />
                  )
                }
              />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <GeneratedValue
            value={modelField({
              name: 'modelFast',
              label: 'Fast model',
              hint: 'tagging, writing',
              value: modelFast,
              setValue: setModelFast,
              placeholder: spec.fast || 'model id',
            })}
          />
          <GeneratedValue
            value={modelField({
              name: 'modelSmart',
              label: 'Smart model',
              hint: 'vision, digests',
              value: modelSmart,
              setValue: setModelSmart,
              placeholder: spec.smart || 'model id',
            })}
          />
        </div>
        <GeneratedValue
          value={
            modelsError ? (
              <p className="text-xs text-amber-600">
                <GeneratedValue value={modelsError} />
              </p>
            ) : models.length ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={models.length} /> <GeneratedText id="m_119eaa2a4434bd" />
              </p>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={spec.modelHint ?? <GeneratedText id="m_1e41de6281bb81" />} />
              </p>
            )
          }
        />
      </div>

      <GeneratedValue
        value={
          scope === 'tenant' ? (
            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Label>
                <GeneratedText id="m_120a984c132bbd" />
              </Label>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  name="autoJournalAi"
                  defaultChecked={initial.autoJournalAi}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600"
                />
                <span className="text-sm">
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    <GeneratedText id="m_1886e2abfd0fe4" />
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
                    <GeneratedText id="m_072ae7317f8bd3" />
                  </span>
                </span>
              </label>
            </div>
          ) : null
        }
      />

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button type="submit">
          <GeneratedValue
            value={
              scope === 'platform' ? (
                <GeneratedText id="m_0a4c30207453ef" />
              ) : (
                <GeneratedText id="m_1706a5daf4809d" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
