'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowLeft, CheckCircle2, LogIn, LogOut, X } from 'lucide-react'
import type { AppLocale } from '@beaconhs/i18n'
import { RemoteSearchSelect, type RemoteSearchLoader } from '@/components/remote-search-select'
import { loadKioskOptions, recordKioskScan, unlockKiosk } from './actions'

type Person = { id: string; name: string; detail: string | null }

type Stage =
  | { kind: 'pin' }
  | { kind: 'pick'; pin: string }
  | { kind: 'sign'; pin: string; person: Person }
  | { kind: 'done'; pin: string; person: Person; scanKind: 'in' | 'out'; at: Date }

export function KioskClient({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const t = useTranslations('Kiosk')
  const common = useTranslations('Common')
  const locale = useLocale() as AppLocale
  const [stage, setStage] = useState<Stage>({ kind: 'pin' })
  const [pinInput, setPinInput] = useState('')
  const [siteId, setSiteId] = useState<string>('')
  const [crewId, setCrewId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // The confirmation screen auto-returns to the roster after a few seconds; on
  // a shared tablet the timer must be cancelled the moment anyone moves on
  // manually, or it fires mid-flow and yanks the next worker back to the roster.
  const doneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  function clearDoneTimeout() {
    if (doneTimeoutRef.current !== null) {
      clearTimeout(doneTimeoutRef.current)
      doneTimeoutRef.current = null
    }
  }

  function localizedError(message: string): string {
    if (message === 'Workspace unavailable') return t('workspaceUnavailable')
    if (message === 'Kiosk PIN not configured for this tenant') return t('pinNotConfigured')
    if (message === 'Invalid PIN') return t('invalidPin')
    if (message === 'Invalid kiosk request') return t('invalidRequest')
    return message
  }

  function returnToPicker(pin: string) {
    clearDoneTimeout()
    setError(tGeneratedValue(null))
    setStage({ kind: 'pick', pin })
  }

  useEffect(() => clearDoneTimeout, [])

  const activePin = stage.kind === 'pin' ? '' : stage.pin
  const pickerLoader = useCallback(
    (kind: 'person' | 'site' | 'crew'): RemoteSearchLoader =>
      ({ query, selected }) =>
        activePin
          ? loadKioskOptions({ tenantId, pin: activePin, kind, query, selected })
          : Promise.resolve({ options: [], hasMore: false }),
    [activePin, tenantId],
  )
  const peopleLoader = useCallback<RemoteSearchLoader>(
    (input) => pickerLoader('person')(input),
    [pickerLoader],
  )
  const siteLoader = useCallback<RemoteSearchLoader>(
    (input) => pickerLoader('site')(input),
    [pickerLoader],
  )
  const crewLoader = useCallback<RemoteSearchLoader>(
    (input) => pickerLoader('crew')(input),
    [pickerLoader],
  )

  function submitPin(e: React.FormEvent) {
    e.preventDefault()
    setError(tGeneratedValue(null))
    if (!pinInput.trim()) {
      setError(tGeneratedValue(t('enterPinError')))
      return
    }
    const pin = pinInput.trim()
    start(async () => {
      try {
        const result = await unlockKiosk({ tenantId, pin })
        if (!result.ok) {
          setError(tGeneratedValue(localizedError(result.error)))
          return
        }
        setStage({ kind: 'pick', pin })
      } catch {
        setError(tGeneratedValue(t('unlockError')))
      }
    })
  }

  function pickPerson(person: Person) {
    if (stage.kind !== 'pick') return
    setStage({ kind: 'sign', pin: stage.pin, person })
  }

  function sign(scanKind: 'in' | 'out') {
    if (stage.kind !== 'sign') return
    setError(tGeneratedValue(null))
    const pin = stage.pin
    const person = stage.person
    start(async () => {
      try {
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
          setError(tGeneratedValue(localizedError(result.error)))
          if (result.error === 'Invalid PIN' || result.error.includes('PIN')) {
            setStage({ kind: 'pin' })
            setPinInput('')
          }
          return
        }
        setStage({ kind: 'done', pin, person, scanKind, at: new Date() })
        clearDoneTimeout()
        doneTimeoutRef.current = setTimeout(() => {
          doneTimeoutRef.current = null
          setError(tGeneratedValue(null))
          setStage({ kind: 'pick', pin })
        }, 4000)
      } catch {
        setError(tGeneratedValue(t('scanError')))
      }
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
            <h1 className="text-xl font-semibold">
              <GeneratedValue value={tenantName} />
            </h1>
            <p className="text-sm text-slate-400">
              <GeneratedValue value={t('pinPrompt')} />
            </p>
          </header>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
            pattern="[0-9]{4,12}"
            maxLength={12}
            placeholder={tGenerated('m_18edf6c152be49')}
            className="w-full rounded-lg border-0 bg-slate-900 px-4 py-3 text-center text-2xl tracking-widest text-white placeholder-slate-500 focus:ring-2 focus:ring-teal-500 focus:outline-none"
          />
          <GeneratedValue
            value={
              error ? (
                <p className="text-center text-sm text-red-400">
                  <GeneratedValue value={error} />
                </p>
              ) : null
            }
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-teal-500 px-4 py-3 text-base font-semibold text-white hover:bg-teal-400 disabled:opacity-50"
          >
            <GeneratedValue value={t('unlock')} />
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
              <h1 className="text-lg font-semibold text-slate-900">
                <GeneratedValue value={tenantName} />
              </h1>
              <p className="text-xs text-slate-500">
                <GeneratedValue value={t('namePrompt')} />
              </p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl p-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              <GeneratedValue value={t('yourName')} />
            </label>
            <RemoteSearchSelect
              loadOptions={peopleLoader}
              value=""
              onChange={() => undefined}
              onOptionChange={(person) => {
                if (person) {
                  pickPerson({ id: person.value, name: person.label, detail: person.hint ?? null })
                }
              }}
              placeholder={tGeneratedValue(t('searchName'))}
              searchPlaceholder={tGeneratedValue(t('searchNameHelp'))}
              sheetTitle={t('chooseName')}
              ariaLabel={t('directoryLabel')}
              clearable={false}
              className="w-full"
              triggerClassName="h-14 text-base"
            />
            <p className="mt-3 text-xs text-slate-500">
              <GeneratedValue value={t('resultHelp')} />
            </p>
          </div>
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
              onClick={() => returnToPicker(stage.pin)}
              className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700"
            >
              <ArrowLeft size={14} /> <GeneratedValue value={common('back')} />
            </button>
            <button
              type="button"
              onClick={() => returnToPicker(stage.pin)}
              className="text-slate-400 hover:text-slate-700"
              aria-label={tGeneratedValue(common('close'))}
            >
              <X size={20} />
            </button>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">
            <GeneratedValue value={stage.person.name} />
          </h2>
          <GeneratedValue
            value={
              stage.person.detail ? (
                <p className="text-sm text-slate-500">
                  <GeneratedValue value={stage.person.detail} />
                </p>
              ) : null
            }
          />

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedValue value={t('siteOptional')} />
              </label>
              <RemoteSearchSelect
                loadOptions={siteLoader}
                value={siteId}
                onChange={setSiteId}
                placeholder={tGeneratedValue(t('noSite'))}
                emptyLabel={tGeneratedValue(t('noSite'))}
                searchPlaceholder={tGeneratedValue(t('searchSites'))}
                sheetTitle={t('chooseSite')}
                ariaLabel={t('chooseOptionalSite')}
                className="mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedValue value={t('crewOptional')} />
              </label>
              <RemoteSearchSelect
                loadOptions={crewLoader}
                value={crewId}
                onChange={setCrewId}
                placeholder={tGeneratedValue(t('noCrew'))}
                emptyLabel={tGeneratedValue(t('noCrew'))}
                searchPlaceholder={tGeneratedValue(t('searchCrews'))}
                sheetTitle={t('chooseCrew')}
                ariaLabel={t('chooseOptionalCrew')}
                className="mt-1 w-full"
              />
            </div>
          </div>

          <GeneratedValue
            value={
              error ? (
                <p className="mt-4 text-center text-sm text-red-600">
                  <GeneratedValue value={error} />
                </p>
              ) : null
            }
          />

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => sign('in')}
              disabled={pending}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-emerald-500 px-4 py-6 text-base font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              <LogIn size={24} />
              <GeneratedValue value={t('signIn').toUpperCase()} />
            </button>
            <button
              type="button"
              onClick={() => sign('out')}
              disabled={pending}
              className="flex flex-col items-center justify-center gap-1 rounded-xl bg-amber-500 px-4 py-6 text-base font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
            >
              <LogOut size={24} />
              <GeneratedValue value={t('signOut').toUpperCase()} />
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
          <GeneratedValue value={stage.scanKind === 'in' ? t('signedIn') : t('signedOut')} />
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          <GeneratedValue value={stage.person.name} /> ·<GeneratedValue value={' '} />
          <GeneratedValue
            value={stage.at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          />
        </p>
        <button
          type="button"
          onClick={() => returnToPicker(stage.pin)}
          className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          <GeneratedValue value={t('done')} />
        </button>
      </div>
    </div>
  )
}
