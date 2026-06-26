'use client'

// StationClient — the shared scan-driven check in/out surface.
// Used by BOTH the in-app station (/equipment/station, authed) and the public
// mounted-tablet kiosk (/equipment-kiosk, PIN-gated). The two differ only in the
// bound server actions passed in (onScan/onResolve) and a couple of cosmetic
// flags — all behaviour lives here so desktop, mobile and kiosk stay identical.
//
// Fast path: a single always-focused field captures the USB scan gun (it types
// the code + Enter). Scan a person badge → they become the active holder; scan
// an asset → it toggles state (or the forced direction in explicit mode), with
// an instant colour flash + beep. Mobile gets a camera scanner when the browser
// supports BarcodeDetector.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Camera,
  CheckCircle2,
  Maximize2,
  Minimize2,
  PackageCheck,
  ScanLine,
  UserRound,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react'
import { Badge, SearchSelect } from '@beaconhs/ui'
import type {
  StationScanInput,
  StationScanResult,
  StationSearchResults,
} from '@/lib/equipment-station'

type Person = { id: string; name: string; employeeNo: string | null; jobTitle: string | null }
type Location = { id: string; name: string; level: string; isBase: boolean }
type OpenCheckout = {
  id: string
  itemId: string
  assetTag: string
  itemName: string
  holderName: string | null
  locationName: string | null
  checkedOutAt: string
  expectedReturnOn: string | null
}

type LogEntry = {
  key: string
  action: 'checked_out' | 'checked_in' | 'active_person' | 'error'
  title: string
  sub: string | null
  assetTag: string | null
  undone?: boolean
}

type Flash = { tone: 'in' | 'out' | 'person' | 'error'; title: string; sub: string | null } | null

export type StationClientProps = {
  surface: 'app' | 'kiosk'
  tenantName: string
  scanMode: 'toggle' | 'explicit'
  soundEnabled: boolean
  requireConditionOnCheckin: boolean
  homeLocationName: string | null
  people: Person[]
  locations: Location[]
  openCheckouts: OpenCheckout[]
  availableCount: number
  initialScanCode?: string | null
  onSearch: (query: string) => Promise<StationSearchResults>
  onScan: (input: StationScanInput) => Promise<StationScanResult>
  /** Called when the server rejects with a PIN error (kiosk re-locks). */
  onAuthError?: () => void
  /** Kiosk supplies a way back to the lock screen. */
  onExit?: () => void
}

// Short distinct WebAudio chirps so operators get eyes-free confirmation.
function useBeeper(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null)
  return useCallback(
    (tone: 'in' | 'out' | 'person' | 'error') => {
      if (!enabled) return
      try {
        const AC =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        const ctx = ctxRef.current ?? new AC()
        ctxRef.current = ctx
        const now = ctx.currentTime
        const seq =
          tone === 'in'
            ? [880, 1320]
            : tone === 'out'
              ? [660, 990]
              : tone === 'person'
                ? [740]
                : [200, 160]
        seq.forEach((freq, i) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = tone === 'error' ? 'square' : 'sine'
          osc.frequency.value = freq
          const t = now + i * 0.09
          gain.gain.setValueAtTime(0.0001, t)
          gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
          osc.connect(gain).connect(ctx.destination)
          osc.start(t)
          osc.stop(t + 0.09)
        })
      } catch {
        // Audio is best-effort; never block a scan on it.
      }
    },
    [enabled],
  )
}

export function StationClient(props: StationClientProps) {
  const {
    surface,
    tenantName,
    scanMode,
    homeLocationName,
    people,
    locations,
    openCheckouts: initialOpen,
    availableCount,
    initialScanCode,
    onSearch,
    onScan,
    onAuthError,
    onExit,
  } = props

  const kiosk = surface === 'kiosk'
  const [activePerson, setActivePerson] = useState<Person | null>(null)
  const [destinationId, setDestinationId] = useState('')
  const [direction, setDirection] = useState<'toggle' | 'out' | 'in'>(
    scanMode === 'explicit' ? 'out' : 'toggle',
  )
  const [soundOn, setSoundOn] = useState(props.soundEnabled)
  const [scanValue, setScanValue] = useState('')
  const [pending, setPending] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [open, setOpen] = useState<OpenCheckout[]>(initialOpen)
  const [outCount, setOutCount] = useState(initialOpen.length)
  const [availCount, setAvailCount] = useState(availableCount)
  const [results, setResults] = useState<StationSearchResults | null>(null)
  const [isFull, setIsFull] = useState(false)
  const [camOpen, setCamOpen] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beep = useBeeper(soundOn)

  const [hasCamera, setHasCamera] = useState(false)
  useEffect(() => {
    setHasCamera('BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia))
  }, [])

  const focusScan = useCallback(() => {
    // Don't steal focus from the camera overlay or a dropdown search box.
    if (camOpen) return
    const el = scanRef.current
    if (el && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      el.focus()
    }
  }, [camOpen])

  useEffect(() => {
    scanRef.current?.focus()
  }, [])

  const showFlash = useCallback((f: NonNullable<Flash>) => {
    setFlash(f)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 2600)
  }, [])

  const handleCode = useCallback(
    async (raw: string, opts?: { directionOverride?: 'in' | 'out' }) => {
      const code = raw.trim()
      if (!code || pending) return
      setPending(true)
      setScanValue('')
      try {
        const dir =
          opts?.directionOverride ??
          (scanMode === 'explicit' && direction !== 'toggle' ? (direction as 'in' | 'out') : undefined)
        const result = await onScan({
          code,
          activePersonId: activePerson?.id ?? null,
          destinationOrgUnitId: destinationId || null,
          direction: dir,
        })
        if (!result.ok) {
          if (/pin/i.test(result.error) && onAuthError) onAuthError()
          beep('error')
          showFlash({ tone: 'error', title: 'Not recognised', sub: result.error })
          setLog((l) =>
            [
              {
                key: `${Date.now()}-e`,
                action: 'error' as const,
                title: result.error,
                sub: null,
                assetTag: null,
              },
              ...l,
            ].slice(0, 60),
          )
          return
        }
        if (result.action === 'active_person') {
          const person =
            people.find((p) => p.id === result.personId) ??
            ({ id: result.personId, name: result.personName, employeeNo: null, jobTitle: result.jobTitle } as Person)
          setActivePerson(person)
          beep('person')
          showFlash({ tone: 'person', title: result.personName, sub: 'Active holder set' })
          return
        }
        // A real check in/out happened — update the live counters + log.
        const checkedOut = result.action === 'checked_out'
        beep(checkedOut ? 'out' : 'in')
        showFlash({
          tone: checkedOut ? 'out' : 'in',
          title: checkedOut ? 'Checked out' : 'Checked in',
          sub: `${result.assetTag} · ${result.itemName}`,
        })
        setLog((l) =>
          [
            {
              key: `${Date.now()}-${result.itemId}`,
              action: result.action,
              title: `${result.assetTag} · ${result.itemName}`,
              sub: checkedOut
                ? `to ${result.holderName ?? 'no holder'}${result.locationName ? ` @ ${result.locationName}` : ''}`
                : `returned${result.locationName ? ` to ${result.locationName}` : ''}`,
              assetTag: result.assetTag,
            },
            ...l,
          ].slice(0, 60),
        )
        setOutCount((n) => (checkedOut ? n + 1 : Math.max(0, n - 1)))
        setAvailCount((n) => (checkedOut ? Math.max(0, n - 1) : n + 1))
        if (checkedOut) {
          setOpen((o) => [
            {
              id: result.checkoutId ?? result.itemId,
              itemId: result.itemId,
              assetTag: result.assetTag,
              itemName: result.itemName,
              holderName: result.holderName,
              locationName: result.locationName,
              checkedOutAt: new Date().toISOString(),
              expectedReturnOn: null,
            },
            ...o,
          ])
        } else {
          setOpen((o) => o.filter((c) => c.itemId !== result.itemId))
        }
      } finally {
        setPending(false)
        setTimeout(focusScan, 0)
      }
    },
    [
      pending,
      scanMode,
      direction,
      activePerson,
      destinationId,
      onScan,
      onAuthError,
      beep,
      showFlash,
      people,
      focusScan,
    ],
  )

  // Deep-link: /equipment/scan/<token> lands here with the code prefilled.
  const didInitial = useRef(false)
  useEffect(() => {
    if (didInitial.current || !initialScanCode) return
    didInitial.current = true
    void handleCode(initialScanCode)
  }, [initialScanCode, handleCode])

  // Typeahead: surface matching assets + people as the operator types. A scan
  // gun fires Enter before this matters; this is for finger-typing a name/tag.
  useEffect(() => {
    const q = scanValue.trim()
    if (q.length < 1) {
      setResults(null)
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      const r = await onSearch(q)
      if (alive) setResults(r)
    }, 180)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [scanValue, onSearch])

  function pickPerson(p: { id: string; name: string }) {
    setActivePerson(
      people.find((x) => x.id === p.id) ??
        ({ id: p.id, name: p.name, employeeNo: null, jobTitle: null } as Person),
    )
    beep('person')
    showFlash({ tone: 'person', title: p.name, sub: 'Active holder set' })
    setScanValue('')
    setResults(null)
    setTimeout(focusScan, 0)
  }

  function undo(entry: LogEntry) {
    if (entry.undone || !entry.assetTag) return
    setLog((l) => l.map((e) => (e.key === entry.key ? { ...e, undone: true } : e)))
    void handleCode(entry.assetTag, {
      directionOverride: entry.action === 'checked_out' ? 'in' : 'out',
    })
  }

  function toggleFullscreen() {
    const el = rootRef.current
    if (!el) return
    if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => {})
    else void document.exitFullscreen?.().catch(() => {})
  }
  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const personOptions = useMemo(
    () => people.map((p) => ({ value: p.id, label: p.name, hint: p.employeeNo ?? undefined })),
    [people],
  )
  const locationOptions = useMemo(
    () =>
      locations.map((l) => ({
        value: l.id,
        label: l.name,
        hint: l.isBase ? 'base' : l.level,
      })),
    [locations],
  )

  const dark = kiosk || isFull
  // Kiosk / full-screen scales everything up so it reads across a room.
  const big = dark
  const shell = dark
    ? 'min-h-screen bg-slate-950 text-slate-100'
    : 'rounded-2xl border border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'

  return (
    <div ref={rootRef} className={shell}>
      <div
        className={
          big
            ? 'mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col gap-6 p-6 sm:p-10'
            : 'flex flex-col gap-5 p-4 sm:p-6'
        }
        onClick={focusScan}
      >
        {/* ---- header ------------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`grid h-11 w-11 place-items-center rounded-xl ${
                dark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
              }`}
            >
              <ScanLine size={22} />
            </div>
            <div>
              <div className={`font-semibold ${big ? 'text-2xl' : 'text-lg'}`}>
                Check-in / out station
              </div>
              <div className={dark ? 'text-sm text-slate-400' : 'text-xs text-slate-500 dark:text-slate-400'}>
                {tenantName}
                {homeLocationName ? ` · home: ${homeLocationName}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundOn((s) => !s)}
              title={soundOn ? 'Mute' : 'Unmute'}
              className={`grid h-9 w-9 place-items-center rounded-lg ${
                dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            {hasCamera ? (
              <button
                type="button"
                onClick={() => setCamOpen(true)}
                title="Scan with camera"
                className={`grid h-9 w-9 place-items-center rounded-lg ${
                  dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <Camera size={16} />
              </button>
            ) : null}
            {surface === 'app' ? (
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFull ? 'Exit full screen' : 'Full screen (kiosk)'}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${
                  dark ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900'
                }`}
              >
                {isFull ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                {isFull ? 'Exit' : 'Kiosk'}
              </button>
            ) : null}
            {kiosk && onExit ? (
              <button
                type="button"
                onClick={onExit}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-sm font-medium text-slate-200 hover:bg-slate-700"
              >
                <X size={15} /> Lock
              </button>
            ) : null}
          </div>
        </div>

        {/* ---- context bar: active person + destination + mode ------------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label dark={dark}>Active holder</Label>
            {activePerson ? (
              <div
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                  dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900'
                }`}
              >
                <span className="flex items-center gap-2 truncate text-sm font-medium">
                  <UserRound size={15} className="shrink-0 text-teal-500" />
                  <span className="truncate">{activePerson.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActivePerson(null)}
                  className="shrink-0 text-slate-400 hover:text-red-500"
                  title="Clear active holder"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <SearchSelect
                value=""
                onChange={(v) => setActivePerson(people.find((p) => p.id === v) ?? null)}
                options={personOptions}
                placeholder="Scan a badge or pick…"
                ariaLabel="Active holder"
              />
            )}
          </div>
          <div className="space-y-1">
            <Label dark={dark}>Check-out destination</Label>
            <SearchSelect
              value={destinationId}
              onChange={setDestinationId}
              options={locationOptions}
              clearable
              emptyLabel="Unassigned (any location)"
              placeholder="Unassigned (any location)"
              ariaLabel="Destination"
            />
          </div>
          <div className="space-y-1">
            <Label dark={dark}>Scan does</Label>
            <div
              className={`grid grid-cols-3 gap-1 rounded-lg p-1 ${
                dark ? 'bg-slate-900' : 'bg-slate-100 dark:bg-slate-900'
              }`}
            >
              {(
                [
                  { k: 'toggle', label: 'Toggle', icon: <ArrowLeftRight size={14} /> },
                  { k: 'out', label: 'Out', icon: <ArrowUpFromLine size={14} /> },
                  { k: 'in', label: 'In', icon: <ArrowDownToLine size={14} /> },
                ] as const
              ).map((opt) => {
                const active = direction === opt.k
                return (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => setDirection(opt.k)}
                    className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                      active
                        ? opt.k === 'in'
                          ? 'bg-emerald-500 text-white'
                          : opt.k === 'out'
                            ? 'bg-amber-500 text-white'
                            : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : dark
                          ? 'text-slate-400 hover:text-slate-200'
                          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ---- the scan field + typeahead --------------------------------- */}
        <div className="relative">
          <ScanLine
            size={big ? 28 : 22}
            className={`pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 ${
              dark ? 'text-amber-300' : 'text-amber-500'
            }`}
          />
          <input
            ref={scanRef}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleCode(scanValue)
              } else if (e.key === 'Escape') {
                setResults(null)
              }
            }}
            disabled={pending}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Scan a tag or badge — or type to search"
            className={`w-full rounded-xl border-2 font-medium outline-none transition disabled:opacity-60 ${
              big ? 'py-6 pr-5 pl-16 text-3xl' : 'py-4 pr-4 pl-12 text-lg'
            } ${
              dark
                ? 'border-slate-700 bg-slate-900 text-white placeholder-slate-500 focus:border-amber-400'
                : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-amber-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white'
            }`}
          />
          {scanValue.trim().length > 0 &&
          results &&
          (results.equipment.length > 0 || results.people.length > 0) ? (
            <div
              className={`absolute z-20 mt-1.5 max-h-80 w-full overflow-y-auto rounded-xl border shadow-xl ${
                dark
                  ? 'border-slate-700 bg-slate-900'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              {results.people.length > 0 ? (
                <div className="p-1">
                  <DropHeader dark={dark}>People — set active holder</DropHeader>
                  {results.people.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickPerson(p)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${
                        dark ? 'hover:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <UserRound size={16} className="shrink-0 text-teal-500" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span
                          className={
                            dark ? 'block truncate text-xs text-slate-400' : 'block truncate text-xs text-slate-500'
                          }
                        >
                          {[p.jobTitle, p.employeeNo].filter(Boolean).join(' · ') || 'Employee'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {results.equipment.length > 0 ? (
                <div className="p-1">
                  <DropHeader dark={dark}>Equipment — tap to {scanActionWord(direction)}</DropHeader>
                  {results.equipment.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleCode(it.assetTag)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${
                        dark ? 'hover:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <PackageCheck
                        size={16}
                        className={`shrink-0 ${it.isOut ? 'text-amber-500' : 'text-emerald-500'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          <span className="font-mono text-xs opacity-70">{it.assetTag}</span> · {it.name}
                        </span>
                        <span
                          className={
                            dark ? 'block truncate text-xs text-slate-400' : 'block truncate text-xs text-slate-500'
                          }
                        >
                          {it.typeName ?? 'Equipment'}
                          {it.isOut && it.holderName ? ` · with ${it.holderName}` : ''}
                        </span>
                      </span>
                      <Badge variant={it.isOut ? 'warning' : 'success'}>{it.isOut ? 'out' : 'in'}</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ---- feedback + session log ------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <FlashPanel flash={flash} pending={pending} dark={dark} big={big} />
          </div>
          <div className="lg:col-span-3">
            <div className={dark ? 'text-xs font-medium text-slate-400' : 'text-xs font-medium text-slate-500 dark:text-slate-400'}>
              This session
            </div>
            <ul className="mt-2 space-y-1.5">
              {log.length === 0 ? (
                <li className={dark ? 'text-sm text-slate-500' : 'text-sm text-slate-400'}>
                  Scans you make will appear here.
                </li>
              ) : (
                log.map((e) => (
                  <li
                    key={e.key}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                      dark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                    } ${e.undone ? 'opacity-50' : ''}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {e.action === 'checked_out' ? (
                        <ArrowUpFromLine size={15} className="shrink-0 text-amber-500" />
                      ) : e.action === 'checked_in' ? (
                        <ArrowDownToLine size={15} className="shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle size={15} className="shrink-0 text-red-500" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{e.title}</span>
                        {e.sub ? (
                          <span className={dark ? 'block truncate text-xs text-slate-400' : 'block truncate text-xs text-slate-500'}>
                            {e.sub}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {e.assetTag && !e.undone && e.action !== 'error' ? (
                      <button
                        type="button"
                        onClick={() => undo(e)}
                        className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                          dark ? 'text-slate-300 hover:bg-slate-800' : 'text-teal-700 hover:bg-teal-50 dark:text-teal-400'
                        }`}
                      >
                        Undo
                      </button>
                    ) : e.undone ? (
                      <span className="shrink-0 text-xs text-slate-400">undone</span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {/* ---- live counts + currently-out -------------------------------- */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={outCount > 0 ? 'warning' : 'secondary'}>{outCount} out</Badge>
          <Badge variant="success">{availCount} available</Badge>
        </div>
        {open.length > 0 ? (
          <div
            className={`overflow-hidden rounded-xl border ${
              dark ? 'border-slate-800' : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div
              className={`px-3 py-2 text-xs font-semibold ${
                dark ? 'bg-slate-900 text-slate-300' : 'bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              Currently out
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto text-sm">
              {open.slice(0, 50).map((c) => (
                <li
                  key={c.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2 ${
                    dark ? 'divide-slate-800 border-slate-800' : 'divide-slate-100'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      <span className="font-mono text-xs opacity-70">{c.assetTag}</span> · {c.itemName}
                    </span>
                    <span className={dark ? 'block truncate text-xs text-slate-400' : 'block truncate text-xs text-slate-500'}>
                      {c.holderName ?? 'no holder'}
                      {c.locationName ? ` @ ${c.locationName}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCode(c.assetTag, { directionOverride: 'in' })}
                    className={`shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                      dark ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-emerald-500 text-white hover:bg-emerald-400'
                    }`}
                  >
                    <ArrowDownToLine size={13} /> Check in
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {camOpen ? <CameraScanner onCode={(c) => handleCode(c)} onClose={() => setCamOpen(false)} /> : null}
    </div>
  )
}

function Label({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return (
    <div
      className={`text-xs font-medium tracking-wide uppercase ${
        dark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      {children}
    </div>
  )
}

function DropHeader({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return (
    <div
      className={`px-2 py-1 text-[11px] font-semibold tracking-wide uppercase ${
        dark ? 'text-slate-500' : 'text-slate-400'
      }`}
    >
      {children}
    </div>
  )
}

function scanActionWord(direction: 'toggle' | 'out' | 'in'): string {
  return direction === 'out' ? 'check out' : direction === 'in' ? 'check in' : 'toggle'
}

function FlashPanel({
  flash,
  pending,
  dark,
  big,
}: {
  flash: Flash
  pending: boolean
  dark: boolean
  big: boolean
}) {
  const minH = big ? 'min-h-44' : 'min-h-32'
  if (!flash) {
    return (
      <div
        className={`grid h-full ${minH} place-items-center rounded-xl border-2 border-dashed px-4 py-6 text-center ${
          dark ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-400 dark:border-slate-800'
        }`}
      >
        <div>
          <ScanLine size={big ? 40 : 26} className="mx-auto mb-1.5 opacity-60" />
          <div className={`font-medium ${big ? 'text-lg' : 'text-sm'}`}>
            {pending ? 'Working…' : 'Ready to scan'}
          </div>
        </div>
      </div>
    )
  }
  const iconSize = big ? 44 : 30
  const tone =
    flash.tone === 'in'
      ? { bg: 'bg-emerald-500', icon: <CheckCircle2 size={iconSize} /> }
      : flash.tone === 'out'
        ? { bg: 'bg-amber-500', icon: <ArrowUpFromLine size={iconSize} /> }
        : flash.tone === 'person'
          ? { bg: 'bg-teal-500', icon: <UserRound size={iconSize} /> }
          : { bg: 'bg-red-500', icon: <XCircle size={iconSize} /> }
  return (
    <div className={`flex h-full ${minH} items-center gap-4 rounded-xl px-5 py-6 text-white ${tone.bg}`}>
      <div
        className={`grid shrink-0 place-items-center rounded-full bg-white/20 ${
          big ? 'h-20 w-20' : 'h-14 w-14'
        }`}
      >
        {tone.icon}
      </div>
      <div className="min-w-0">
        <div className={`font-bold tracking-tight ${big ? 'text-4xl' : 'text-2xl'}`}>{flash.title}</div>
        {flash.sub ? (
          <div className={`truncate text-white/85 ${big ? 'text-lg' : 'text-sm'}`}>{flash.sub}</div>
        ) : null}
      </div>
    </div>
  )
}

// Lightweight camera scanner using the platform BarcodeDetector (Android Chrome,
// recent iOS). Gracefully unused where the API is missing (button is hidden).
function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    let lastCode = ''
    let lastAt = 0

    async function start() {
      try {
        const Detector = (window as unknown as { BarcodeDetector: new (o?: unknown) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector
        const detector = new Detector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'],
        })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        const tick = async () => {
          if (stopped || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            const hit = codes[0]?.rawValue
            const now = Date.now()
            if (hit && (hit !== lastCode || now - lastAt > 2500)) {
              lastCode = hit
              lastAt = now
              onCode(hit)
            }
          } catch {
            // transient detect errors are fine between frames
          }
          raf = requestAnimationFrame(() => void tick())
        }
        void tick()
      } catch {
        setError('Camera unavailable — use the scan field instead.')
      }
    }
    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-slate-900">
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Camera size={16} /> Point at a tag
          </span>
          <button type="button" onClick={onClose} className="text-slate-300 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="relative aspect-square bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-amber-400/80" />
          {error ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-300">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
