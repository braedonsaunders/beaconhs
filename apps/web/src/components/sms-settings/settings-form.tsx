'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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

type SmsFormInitial = {
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [provider, setProvider] = useState(initial.provider)
  const [mode, setMode] = useState(initial.mode ?? 'tenant_optional')
  const platformLive = scope === 'platform' && mode !== 'disabled'
  const requiresCompleteProvider = scope === 'platform' ? platformLive : enabled

  const spec = specs.find((s) => s.value === provider) ?? specs[0]
  if (!spec) return null
  const savedProvider = provider === initial.provider
  const savedProviderLabel =
    specs.find((candidate) => candidate.value === initial.provider)?.label ?? initial.provider
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
      <GeneratedValue
        value={platformLive ? <input type="hidden" name="enabled" value="on" /> : null}
      />
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          name={platformLive ? undefined : 'enabled'}
          checked={platformLive || enabled}
          disabled={platformLive}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600"
        />
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
          <GeneratedValue
            value={
              scope === 'platform' ? (
                <GeneratedText id="m_1d70faa3e3f8d7" />
              ) : (
                <GeneratedText id="m_037bad42cae534" />
              )
            }
          />
        </span>
      </label>
      <p className="-mt-3 text-xs text-slate-500 dark:text-slate-400">
        <GeneratedValue
          value={
            scope === 'tenant' ? (
              <GeneratedText id="m_0f6caa4a185b84" />
            ) : platformLive ? (
              <GeneratedText id="m_19bff16f744f4a" />
            ) : (
              <GeneratedText id="m_0ef26ce5b4af98" />
            )
          }
        />
      </p>

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
                sheetTitle="SMS policy"
                ariaLabel="SMS policy"
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
          onChange={setProvider}
          options={specs.map((s) => ({ value: s.value, label: s.label }))}
          sheetTitle="Provider"
          ariaLabel="SMS provider"
        />
        <GeneratedValue
          value={
            spec.docsHint ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={spec.docsHint} />
              </p>
            ) : null
          }
        />
        <GeneratedValue
          value={
            !savedProvider ? (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                <GeneratedText id="m_19d5d48924fdd1" />{' '}
                <GeneratedValue value={savedProviderLabel} />{' '}
                <GeneratedText id="m_118afa0cf3ded9" /> <GeneratedValue value={spec.label} />
                <GeneratedText id="m_1f001f6567634c" />{' '}
                <GeneratedValue value={spec.secretLabel.toLowerCase()} />{' '}
                <GeneratedText id="m_1620d746efaf5b" />
              </p>
            ) : null
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_16fdb55061a3f3" />{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            <GeneratedText id="m_10e150ecbb7cd1" />
          </span>
        </Label>
        <Input
          name="fromNumber"
          required={requiresCompleteProvider}
          maxLength={100}
          defaultValue={initial.fromNumber}
          placeholder={tGenerated('m_14861c48560658')}
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_00e5ec7a26407e" />
        </p>
      </div>

      <GeneratedValue
        value={
          spec.hasSecret ? (
            <div className="space-y-1.5">
              <Label>
                <GeneratedValue value={spec.secretLabel} />
                <GeneratedValue
                  value={
                    spec.secretRequired ? null : (
                      <span className="font-normal text-slate-400 dark:text-slate-500">
                        {' '}
                        <GeneratedText id="m_1f61ed87b795bd" />
                      </span>
                    )
                  }
                />
              </Label>
              <Input
                key={provider}
                type="password"
                name="secret"
                autoComplete="off"
                maxLength={4096}
                required={
                  requiresCompleteProvider &&
                  spec.secretRequired &&
                  !(initial.hasKey && savedProvider)
                }
                placeholder={tGeneratedValue(keyPlaceholder)}
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue
                  value={
                    initial.hasKey && savedProvider ? (
                      <GeneratedText id="m_09b10f4c97f05c" />
                    ) : !savedProvider ? (
                      <GeneratedText
                        id="m_0649953f1efff8"
                        values={{ value0: spec.secretLabel.toLowerCase(), value1: spec.label }}
                      />
                    ) : (
                      <GeneratedText id="m_0ae8c197586ac1" />
                    )
                  }
                />
              </p>
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          spec.fields.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <GeneratedValue
                value={spec.fields.map((f) => {
                  if (f.kind === 'boolean') {
                    return (
                      <label key={f.key} className="flex items-center gap-2.5 sm:col-span-2">
                        <input
                          type="checkbox"
                          name={f.key}
                          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-600"
                        />
                        <span className="text-sm text-slate-800 dark:text-slate-100">
                          <GeneratedValue value={f.label} />
                        </span>
                      </label>
                    )
                  }
                  if (f.kind === 'select') {
                    return (
                      <div key={f.key} className="space-y-1.5">
                        <Label>
                          <GeneratedValue value={f.label} />
                        </Label>
                        <Select
                          name={f.key}
                          defaultValue={initialField(f.key) || f.options?.[0]?.value}
                          aria-label={tGeneratedValue(f.label)}
                          sheetTitle={f.label}
                        >
                          <GeneratedValue
                            value={f.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                <GeneratedValue value={o.label} />
                              </option>
                            ))}
                          />
                        </Select>
                      </div>
                    )
                  }
                  return (
                    <div key={f.key} className="space-y-1.5">
                      <Label>
                        <GeneratedValue value={f.label} />
                        <GeneratedValue
                          value={
                            f.required ? null : (
                              <span className="font-normal text-slate-400 dark:text-slate-500">
                                <GeneratedValue value={' '} />
                                <GeneratedText id="m_1f61ed87b795bd" />
                              </span>
                            )
                          }
                        />
                      </Label>
                      <Input
                        name={f.key}
                        type={f.kind === 'number' ? 'number' : 'text'}
                        required={requiresCompleteProvider && Boolean(f.required)}
                        maxLength={f.kind === 'text' ? 320 : undefined}
                        defaultValue={initialField(f.key)}
                        placeholder={tGeneratedValue(f.placeholder)}
                      />
                      <GeneratedValue
                        value={
                          f.help ? (
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                              <GeneratedValue value={f.help} />
                            </p>
                          ) : null
                        }
                      />
                    </div>
                  )
                })}
              />
            </div>
          ) : null
        }
      />

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <Button type="submit">
          <GeneratedValue
            value={
              scope === 'platform' ? (
                <GeneratedText id="m_112e98248f9a89" />
              ) : (
                <GeneratedText id="m_17396d9260fd60" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
