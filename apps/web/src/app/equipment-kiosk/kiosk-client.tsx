'use client'

import { useState, useTransition } from 'react'
import { ScanLine } from 'lucide-react'
import { StationClient } from '@/app/(app)/equipment/station/_station-client'
import { performKioskScan, searchKioskScan } from './actions'

type Person = { id: string; name: string; employeeNo: string | null; jobTitle: string | null }
type Location = { id: string; name: string; level: string; isBase: boolean }

export function EquipmentKioskClient(props: {
  tenantId: string
  tenantName: string
  scanMode: 'toggle' | 'explicit'
  soundEnabled: boolean
  requireConditionOnCheckin: boolean
  homeLocationName: string | null
  people: Person[]
  locations: Location[]
  availableCount: number
}) {
  const { tenantId } = props
  const [pin, setPin] = useState<string | null>(null)
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
      // An empty-query search verifies the PIN server-side without mutating.
      const res = await searchKioskScan({ tenantId, pin: candidate, query: '' })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setPin(candidate)
      setPinInput('')
    })
  }

  if (!pin) {
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
      scanMode={props.scanMode}
      soundEnabled={props.soundEnabled}
      requireConditionOnCheckin={props.requireConditionOnCheckin}
      homeLocationName={props.homeLocationName}
      people={props.people}
      locations={props.locations}
      availableCount={props.availableCount}
      onSearch={async (query) => {
        const r = await searchKioskScan({ tenantId, pin, query })
        return r.ok ? r.results : { equipment: [], people: [] }
      }}
      onScan={(input) => performKioskScan({ ...input, tenantId, pin, deviceLabel })}
      onAuthError={() => setPin(null)}
      onExit={() => setPin(null)}
    />
  )
}
