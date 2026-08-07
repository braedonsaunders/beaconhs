'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// "Start an inspection" flyout — no intermediary page.
//
// Two steps, in the same panel: what is being inspected, then which check. The
// check is NOT free choice on a registered unit: it is whatever is set up on
// that unit (its pre-use checklist plus its active schedules), so the options
// are fetched per item and presented as one-tap cards, matching the
// hazard-assessment start flyout. Unregistered rental gear is pre-use only —
// we do not own its certification programme.

import { useEffect, useState, useTransition } from 'react'
import { ClipboardCheck, Loader2, Search } from 'lucide-react'
import { Input, Label, cn } from '@beaconhs/ui'
import type { PickerOption } from '@/lib/picker-options'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { startEquipmentInspection } from './_actions'

type TargetMode = 'registered' | 'rental'
type Choice = { value: string; label: string; hint?: string }

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-500/10 ring-inset dark:bg-slate-800/50 dark:text-slate-400">
      <GeneratedValue value={label} />
    </span>
  )
}

export function NewEquipmentInspectionDrawer({
  initialItem,
  initialType,
  lockedItem = false,
  returnTo,
}: {
  initialItem?: PickerOption
  /** Pre-selected when a schedule's "Start" link named the inspection. */
  initialType?: PickerOption
  /** Started from a unit's own page: the equipment is fixed. */
  lockedItem?: boolean
  /** In-app path the started inspection should open over. Defaults to the register. */
  returnTo?: string
}) {
  const tGenerated = useGeneratedTranslations()
  const [targetMode, setTargetMode] = useState<TargetMode>('registered')
  const [itemId, setItemId] = useState(initialItem?.value ?? '')
  const [siteOrgUnitId, setSiteOrgUnitId] = useState('')
  const [rentalName, setRentalName] = useState('')
  const [rentalSerial, setRentalSerial] = useState('')
  const [rentalProvider, setRentalProvider] = useState('')
  const [choices, setChoices] = useState<Choice[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const lookup =
    targetMode === 'rental'
      ? 'equipment-rental-inspection-types'
      : 'equipment-item-scheduled-inspection-types'
  const contextId = targetMode === 'registered' ? itemId : ''
  const ready = targetMode === 'registered' ? Boolean(itemId) : rentalName.trim().length > 0

  // Load the eligible checks whenever the subject changes. Abort on change so a
  // slow response for a previous unit can't overwrite the current one.
  useEffect(() => {
    if (targetMode === 'registered' && !itemId) {
      setChoices([])
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({ lookup })
    if (contextId) params.set('contextId', contextId)
    fetch(`/api/picker-options?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { options: [] }))
      .then((data: { options?: Choice[] }) => setChoices(data.options ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setChoices([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [lookup, contextId, itemId, targetMode])

  function startInspection(typeId: string) {
    if (pending) return
    setPendingId(typeId)
    const fd = new FormData()
    fd.set('targetMode', targetMode)
    fd.set('equipmentItemId', itemId)
    fd.set('typeId', typeId)
    fd.set('siteOrgUnitId', siteOrgUnitId)
    fd.set('rentalName', rentalName)
    fd.set('rentalSerial', rentalSerial)
    fd.set('rentalProvider', rentalProvider)
    if (returnTo) fd.set('returnTo', returnTo)
    start(async () => {
      await startEquipmentInspection(fd)
    })
  }

  // A schedule's "Start" link named one inspection; float it to the top and
  // mark it rather than auto-starting, so a stray back-navigation can't create
  // a record without a deliberate tap.
  const picked = initialType?.value
  const filtered = (
    query.trim()
      ? choices.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()))
      : choices
  )
    .slice()
    .sort((a, b) => (a.value === picked ? -1 : b.value === picked ? 1 : 0))

  return (
    <div className="space-y-4">
      {lockedItem ? null : (
        <div className="space-y-2">
          <Label>
            <GeneratedText id="m_13d280882bc797" />
          </Label>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['registered', 'rental'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTargetMode(mode)}
                className={
                  targetMode === mode
                    ? 'rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'rounded-md px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300'
                }
              >
                {mode === 'registered' ? (
                  <GeneratedText id="m_1145902d32ac68" />
                ) : (
                  <GeneratedText id="m_03bcd05f089364" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {targetMode === 'registered' ? (
        lockedItem ? null : (
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1fb2813300fb71" />
            </Label>
            <RemoteSearchSelect
              lookup="equipment-inspection-items"
              value={itemId}
              initialOption={initialItem}
              onChange={setItemId}
              placeholder={tGenerated('m_115f6cd16bb283')}
              searchPlaceholder={tGenerated('m_05b2636288d921')}
              sheetTitle="Select equipment"
              ariaLabel="Equipment item"
            />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rentalName">
              <GeneratedText id="m_178a4669441c00" />
            </Label>
            <Input
              id="rentalName"
              value={rentalName}
              onChange={(e) => setRentalName(e.currentTarget.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rentalSerial">
              <GeneratedText id="m_0240a6c1ede8d7" />
            </Label>
            <Input
              id="rentalSerial"
              value={rentalSerial}
              onChange={(e) => setRentalSerial(e.currentTarget.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rentalProvider">
              <GeneratedText id="m_19500f7c2dec27" />
            </Label>
            <Input
              id="rentalProvider"
              value={rentalProvider}
              onChange={(e) => setRentalProvider(e.currentTarget.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              <GeneratedText id="m_055f11420b2da4" />
            </Label>
            {/* Same Locations list journals and hazard assessments use, so a
                rental can be booked against the customer it works for. */}
            <RemoteSearchSelect
              lookup="equipment-inspection-sites"
              value={siteOrgUnitId}
              onChange={setSiteOrgUnitId}
              placeholder={tGenerated('m_0616639a1daeee')}
              searchPlaceholder={tGenerated('m_1931aa93098220')}
              sheetTitle="Location"
              ariaLabel="Location"
            />
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Label>
          <GeneratedText id="m_102414366b6321" />
        </Label>

        <GeneratedValue
          value={
            choices.length > 6 ? (
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tGenerated('m_18e2494ecfa1b5')}
                  className="pl-9"
                />
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            !ready ? (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
                <GeneratedText id="m_17dbb904fe8283" />
              </p>
            ) : loading ? (
              <p className="flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
                <Loader2 size={15} className="animate-spin" />
              </p>
            ) : filtered.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
                <GeneratedText id="m_1d6b1d880eeeae" />
              </p>
            ) : (
              <ul className="space-y-2">
                <GeneratedValue
                  value={filtered.map((c) => {
                    const isPending = pendingId === c.value
                    return (
                      <li key={c.value}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => startInspection(c.value)}
                          className={cn(
                            'group flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-all hover:border-teal-400 hover:shadow-sm disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700',
                            isPending && 'border-teal-500 ring-2 ring-teal-500/30',
                            !isPending && c.value === picked && 'border-teal-400',
                          )}
                        >
                          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                            <GeneratedValue
                              value={
                                isPending ? (
                                  <Loader2 size={16} className="animate-spin" />
                                ) : (
                                  <ClipboardCheck size={16} />
                                )
                              }
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                              <GeneratedValue value={c.label} />
                            </span>
                            <GeneratedValue
                              value={
                                c.hint ? (
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    <Chip label={c.hint} />
                                  </span>
                                ) : null
                              }
                            />
                          </span>
                        </button>
                      </li>
                    )
                  })}
                />
              </ul>
            )
          }
        />
      </div>
    </div>
  )
}
