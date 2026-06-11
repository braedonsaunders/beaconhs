'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowLeft, CheckCircle2, LogIn, LogOut, Search, X } from 'lucide-react'
import { recordKioskScan } from './actions'

type Person = { id: string; firstName: string; lastName: string; jobTitle: string | null }
type Site = { id: string; name: string }
type Crew = { id: string; name: string }

type Stage =
  | { kind: 'pin' }
  | { kind: 'pick'; pin: string }
  | { kind: 'sign'; pin: string; person: Person }
  | { kind: 'done'; pin: string; person: Person; scanKind: 'in' | 'out'; at: Date }

export function KioskClient({
  tenantId,
  tenantName,
  people,
  sites,
  crews,
}: {
  tenantId: string
  tenantName: string
  people: Person[]
  sites: Site[]
  crews: Crew[]
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'pin' })
  const [pinInput, setPinInput] = useState('')
  const [query, setQuery] = useState('')
  const [siteId, setSiteId] = useState<string>('')
  const [crewId, setCrewId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people.slice(0, 50)
    return people
      .filter(
        (p) =>
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
          (p.jobTitle ?? '').toLowerCase().includes(q),
      )
      .slice(0, 50)
  }, [query, people])

  function submitPin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!pinInput.trim()) {
      setError('Enter the kiosk PIN to continue')
      return
    }
    setStage({ kind: 'pick', pin: pinInput.trim() })
  }

  function pickPerson(person: Person) {
    if (stage.kind !== 'pick') return
    setStage({ kind: 'sign', pin: stage.pin, person })
  }

  function sign(scanKind: 'in' | 'out') {
    if (stage.kind !== 'sign') return
    setError(null)
    const pin = stage.pin
    const person = stage.person
    start(async () => {
      const result = await recordKioskScan({
        tenantId,
        personId: person.id,
        kind: scanKind,
        siteOrgUnitId: siteId || null,
        crewId: crewId || null,
        deviceLabel: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : null,
        pin,
      })
      if (!result.ok) {
        setError(result.error)
        if (result.error === 'Invalid PIN' || result.error.includes('PIN')) {
          setStage({ kind: 'pin' })
          setPinInput('')
        }
        return
      }
      setStage({ kind: 'done', pin, person, scanKind, at: new Date() })
      setTimeout(() => {
        setStage({ kind: 'pick', pin })
        setQuery('')
      }, 4000)
    })
  }

  // ---------------- PIN gate ----------------
  if (stage.kind === 'pin') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900 p-6 text-white">
        <form
          onSubmit={submitPin}
          className="w-full max-w-sm space-y-4 rounded-2xl bg-slate-800 p-8 shadow-2xl"
        >
          <header className="text-center">
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-teal-500/20 text-teal-300">
              <LogIn size={24} />
            </div>
            <h1 className="text-xl font-semibold">{tenantName}</h1>
            <p className="text-sm text-slate-400">Kiosk · enter PIN to unlock</p>
          </header>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="PIN"
            className="w-full rounded-lg border-0 bg-slate-900 px-4 py-3 text-center text-2xl tracking-widest text-white placeholder-slate-500 focus:ring-2 focus:ring-teal-500 focus:outline-none"
          />
          {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-teal-500 px-4 py-3 text-base font-semibold text-white hover:bg-teal-400"
          >
            Unlock kiosk
          </button>
        </form>
      </div>
    )
  }

  // ---------------- Person picker ----------------
  if (stage.kind === 'pick') {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{tenantName}</h1>
              <p className="text-xs text-slate-500">Tap your name to sign in or out</p>
            </div>
            <div className="relative max-w-md flex-1">
              <Search
                size={16}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                placeholder="Search your name…"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-3 pr-3 pl-10 text-base text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
              />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl p-6">
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              {query ? `No people match "${query}"` : 'No employees in the directory'}
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pickPerson(p)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm hover:border-teal-500 hover:bg-teal-50"
                  >
                    <div>
                      <div className="text-lg font-semibold text-slate-900">
                        {p.firstName} {p.lastName}
                      </div>
                      {p.jobTitle ? (
                        <div className="text-xs text-slate-500">{p.jobTitle}</div>
                      ) : null}
                    </div>
                    <span className="text-xs tracking-wide text-teal-700 uppercase">Tap →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    )
  }

  // ---------------- Sign in/out modal ----------------
  if (stage.kind === 'sign') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-900/90 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStage({ kind: 'pick', pin: stage.pin })}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              onClick={() => setStage({ kind: 'pick', pin: stage.pin })}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">
            {stage.person.firstName} {stage.person.lastName}
          </h2>
          {stage.person.jobTitle ? (
            <p className="text-sm text-slate-500">{stage.person.jobTitle}</p>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3">
            {sites.length > 0 ? (
              <div>
                <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Site (optional)
                </label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">— No site —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {crews.length > 0 ? (
              <div>
                <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Crew (optional)
                </label>
                <select
                  value={crewId}
                  onChange={(e) => setCrewId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">— No crew —</option>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {error ? <p className="mt-4 text-center text-sm text-red-600">{error}</p> : null}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => sign('in')}
              disabled={pending}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500 px-4 py-6 text-base font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              <LogIn size={24} />
              SIGN IN
            </button>
            <button
              type="button"
              onClick={() => sign('out')}
              disabled={pending}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-amber-500 px-4 py-6 text-base font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
            >
              <LogOut size={24} />
              SIGN OUT
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------- Confirmation ----------------
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="text-2xl font-semibold text-slate-900">
          {stage.scanKind === 'in' ? 'Signed in' : 'Signed out'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {stage.person.firstName} {stage.person.lastName} ·{' '}
          {stage.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        <button
          type="button"
          onClick={() => {
            setStage({ kind: 'pick', pin: stage.pin })
            setQuery('')
          }}
          className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          Done
        </button>
      </div>
    </div>
  )
}
