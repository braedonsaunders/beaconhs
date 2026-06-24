'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button, Input, Label, SearchSelect, type SelectOption } from '@beaconhs/ui'
import { listAiModels } from './_actions'

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

type Initial = {
  enabled: boolean
  provider: string
  modelFast: string
  modelSmart: string
  baseUrl: string
  hasKey: boolean
  autoJournalAi: boolean
}

// Reactive AI settings form: the provider selector drives the base-URL field,
// the API-key hint and the model dropdowns. The model lists are fetched live
// from the provider's API (via the listAiModels action). Submits via saveAiSettings.
export function AiSettingsForm({
  action,
  specs,
  initial,
}: {
  action: (formData: FormData) => void | Promise<void>
  specs: ProviderSpecLite[]
  initial: Initial
}) {
  const [provider, setProvider] = useState(initial.provider)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [modelFast, setModelFast] = useState(initial.modelFast)
  const [modelSmart, setModelSmart] = useState(initial.modelSmart)

  const [models, setModels] = useState<{ id: string; label?: string }[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [loading, startLoad] = useTransition()

  // Auto-load the saved provider's models on first render (a key is on file).
  // Must run before any early return so the hook order stays stable.
  useEffect(() => {
    if (initial.hasKey && initial.provider === provider) loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const spec = specs.find((s) => s.value === provider) ?? specs[0]
  if (!spec) return null
  const showBaseUrl = spec.requiresBaseUrl || spec.baseUrl !== null
  const savedProvider = provider === initial.provider

  function loadModels(p = provider, key = apiKey, base = baseUrl) {
    startLoad(async () => {
      const r = await listAiModels({ provider: p, baseUrl: base, apiKey: key })
      if (r.ok) {
        setModels(r.models)
        setModelsError(null)
      } else {
        setModels([])
        setModelsError(r.message ?? 'Could not load models.')
      }
    })
  }

  function onProviderChange(next: string) {
    setProvider(next)
    // Carry saved values only when switching back to the saved provider.
    const isSaved = next === initial.provider
    setModelFast(isSaved ? initial.modelFast : '')
    setModelSmart(isSaved ? initial.modelSmart : '')
    setBaseUrl(isSaved ? initial.baseUrl : '')
    setModels([])
    setModelsError(null)
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
          {opts.label}{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">({opts.hint})</span>
        </Label>
        {manual ? (
          <Input
            name={opts.name}
            value={opts.value}
            onChange={(e) => opts.setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={opts.placeholder}
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
              emptyLabel="Provider default"
              placeholder={models.length ? 'Choose a model' : 'Load models to choose'}
              sheetTitle={opts.label}
              ariaLabel={opts.label}
            />
          </>
        )}
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
          Enable AI features for this tenant
        </span>
      </label>

      <div className="space-y-1.5">
        <Label>Provider</Label>
        <input type="hidden" name="provider" value={provider} />
        <SearchSelect
          value={provider}
          onChange={onProviderChange}
          options={specs.map((s) => ({ value: s.value, label: s.label }))}
          sheetTitle="Provider"
          ariaLabel="AI provider"
        />
      </div>

      {showBaseUrl ? (
        <div className="space-y-1.5">
          <Label>
            Base URL{' '}
            <span className="font-normal text-slate-400 dark:text-slate-500">
              {spec.requiresBaseUrl ? '(required)' : '(optional override)'}
            </span>
          </Label>
          <Input
            name="baseUrl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={spec.baseUrl ?? 'https://your-endpoint/v1'}
          />
          {spec.baseUrl ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Leave blank to use {spec.baseUrl}
            </p>
          ) : null}
        </div>
      ) : (
        <input type="hidden" name="baseUrl" value="" />
      )}

      <div className="space-y-1.5">
        <Label>API key</Label>
        <Input
          type="password"
          name="apiKey"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          placeholder={keyPlaceholder}
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {initial.hasKey && savedProvider
            ? 'A key is stored, encrypted (AES-256-GCM). Leave blank to keep the existing one.'
            : 'Stored encrypted with a key derived from the app secret — never written to env or shown again.'}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Models</Label>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => setManual((m) => !m)}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            >
              {manual ? 'Choose from list' : 'Enter manually'}
            </button>
            <button
              type="button"
              onClick={() => loadModels()}
              disabled={loading}
              className="inline-flex items-center gap-1 font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {loading ? 'Loading…' : models.length ? 'Reload' : 'Load models'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {modelField({
            name: 'modelFast',
            label: 'Fast model',
            hint: 'tagging, writing',
            value: modelFast,
            setValue: setModelFast,
            placeholder: spec.fast || 'model id',
          })}
          {modelField({
            name: 'modelSmart',
            label: 'Smart model',
            hint: 'vision, digests',
            value: modelSmart,
            setValue: setModelSmart,
            placeholder: spec.smart || 'model id',
          })}
        </div>
        {modelsError ? (
          <p className="text-xs text-amber-600">{modelsError}</p>
        ) : models.length ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {models.length} models available. Leave a field on “Provider default” to use the
            built-in default. The smart model handles photo captions — pick a vision-capable one.
          </p>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {spec.modelHint ?? 'Load this provider’s models from its API, or enter ids manually.'}
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Label>Automation</Label>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            name="autoJournalAi"
            defaultChecked={initial.autoJournalAi}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-800 dark:text-slate-100">
              Auto-summarise &amp; tag journals
            </span>
            <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
              When a journal is submitted, generate a short summary and suggested tags in the
              background. Keeps logs categorised without workers doing it themselves. Requires a
              key.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button type="submit">Save AI settings</Button>
      </div>
    </form>
  )
}
