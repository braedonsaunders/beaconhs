'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { Check, Copy, Home } from 'lucide-react'
import { Button, Input, Label } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import type { PickerOption } from '@/lib/picker-options'
import { saveStationSettings } from './_actions'
import type { StationSettingsInput } from './_policy'

type StationSettingsInitial = Omit<StationSettingsInput, 'stationPin' | 'clearStationPin'> & {
  stationPinConfigured: boolean
}

export function StationSettingsForm({
  initial,
  initialHomeOption,
  kioskUrl,
}: {
  initial: StationSettingsInitial
  initialHomeOption?: PickerOption
  kioskUrl: string | null
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [home, setHome] = useState(initial.defaultCheckInOrgUnitId ?? '')
  const [pin, setPin] = useState('')
  const [clearStationPin, setClearStationPin] = useState(false)
  const [scanMode, setScanMode] = useState<'toggle' | 'explicit'>(initial.scanMode)
  const [requireHolder, setRequireHolder] = useState(initial.requireHolderOnCheckout)
  const [requireCondition, setRequireCondition] = useState(initial.requireConditionOnCheckin)
  const [soundEnabled, setSoundEnabled] = useState(initial.soundEnabled)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function save() {
    setMsg(null)
    start(async () => {
      const res = await saveStationSettings({
        defaultCheckInOrgUnitId: home || null,
        stationPin: pin || null,
        clearStationPin,
        scanMode,
        requireHolderOnCheckout: requireHolder,
        requireConditionOnCheckin: requireCondition,
        soundEnabled,
      })
      setMsg(res.ok ? { tone: 'ok', text: 'Saved.' } : { tone: 'err', text: res.error })
    })
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Home / default check-in location */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Home size={16} className="text-teal-600 dark:text-teal-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_049d9d011b9942" />
          </h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_007b3e0b9b7c97" />
        </p>
        <RemoteSearchSelect
          lookup="equipment-station-locations"
          value={home}
          onChange={setHome}
          initialOption={initialHomeOption}
          clearable
          emptyLabel={tGenerated('m_19cb3d08d7cf8b')}
          placeholder={tGenerated('m_14aeba10d556b5')}
          searchPlaceholder={tGenerated('m_016e087c3c8544')}
          sheetTitle="Default check-in location"
          ariaLabel="Default check-in location"
          className="max-w-md"
        />
      </section>

      {/* Scan behaviour */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_1e97c9ab23cc2d" />
        </h3>
        <div className="grid max-w-md grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <GeneratedValue
            value={(['toggle', 'explicit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setScanMode(m)}
                className={`rounded-md px-3 py-2 text-sm font-medium capitalize transition ${
                  scanMode === m
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <GeneratedValue
                  value={
                    m === 'toggle' ? (
                      <GeneratedText id="m_1f98e7eab04a3d" />
                    ) : (
                      <GeneratedText id="m_00a813c1ca48d4" />
                    )
                  }
                />
              </button>
            ))}
          />
        </div>
        <div className="space-y-2 pt-1">
          <Toggle
            label={tGenerated('m_0e667dd8a56846')}
            desc="Block check-out until a person is scanned or picked."
            checked={requireHolder}
            onChange={setRequireHolder}
          />
          <Toggle
            label={tGenerated('m_0bdc9a28c3013b')}
            desc="Ask Good / Fair / Damaged / Unusable when returning an asset."
            checked={requireCondition}
            onChange={setRequireCondition}
          />
          <Toggle
            label={tGenerated('m_1beb7dd6af7a8d')}
            desc="Audible beep + flash so operators can work eyes-free."
            checked={soundEnabled}
            onChange={setSoundEnabled}
          />
        </div>
      </section>

      {/* Kiosk */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_0988097ceb2746" />
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_11193a89242a4d" />
        </p>
        <div className="max-w-xs">
          <Label>
            <GeneratedText id="m_0e96149e81856f" />
          </Label>
          <Input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            maxLength={12}
            disabled={clearStationPin}
            placeholder={tGeneratedValue(
              initial.stationPinConfigured
                ? tGenerated('m_12dd8958f18f7a')
                : tGenerated('m_1de6858bd89c4a'),
            )}
            className="mt-1 font-mono tracking-widest"
          />
          <GeneratedValue
            value={
              initial.stationPinConfigured ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_189f9884586904" />
                </p>
              ) : null
            }
          />
        </div>
        <GeneratedValue
          value={
            initial.stationPinConfigured ? (
              <label className="flex max-w-xs items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={clearStationPin}
                  onChange={(e) => {
                    setClearStationPin(e.target.checked)
                    if (e.target.checked) setPin('')
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <GeneratedText id="m_188bd80b585de1" />
              </label>
            ) : null
          }
        />
        <GeneratedValue
          value={
            kioskUrl ? (
              <div className="flex max-w-xl items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                  {kioskUrl}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(kioskUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10"
                >
                  <GeneratedValue value={copied ? <Check size={13} /> : <Copy size={13} />} />
                  <GeneratedValue
                    value={
                      copied ? (
                        <GeneratedText id="m_0b5b9f2cb83b35" />
                      ) : (
                        <GeneratedText id="m_17e5ebd91b9a4f" />
                      )
                    }
                  />
                </button>
              </div>
            ) : null
          }
        />
      </section>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button onClick={save} disabled={pending}>
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_106811f2aac664" />
              ) : (
                <GeneratedText id="m_0bdcc953ae29cd" />
              )
            }
          />
        </Button>
        <GeneratedValue
          value={
            msg ? (
              <span
                className={`text-sm ${
                  msg.tone === 'ok'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                <GeneratedValue value={msg.text} />
              </span>
            ) : null
          }
        />
      </div>
    </div>
  )
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex max-w-xl cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
          <GeneratedValue value={label} />
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue value={desc} />
        </span>
      </span>
    </label>
  )
}
