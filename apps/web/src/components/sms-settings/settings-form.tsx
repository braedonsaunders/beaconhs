'use client'

import { useState } from 'react'
import { Button, Input, Label, SearchSelect, Select } from '@beaconhs/ui'

// Serializable slice of an SMS provider spec (no Node code in the client bundle).
export type SmsProviderSpecLite = {
  value: string
  label: string
  hasSecret: boolean
  secretLabel: string
  keyHint: string
  secretRequired: boolean
  fields: {
    key: string
    kind: 'text' | 'number' | 'boolean' | 'select'
    label: string
    placeholder?: string
    required?: boolean
    options?: { value: string; label: string }[]
    help?: string
  }[]
  docsHint?: string
}

export type SmsFormInitial = {
  enabled: boolean
  provider: string
  fromNumber: string
  twilioAccountSid: string
  vonageApiKey: string
  plivoAuthId: string
  telnyxMessagingProfileId: string
  hasKey: boolean
  mode?: string
}

const MODE_OPTIONS = [
  { value: 'tenant_optional', label: 'Tenants choose their own (recommended)' },
  { value: 'global_only', label: 'Force the platform default for all tenants' },
  { value: 'disabled', label: 'Disable all SMS (kill switch)' },
]

const MODE_HELP: Record<string, string> = {
  tenant_optional:
    'Each tenant may configure its own provider below. Tenants with none fall back to this platform default.',
  global_only:
    'Every tenant sends through this platform default. Per-tenant provider settings are ignored.',
  disabled:
    'No SMS is sent for any tenant. Queued messages are logged as suppressed, not delivered.',
}

// Reactive SMS settings form. The provider selector drives the secret label and
// the provider-specific fields. Reused for the per-tenant and the platform
// (super-admin) scope — the platform scope adds the policy selector.
export function SmsSettingsForm({
  action,
  specs,
  initial,
  scope,
}: {
  action: (formData: FormData) => void | Promise<void>
  specs: SmsProviderSpecLite[]
  initial: SmsFormInitial
  scope: 'tenant' | 'platform'
}) {
  const [provider, setProvider] = useState(initial.provider)
  const [mode, setMode] = useState(initial.mode ?? 'tenant_optional')

  const spec = specs.find((s) => s.value === provider) ?? specs[0]
  if (!spec) return null
  const savedProvider = provider === initial.provider
  const keyPlaceholder =
    initial.hasKey && savedProvider
      ? '•••••••••••• (saved — type to replace)'
      : spec.keyHint || 'Paste the provider credential'

  function initialField(key: string): string {
    switch (key) {
      case 'twilioAccountSid':
        return initial.twilioAccountSid
      case 'vonageApiKey':
        return initial.vonageApiKey
      case 'plivoAuthId':
        return initial.plivoAuthId
      case 'telnyxMessagingProfileId':
        return initial.telnyxMessagingProfileId
      default:
        return ''
    }
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
          {scope === 'platform'
            ? 'Enable the platform default provider'
            : 'Enable SMS sending for this tenant'}
        </span>
      </label>

      {scope === 'platform' ? (
        <div className="space-y-1.5">
          <Label>Policy</Label>
          <input type="hidden" name="mode" value={mode} />
          <SearchSelect
            value={mode}
            onChange={setMode}
            options={MODE_OPTIONS}
            sheetTitle="SMS policy"
            ariaLabel="SMS policy"
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">{MODE_HELP[mode]}</p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Provider</Label>
        <input type="hidden" name="provider" value={provider} />
        <SearchSelect
          value={provider}
          onChange={setProvider}
          options={specs.map((s) => ({ value: s.value, label: s.label }))}
          sheetTitle="Provider"
          ariaLabel="SMS provider"
        />
        {spec.docsHint ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">{spec.docsHint}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label>
          Sender <span className="font-normal text-slate-400 dark:text-slate-500">(required)</span>
        </Label>
        <Input
          name="fromNumber"
          defaultValue={initial.fromNumber}
          placeholder="+15551234567 or a sender ID"
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          A phone number in E.164 format, or an alphanumeric sender ID where your provider and
          destination country allow it.
        </p>
      </div>

      {spec.hasSecret ? (
        <div className="space-y-1.5">
          <Label>
            {spec.secretLabel}
            {spec.secretRequired ? null : (
              <span className="font-normal text-slate-400 dark:text-slate-500"> (optional)</span>
            )}
          </Label>
          <Input type="password" name="secret" autoComplete="off" placeholder={keyPlaceholder} />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {initial.hasKey && savedProvider
              ? 'A credential is stored, encrypted (AES-256-GCM). Leave blank to keep the existing one.'
              : 'Stored encrypted with a key derived from the app secret — never written to env or shown again.'}
          </p>
        </div>
      ) : null}

      {spec.fields.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {spec.fields.map((f) => {
            if (f.kind === 'boolean') {
              return (
                <label key={f.key} className="flex items-center gap-2.5 sm:col-span-2">
                  <input
                    type="checkbox"
                    name={f.key}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600"
                  />
                  <span className="text-sm text-slate-800 dark:text-slate-100">{f.label}</span>
                </label>
              )
            }
            if (f.kind === 'select') {
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label}</Label>
                  <Select
                    name={f.key}
                    defaultValue={initialField(f.key) || f.options?.[0]?.value}
                    aria-label={f.label}
                    sheetTitle={f.label}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )
            }
            return (
              <div key={f.key} className="space-y-1.5">
                <Label>
                  {f.label}
                  {f.required ? null : (
                    <span className="font-normal text-slate-400 dark:text-slate-500">
                      {' '}
                      (optional)
                    </span>
                  )}
                </Label>
                <Input
                  name={f.key}
                  type={f.kind === 'number' ? 'number' : 'text'}
                  defaultValue={initialField(f.key)}
                  placeholder={f.placeholder}
                />
                {f.help ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500">{f.help}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button type="submit">
          {scope === 'platform' ? 'Save platform SMS' : 'Save SMS settings'}
        </Button>
      </div>
    </form>
  )
}
