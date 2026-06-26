'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Copy, Home, Search } from 'lucide-react'
import { Button, Input, Label, SearchSelect } from '@beaconhs/ui'
import { saveStationSettings, type StationSettingsInput } from './_actions'

type Location = { id: string; name: string; level: string }
type StationSettingsInitial = Omit<StationSettingsInput, 'stationPin' | 'clearStationPin'> & {
  stationPinConfigured: boolean
}

export function StationSettingsForm({
  locations,
  initial,
  kioskUrl,
}: {
  locations: Location[]
  initial: StationSettingsInitial
  kioskUrl: string | null
}) {
  const [home, setHome] = useState(initial.defaultCheckInOrgUnitId ?? '')
  const [pin, setPin] = useState('')
  const [clearStationPin, setClearStationPin] = useState(false)
  const [scanMode, setScanMode] = useState<'toggle' | 'explicit'>(initial.scanMode)
  const [requireHolder, setRequireHolder] = useState(initial.requireHolderOnCheckout)
  const [requireCondition, setRequireCondition] = useState(initial.requireConditionOnCheckin)
  const [soundEnabled, setSoundEnabled] = useState(initial.soundEnabled)
  const [baseIds, setBaseIds] = useState<Set<string>>(new Set(initial.baseLocationIds))
  const [filter, setFilter] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const locationOptions = useMemo(
    () => locations.map((l) => ({ value: l.id, label: l.name, hint: l.level })),
    [locations],
  )
  const filteredLocations = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? locations.filter((l) => l.name.toLowerCase().includes(q)) : locations
  }, [filter, locations])

  function toggleBase(id: string) {
    setBaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        baseLocationIds: Array.from(baseIds),
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
            Default check-in location
          </h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Where assets return to on check-in. Operators never pick this — every check-in snaps the
          asset back here automatically.
        </p>
        <SearchSelect
          value={home}
          onChange={setHome}
          options={locationOptions}
          clearable
          emptyLabel="— No default —"
          placeholder="Select a location…"
          className="max-w-md"
        />
      </section>

      {/* Base locations */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Locations that count as “checked in”
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Assets sitting at any of these — your shop, yard or crib — are reported as at base / in
          stock. Everywhere else counts as deployed.
        </p>
        <div className="relative max-w-md">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter locations…"
            className="pl-9"
          />
        </div>
        <div className="max-h-72 max-w-md divide-y overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {filteredLocations.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-400">No locations match.</div>
          ) : (
            filteredLocations.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <input
                  type="checkbox"
                  checked={baseIds.has(l.id)}
                  onChange={() => toggleBase(l.id)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="font-medium text-slate-800 dark:text-slate-200">{l.name}</span>
                <span className="ml-auto text-xs text-slate-400">{l.level}</span>
              </label>
            ))
          )}
        </div>
      </section>

      {/* Scan behaviour */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Scan behaviour</h3>
        <div className="grid max-w-md grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['toggle', 'explicit'] as const).map((m) => (
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
              {m === 'toggle' ? 'Toggle (one scan flips)' : 'Explicit in/out'}
            </button>
          ))}
        </div>
        <div className="space-y-2 pt-1">
          <Toggle
            label="Require a holder before check-out"
            desc="Block check-out until a person is scanned or picked."
            checked={requireHolder}
            onChange={setRequireHolder}
          />
          <Toggle
            label="Prompt for condition on check-in"
            desc="Ask Good / Fair / Damaged / Unusable when returning an asset."
            checked={requireCondition}
            onChange={setRequireCondition}
          />
          <Toggle
            label="Sound on scan"
            desc="Audible beep + flash so operators can work eyes-free."
            checked={soundEnabled}
            onChange={setSoundEnabled}
          />
        </div>
      </section>

      {/* Kiosk */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Mounted-tablet kiosk
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Set a PIN to enable the public kiosk for a wall-mounted tablet + USB scanner. The in-app
          station is always available to permitted users.
        </p>
        <div className="max-w-xs">
          <Label>Kiosk PIN (4–12 digits)</Label>
          <Input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            disabled={clearStationPin}
            placeholder={
              initial.stationPinConfigured ? 'Leave blank to keep current PIN' : 'e.g. 4821'
            }
            className="mt-1 font-mono tracking-widest"
          />
          {initial.stationPinConfigured ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              A PIN is configured. Enter a new PIN to rotate it.
            </p>
          ) : null}
        </div>
        {initial.stationPinConfigured ? (
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
            Disable public equipment kiosk
          </label>
        ) : null}
        {kioskUrl ? (
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
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : null}
      </section>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        {msg ? (
          <span
            className={`text-sm ${
              msg.tone === 'ok'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {msg.text}
          </span>
        ) : null}
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
          {label}
        </span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{desc}</span>
      </span>
    </label>
  )
}
