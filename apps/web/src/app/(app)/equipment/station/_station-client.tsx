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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
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
  Search,
  UserRound,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react'
import { Badge, Select } from '@beaconhs/ui'
import type {
  StationScanInput,
  StationScanResult,
  StationSearchResults,
} from '@/lib/equipment-station'

type Person = { id: string; name: string; employeeNo: string | null; jobTitle: string | null }
type Location = { id: string; name: string; level: string; isBase: boolean }

type LogEntry = {
  key: string
  action: 'checked_out' | 'checked_in' | 'active_person' | 'error'
  title: string
  sub: string | null
  assetTag: string | null
  undone?: boolean
}

type Flash = { tone: 'in' | 'out' | 'person' | 'error'; title: string; sub: string | null } | null

function subscribeStaticStore() {
  return () => {}
}

function getCameraAvailability() {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    Boolean(window.navigator.mediaDevices?.getUserMedia)
  )
}

function subscribeDesktopViewport(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia('(min-width: 1024px)')
  mq.addEventListener('change', onStoreChange)
  return () => mq.removeEventListener('change', onStoreChange)
}

function getDesktopViewport() {
  return typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
}

export type StationClientProps = {
  surface: 'app' | 'kiosk'
  tenantName: string
  scanMode: 'toggle' | 'explicit'
  soundEnabled: boolean
  requireConditionOnCheckin: boolean
  homeLocationName: string | null
  people: Person[]
  locations: Location[]
  availableCount: number
  initialActivePersonId?: string | null
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
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
    availableCount,
    initialActivePersonId,
    initialScanCode,
    onSearch,
    onScan,
    onAuthError,
    onExit,
  } = props

  const kiosk = surface === 'kiosk'
  const [activePerson, setActivePerson] = useState<Person | null>(
    () => people.find((p) => p.id === initialActivePersonId) ?? null,
  )
  const [destinationId, setDestinationId] = useState('')
  const [direction, setDirection] = useState<'toggle' | 'out' | 'in'>(
    scanMode === 'explicit' ? 'out' : 'toggle',
  )
  const [soundOn, setSoundOn] = useState(props.soundEnabled)
  const [scanValue, setScanValue] = useState('')
  const [pending, setPending] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [availCount, setAvailCount] = useState(availableCount)
  const [results, setResults] = useState<StationSearchResults | null>(null)
  const [overlay, setOverlay] = useState(false)
  const [camOpen, setCamOpen] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const beep = useBeeper(soundOn)

  const hasCamera = useSyncExternalStore(subscribeStaticStore, getCameraAvailability, () => false)
  const isDesktop = useSyncExternalStore(subscribeDesktopViewport, getDesktopViewport, () => true)

  const focusScan = useCallback(() => {
    // Don't steal focus from the camera overlay or a dropdown search box.
    if (camOpen) return
    const el = scanRef.current
    const tag = document.activeElement?.tagName
    if (el && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SELECT') {
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
          (scanMode === 'explicit' && direction !== 'toggle'
            ? (direction as 'in' | 'out')
            : undefined)
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
            ({
              id: result.personId,
              name: result.personName,
              employeeNo: null,
              jobTitle: result.jobTitle,
            } as Person)
          setActivePerson(person)
          beep('person')
          showFlash({ tone: 'person', title: result.personName, sub: 'Active holder set' })
          return
        }
        // A real check in/out happened — update the live availability count + log.
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
        setAvailCount((n) => (checkedOut ? Math.max(0, n - 1) : n + 1))
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
    if (q.length < 1) return
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

  function selectActivePerson(id: string) {
    setActivePerson(id ? (people.find((p) => p.id === id) ?? activePerson) : null)
  }

  function undo(entry: LogEntry) {
    if (entry.undone || !entry.assetTag) return
    setLog((l) => l.map((e) => (e.key === entry.key ? { ...e, undone: true } : e)))
    void handleCode(entry.assetTag, {
      directionOverride: entry.action === 'checked_out' ? 'in' : 'out',
    })
  }

  // The in-app station lives under PageContainer's transformed FadeInBody, which
  // constrains a native-fullscreened descendant. So "kiosk" mode renders the
  // station as a fixed full-viewport overlay portaled to <body> (always fills
  // the screen + scales up), and best-effort also requests true browser
  // fullscreen on the document root.
  function toggleKiosk() {
    if (!overlay) {
      setOverlay(true)
      void document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
      setOverlay(false)
    }
  }
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setOverlay(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const personOptions = useMemo(() => {
    const options = people.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.employeeNo ?? undefined,
    }))
    if (activePerson && !options.some((option) => option.value === activePerson.id)) {
      return [
        {
          value: activePerson.id,
          label: activePerson.name,
          hint: activePerson.employeeNo ?? undefined,
        },
        ...options,
      ]
    }
    return options
  }, [activePerson, people])
  const locationOptions = useMemo(
    () =>
      locations.map((l) => ({
        value: l.id,
        label: l.name,
        hint: l.isBase ? 'base' : l.level,
      })),
    [locations],
  )

  const dark = kiosk || overlay
  const visibleResults = scanValue.trim().length > 0 ? results : null
  // Kiosk / full-screen scales everything up so it reads across a room.
  const big = dark
  const shell = overlay
    ? 'fixed inset-0 z-40 overflow-y-auto bg-slate-950 text-slate-100'
    : kiosk
      ? 'min-h-screen bg-slate-950 text-slate-100'
      : 'mx-auto w-full max-w-full overflow-visible rounded-none bg-transparent text-slate-900 dark:bg-transparent dark:text-slate-100 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:dark:border-slate-800 sm:dark:bg-slate-900'

  const tree = (
    <div ref={rootRef} className={shell}>
      <div
        className={
          big
            ? 'mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col gap-6 p-6 sm:p-10'
            : 'flex w-full max-w-full flex-col gap-4 px-3 py-3 sm:gap-5 sm:p-6'
        }
        onClick={focusScan}
      >
        {/* ---- header ------------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`grid h-11 w-11 place-items-center rounded-xl ${
                dark
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
              }`}
            >
              <ScanLine size={22} />
            </div>
            <div>
              <div className={`font-semibold ${big ? 'text-2xl' : 'text-lg'}`}>
                Check-in / out station
              </div>
              <div
                className={
                  dark ? 'text-sm text-slate-400' : 'text-xs text-slate-500 dark:text-slate-400'
                }
              >
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
                dark
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
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
                  dark
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <Camera size={16} />
              </button>
            ) : null}
            {surface === 'app' ? (
              <button
                type="button"
                onClick={toggleKiosk}
                title={overlay ? 'Exit full screen' : 'Full screen (kiosk)'}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${
                  dark
                    ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900'
                }`}
              >
                {overlay ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                {overlay ? 'Exit' : 'Kiosk'}
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
            <Select
              value={activePerson?.id ?? ''}
              onChange={(e) => selectActivePerson(e.currentTarget.value)}
              placeholder="Scan a badge or pick..."
              searchPlaceholder="Search people..."
              sheetTitle="Active holder"
              aria-label="Active holder"
            >
              <option value="">No active holder</option>
              {personOptions.map((person) => (
                <option key={person.value} value={person.value}>
                  {person.hint ? `${person.label} (${person.hint})` : person.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label dark={dark}>Check-out destination</Label>
            <Select
              value={destinationId}
              onChange={(e) => setDestinationId(e.currentTarget.value)}
              placeholder="Pick a destination..."
              searchPlaceholder="Search locations..."
              sheetTitle="Check-out destination"
              aria-label="Destination"
            >
              <option value="" disabled>
                Pick a destination...
              </option>
              {locationOptions.map((location) => (
                <option key={location.value} value={location.value}>
                  {location.hint ? `${location.label} (${location.hint})` : location.label}
                </option>
              ))}
            </Select>
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
            className={`w-full rounded-xl border-2 font-medium transition outline-none disabled:opacity-60 ${
              big ? 'py-6 pr-5 pl-16 text-3xl' : 'py-4 pr-4 pl-12 text-lg'
            } ${
              dark
                ? 'border-slate-700 bg-slate-900 text-white placeholder-slate-500 focus:border-amber-400'
                : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-amber-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white'
            }`}
          />
          {isDesktop &&
          scanValue.trim().length > 0 &&
          visibleResults &&
          (visibleResults.equipment.length > 0 || visibleResults.people.length > 0) ? (
            <div
              className={`absolute z-20 mt-1.5 w-full overflow-y-auto rounded-xl border shadow-xl ${
                big ? 'max-h-[32rem]' : 'max-h-96'
              } ${
                dark
                  ? 'border-slate-700 bg-slate-900'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
              }`}
            >
              {visibleResults.people.length > 0 ? (
                <div className="p-1">
                  <DropHeader dark={dark}>People — set active holder</DropHeader>
                  {visibleResults.people.map((p) => (
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
                            dark
                              ? 'block truncate text-xs text-slate-400'
                              : 'block truncate text-xs text-slate-500'
                          }
                        >
                          {[p.jobTitle, p.employeeNo].filter(Boolean).join(' · ') || 'Employee'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {visibleResults.equipment.length > 0 ? (
                <div className="p-1">
                  <DropHeader dark={dark}>
                    Equipment — tap to {scanActionWord(direction)}
                  </DropHeader>
                  {visibleResults.equipment.map((it) => (
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
                          <span className="font-mono text-xs opacity-70">{it.assetTag}</span> ·{' '}
                          {it.name}
                        </span>
                        <span
                          className={
                            dark
                              ? 'block truncate text-xs text-slate-400'
                              : 'block truncate text-xs text-slate-500'
                          }
                        >
                          {it.typeName ?? 'Equipment'}
                          {it.isOut && it.holderName ? ` · with ${it.holderName}` : ''}
                        </span>
                      </span>
                      <Badge variant={it.isOut ? 'warning' : 'success'}>
                        {it.isOut ? 'out' : 'in'}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!isDesktop && visibleResults ? (
            <MobileStationResultsSheet
              query={scanValue}
              results={visibleResults}
              direction={direction}
              onQueryChange={setScanValue}
              onSubmitQuery={() => void handleCode(scanValue)}
              onClose={() => {
                setScanValue('')
                setResults(null)
              }}
              onPickPerson={pickPerson}
              onPickEquipment={(assetTag) => void handleCode(assetTag)}
            />
          ) : null}
        </div>

        {/* ---- feedback + session log ------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <FlashPanel flash={flash} pending={pending} dark={dark} big={big} />
          </div>
          <div className="lg:col-span-3">
            <div
              className={
                dark
                  ? 'text-xs font-medium text-slate-400'
                  : 'text-xs font-medium text-slate-500 dark:text-slate-400'
              }
            >
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
                      dark
                        ? 'border-slate-800 bg-slate-900'
                        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
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
                          <span
                            className={
                              dark
                                ? 'block truncate text-xs text-slate-400'
                                : 'block truncate text-xs text-slate-500'
                            }
                          >
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
                          dark
                            ? 'text-slate-300 hover:bg-slate-800'
                            : 'text-teal-700 hover:bg-teal-50 dark:text-teal-400'
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

        {/* ---- live counts -------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="success">{availCount} available</Badge>
        </div>
      </div>

      {camOpen ? (
        <CameraScanner onCode={(c) => handleCode(c)} onClose={() => setCamOpen(false)} />
      ) : null}
    </div>
  )

  // Kiosk overlay escapes the transformed app shell by rendering at <body>.
  return overlay ? createPortal(tree, document.body) : tree
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
          dark
            ? 'border-slate-800 text-slate-500'
            : 'border-slate-200 text-slate-400 dark:border-slate-800'
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
    <div
      className={`flex h-full ${minH} items-center gap-4 rounded-xl px-5 py-6 text-white ${tone.bg}`}
    >
      <div
        className={`grid shrink-0 place-items-center rounded-full bg-white/20 ${
          big ? 'h-20 w-20' : 'h-14 w-14'
        }`}
      >
        {tone.icon}
      </div>
      <div className="min-w-0">
        <div className={`font-bold tracking-tight ${big ? 'text-4xl' : 'text-2xl'}`}>
          {flash.title}
        </div>
        {flash.sub ? (
          <div className={`truncate text-white/85 ${big ? 'text-lg' : 'text-sm'}`}>{flash.sub}</div>
        ) : null}
      </div>
    </div>
  )
}

function MobileStationResultsSheet({
  query,
  results,
  direction,
  onQueryChange,
  onSubmitQuery,
  onClose,
  onPickPerson,
  onPickEquipment,
}: {
  query: string
  results: StationSearchResults
  direction: 'toggle' | 'out' | 'in'
  onQueryChange: (value: string) => void
  onSubmitQuery: () => void
  onClose: () => void
  onPickPerson: (person: { id: string; name: string }) => void
  onPickEquipment: (assetTag: string) => void
}) {
  if (typeof document === 'undefined') return null
  const hasResults = results.people.length > 0 || results.equipment.length > 0
  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[60]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 34, stiffness: 340, mass: 0.8 }}
          className="absolute inset-x-0 bottom-0 flex max-h-[82vh] flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-center pt-2.5">
            <span className="h-1.5 w-10 rounded-full bg-slate-300" />
          </div>
          <div className="flex items-center justify-between px-4 pt-2 pb-1">
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Scan search
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>
          <div className="relative px-3 pt-3">
            <Search
              size={16}
              className="absolute top-1/2 left-6 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            />
            <input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSubmitQuery()
                }
              }}
              placeholder="Scan or type to search..."
              className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pr-3 pl-9 text-base transition outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-slate-800 dark:bg-slate-900 dark:focus:bg-slate-900"
            />
          </div>
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {!hasResults ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                No matches
              </div>
            ) : null}
            {results.people.length > 0 ? (
              <div>
                <div className="px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
                  People - set active holder
                </div>
                <ul role="listbox" className="py-1">
                  {results.people.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => onPickPerson(person)}
                        className="flex h-12 w-full items-center gap-2.5 px-4 text-left text-[15px] text-slate-700 transition-colors active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-700"
                      >
                        <UserRound size={17} className="shrink-0 text-teal-600" />
                        <span className="min-w-0 flex-1 truncate">
                          {person.name}
                          {[person.jobTitle, person.employeeNo].filter(Boolean).length > 0 ? (
                            <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">
                              {[person.jobTitle, person.employeeNo].filter(Boolean).join(' - ')}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {results.equipment.length > 0 ? (
              <div>
                <div className="px-4 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
                  Equipment - tap to {scanActionWord(direction)}
                </div>
                <ul role="listbox" className="py-1">
                  {results.equipment.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => onPickEquipment(item.assetTag)}
                        className="flex h-12 w-full items-center gap-2.5 px-4 text-left text-[15px] text-slate-700 transition-colors active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-700"
                      >
                        <PackageCheck
                          size={17}
                          className={`shrink-0 ${item.isOut ? 'text-amber-500' : 'text-emerald-500'}`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                            {item.assetTag}
                          </span>{' '}
                          {item.name}
                          <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">
                            {item.typeName ?? 'Equipment'}
                            {item.isOut && item.holderName ? ` - with ${item.holderName}` : ''}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-xs font-medium ${
                            item.isOut ? 'text-amber-600' : 'text-emerald-600'
                          }`}
                        >
                          {item.isOut ? 'out' : 'in'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  )
}

// Lightweight camera scanner using the platform BarcodeDetector (Android Chrome,
// recent iOS). Gracefully unused where the API is missing (button is hidden).
function CameraScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    let lastCode = ''
    let lastAt = 0

    async function start() {
      try {
        const Detector = (
          window as unknown as {
            BarcodeDetector: new (o?: unknown) => {
              detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>
            }
          }
        ).BarcodeDetector
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

  if (typeof document === 'undefined') return null
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
