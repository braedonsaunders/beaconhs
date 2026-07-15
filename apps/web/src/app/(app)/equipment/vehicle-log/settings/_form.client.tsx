'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Vehicle log settings — tenant entry-mode configuration + per-driver default
// overrides. Mode changes save explicitly; driver overrides apply immediately.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { Button, Card, CardContent, cn } from '@beaconhs/ui'
import type { VehicleLogEnabledModes } from '@beaconhs/db/schema'
import { saveVehicleLogSettings, setDriverDefaultMode } from './_actions'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'

type PersonRow = {
  id: string
  label: string
  hint?: string
  mode: 'destination' | 'odometer' | null
}

const MODE_CHOICES: { value: VehicleLogEnabledModes; label: string; desc: string }[] = [
  {
    value: 'both',
    label: 'Both modes',
    desc: 'Drivers can switch between destination and odometer logging.',
  },
  {
    value: 'destination',
    label: 'Destination only',
    desc: 'Customer / site, other destination, business and personal km.',
  },
  {
    value: 'odometer',
    label: 'Odometer only',
    desc: 'Start and end odometer readings with a personal km column.',
  },
]

const DEFAULT_CHOICES: { value: 'destination' | 'odometer'; label: string }[] = [
  { value: 'destination', label: 'Destination' },
  { value: 'odometer', label: 'Odometer' },
]

export function VehicleLogSettingsForm({
  initial,
  overrides,
  total,
  filteredTotal,
  page,
  perPage,
  currentParams,
}: {
  initial: { enabledModes: VehicleLogEnabledModes; defaultMode: 'destination' | 'odometer' }
  overrides: PersonRow[]
  total: number
  filteredTotal: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [enabledModes, setEnabledModes] = useState<VehicleLogEnabledModes>(initial.enabledModes)
  const [defaultMode, setDefaultMode] = useState(initial.defaultMode)
  const [saving, startSaving] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [addPersonId, setAddPersonId] = useState('')
  const [addMode, setAddMode] = useState<'destination' | 'odometer'>('destination')
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  function save() {
    setError(tGeneratedValue(null))
    setSaved(false)
    startSaving(async () => {
      const res = await saveVehicleLogSettings({ enabledModes, defaultMode })
      if (res.ok) {
        setSaved(true)
        router.refresh()
      } else {
        setError(tGeneratedValue(res.error))
      }
    })
  }

  async function applyDriverMode(personId: string, mode: 'destination' | 'odometer' | null) {
    setRowError(null)
    setRowPending(personId)
    const res = await setDriverDefaultMode({ personId, mode })
    setRowPending(null)
    if (res.ok) {
      setAddPersonId('')
      router.refresh()
    } else {
      setRowError(res.error)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_0d4bee1cedf349" />
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_1614d39020bda1" />
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <GeneratedValue
              value={MODE_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => setEnabledModes(choice.value)}
                  aria-pressed={enabledModes === choice.value}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    enabledModes === choice.value
                      ? 'border-teal-500 bg-teal-50/60 dark:border-teal-600 dark:bg-teal-950/30'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      <GeneratedValue value={choice.label} />
                    </span>
                    <GeneratedValue
                      value={
                        enabledModes === choice.value ? (
                          <Check size={15} className="shrink-0 text-teal-600" />
                        ) : null
                      }
                    />
                  </div>
                  <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
                    <GeneratedValue value={choice.desc} />
                  </p>
                </button>
              ))}
            />
          </div>

          <GeneratedValue
            value={
              enabledModes === 'both' ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    <GeneratedText id="m_0ba9e9dd222cf9" />
                  </div>
                  <div className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
                    <GeneratedValue
                      value={DEFAULT_CHOICES.map((choice) => (
                        <button
                          key={choice.value}
                          type="button"
                          onClick={() => setDefaultMode(choice.value)}
                          className={cn(
                            'h-8 rounded-md px-3 text-sm font-medium transition-colors',
                            defaultMode === choice.value
                              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                          )}
                        >
                          <GeneratedValue value={choice.label} />
                        </button>
                      ))}
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_1fbcdaf546361d" />
                  </p>
                </div>
              ) : null
            }
          />

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <GeneratedValue
              value={
                error ? (
                  <span className="text-xs text-red-600">
                    <GeneratedValue value={error} />
                  </span>
                ) : null
              }
            />
            <GeneratedValue
              value={
                saved && !error ? (
                  <span className="inline-flex items-center gap-1 text-xs text-teal-600">
                    <Check size={13} /> <GeneratedText id="m_0a0569b726b225" />
                  </span>
                ) : null
              }
            />
            <Button type="button" onClick={save} disabled={saving}>
              <GeneratedValue
                value={saving ? <Loader2 size={14} className="animate-spin" /> : null}
              />
              <GeneratedText id="m_0bdcc953ae29cd" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <GeneratedValue
        value={
          enabledModes === 'both' ? (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <GeneratedText id="m_10d8bdd066b712" />
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    <GeneratedText id="m_0f9c03292740a3" />
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1 space-y-1">
                    <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      <GeneratedText id="m_12e926c9216094" />
                    </div>
                    <RemoteSearchSelect
                      lookup="vehicle-drivers"
                      value={addPersonId}
                      onChange={setAddPersonId}
                      placeholder={tGenerated('m_04419c4f635c1d')}
                      searchPlaceholder={tGenerated('m_1c51de60730f68')}
                      sheetTitle="Driver"
                      clearable
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                      <GeneratedText id="m_0ba9e9dd222cf9" />
                    </div>
                    <div className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
                      <GeneratedValue
                        value={DEFAULT_CHOICES.map((choice) => (
                          <button
                            key={choice.value}
                            type="button"
                            onClick={() => setAddMode(choice.value)}
                            className={cn(
                              'h-8 rounded-md px-3 text-sm font-medium transition-colors',
                              addMode === choice.value
                                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                            )}
                          >
                            <GeneratedValue value={choice.label} />
                          </button>
                        ))}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void applyDriverMode(addPersonId, addMode)}
                    disabled={!addPersonId || rowPending !== null}
                  >
                    <Plus size={14} />
                    <GeneratedText id="m_0ba5d52a9a9795" />
                  </Button>
                </div>
                <GeneratedValue
                  value={
                    rowError ? (
                      <p className="text-xs text-red-600">
                        <GeneratedValue value={rowError} />
                      </p>
                    ) : null
                  }
                />

                <TableToolbar>
                  <SearchInput placeholder={tGenerated('m_0be001e6f5d62b')} />
                  <FilterChips
                    basePath="/equipment/vehicle-log/settings"
                    currentParams={currentParams}
                    paramKey="overrideMode"
                    label={tGenerated('m_1ec1631f9ca88a')}
                    options={[
                      { value: 'destination', label: 'Destination' },
                      { value: 'odometer', label: 'Odometer' },
                    ]}
                  />
                  <FilterChips
                    basePath="/equipment/vehicle-log/settings"
                    currentParams={currentParams}
                    paramKey="sort"
                    label={tGenerated('m_126e942baf656b')}
                    defaultValue="name"
                    hideAll
                    options={[
                      { value: 'name', label: 'Driver name' },
                      { value: 'mode', label: 'Mode, then name' },
                    ]}
                  />
                </TableToolbar>

                <GeneratedValue
                  value={
                    overrides.length === 0 ? (
                      <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            total === 0 ? (
                              <GeneratedText id="m_0201ac414fc469" />
                            ) : (
                              <GeneratedText id="m_00bddbf801ed42" />
                            )
                          }
                        />
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                        <GeneratedValue
                          value={overrides.map((p) => (
                            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                                  <GeneratedValue value={p.label} />
                                </div>
                                <GeneratedValue
                                  value={
                                    p.hint ? (
                                      <div className="text-xs text-slate-400 dark:text-slate-500">
                                        {p.hint}
                                      </div>
                                    ) : null
                                  }
                                />
                              </div>
                              <div className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
                                <GeneratedValue
                                  value={DEFAULT_CHOICES.map((choice) => (
                                    <button
                                      key={choice.value}
                                      type="button"
                                      disabled={rowPending === p.id}
                                      onClick={() =>
                                        p.mode === choice.value
                                          ? undefined
                                          : void applyDriverMode(p.id, choice.value)
                                      }
                                      className={cn(
                                        'h-8 rounded-md px-2.5 text-xs font-medium transition-colors',
                                        p.mode === choice.value
                                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                                      )}
                                    >
                                      {choice.label}
                                    </button>
                                  ))}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title={tGenerated('m_0f246786dbed10')}
                                disabled={rowPending === p.id}
                                onClick={() => void applyDriverMode(p.id, null)}
                              >
                                <GeneratedValue
                                  value={
                                    rowPending === p.id ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <X size={14} />
                                    )
                                  }
                                />
                              </Button>
                            </li>
                          ))}
                        />
                      </ul>
                    )
                  }
                />
                <Pagination
                  basePath="/equipment/vehicle-log/settings"
                  currentParams={currentParams}
                  total={filteredTotal}
                  page={page}
                  perPage={perPage}
                />
              </CardContent>
            </Card>
          ) : null
        }
      />
    </div>
  )
}
