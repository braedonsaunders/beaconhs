'use client'

import { useState, useTransition } from 'react'
import { ScanLine } from 'lucide-react'
import { StationClient } from '@/app/(app)/equipment/station/_station-client'
import {
  performKioskScan,
  searchKioskScan,
  unlockEquipmentKiosk,
  type EquipmentKioskConfig,
} from './actions'

type Person = { id: string; name: string; employeeNo: string | null; jobTitle: string | null }
type Location = { id: string; name: string; level: string; isBase: boolean }

export function EquipmentKioskClient(props: { tenantId: string; tenantName: string }) {
  const { tenantId } = props
  const [pin, setPin] = useState<string | null>(null)
  const [config, setConfig] = useState<EquipmentKioskConfig | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function unlock(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const candidate = pinInput.trim()
    if (!candidate) {
      setError('Enter the kiosk PIN to continue')
      return
    }
    start(async () => {
      const res = await unlockEquipmentKiosk({ tenantId, pin: candidate })
      if (!res.ok) {
        setError(res.error)
        setConfig(null)
        return
      }
      setConfig(res.config)
      setPin(candidate)
      setPinInput('')
    })
  }

  if (!pin || !config) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <form
          onSubmit={unlock}
          className="w-full max-w-sm space-y-4 rounded-2xl bg-slate-900 p-8 shadow-2xl"
        >
          <header className="text-center">
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-amber-500/15 text-amber-300">
              <ScanLine size={24} />
            </div>
            <h1 className="text-xl font-semibold">{props.tenantName}</h1>
            <p className="text-sm text-slate-400">Equipment kiosk · enter PIN to unlock</p>
          </header>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="PIN"
            className="w-full rounded-lg border-0 bg-slate-950 px-4 py-3 text-center text-2xl tracking-widest text-white placeholder-slate-500 focus:ring-2 focus:ring-amber-500 focus:outline-none"
          />
          {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-amber-500 px-4 py-3 text-base font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
          >
            {pending ? 'Checking…' : 'Unlock kiosk'}
          </button>
        </form>
      </div>
    )
  }

  const deviceLabel = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : null

  return (
    <StationClient
      surface="kiosk"
      tenantName={props.tenantName}
      scanMode={config.scanMode}
      soundEnabled={config.soundEnabled}
      requireConditionOnCheckin={config.requireConditionOnCheckin}
      homeLocationName={config.homeLocationName}
      people={config.people}
      locations={config.locations}
      availableCount={config.availableCount}
      onSearch={async (query) => {
        const r = await searchKioskScan({ tenantId, pin, query })
        if (!r.ok) {
          // A revoked/rotated PIN detected during search re-locks the kiosk,
          // matching how scans handle auth failures. Other errors (e.g. rate
          // limiting) resolve to no matches rather than a dead search box.
          if (/pin/i.test(r.error)) {
            setPin(null)
            setConfig(null)
          }
          return { equipment: [], people: [] }
        }
        return r.results
      }}
      onScan={(input) => performKioskScan({ ...input, tenantId, pin, deviceLabel })}
      onAuthError={() => {
        setPin(null)
        setConfig(null)
      }}
      onExit={() => {
        setPin(null)
        setConfig(null)
      }}
    />
  )
}
