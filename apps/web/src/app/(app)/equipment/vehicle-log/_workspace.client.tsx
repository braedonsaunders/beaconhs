'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  Settings2,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { Badge, Button, Input, Select, Textarea, cn } from '@beaconhs/ui'
import type {
  ApplyWorkActivityInput,
  ApplyWorkActivityResult,
  SaveVehicleLogEntryInput,
  VehicleLogEntryDraft,
  VehicleLogMode,
  VehicleLogWorkspace,
} from './_service'

type SaveAction = (
  input: SaveVehicleLogEntryInput,
) => Promise<{ ok: true; entry: VehicleLogEntryDraft } | { ok: false; error: string }>
type ApplyAction = (
  input: ApplyWorkActivityInput,
) => Promise<{ ok: true; result: ApplyWorkActivityResult } | { ok: false; error: string }>
type DeleteMonthAction = (
  input: ApplyWorkActivityInput,
) => Promise<{ ok: true; deleted: number } | { ok: false; error: string }>

type RowState = 'idle' | 'saving' | 'saved' | 'error'

function numberValue(value: number | null | undefined) {
  return value == null ? '' : String(value)
}

function nullableInt(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function cloneDraft(entry: VehicleLogEntryDraft, mode: VehicleLogMode): VehicleLogEntryDraft {
  return { ...entry, entryMode: mode }
}

function hasMeaningfulDraft(entry: VehicleLogEntryDraft) {
  return Boolean(
    entry.siteOrgUnitId ||
    entry.otherDestination ||
    entry.hoursOnSite ||
    entry.manpowerCount != null ||
    entry.notes ||
    entry.startOdometer != null ||
    entry.endOdometer != null ||
    entry.businessKm != null ||
    entry.personalKm != null,
  )
}

function statusBadge(status: VehicleLogEntryDraft['importStatus']) {
  if (status === 'conflict') return <Badge variant="warning">Conflict</Badge>
  if (status === 'imported') return <Badge variant="success">Imported</Badge>
  if (status === 'suggested') return <Badge variant="secondary">Suggested</Badge>
  if (status === 'manual') return <Badge variant="outline">Manual</Badge>
  return null
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`
}

export function VehicleLogWorkspaceClient({
  workspace,
  saveAction,
  applyAction,
  deleteMonthAction,
}: {
  workspace: VehicleLogWorkspace
  saveAction: SaveAction
  applyAction: ApplyAction
  deleteMonthAction: DeleteMonthAction
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, VehicleLogEntryDraft>>({})
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [actionResult, setActionResult] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        workspace.rows.map((row) => [row.date, cloneDraft(row.entry, workspace.mode)]),
      ),
    )
    setRowStates({})
    setRowErrors({})
    setActionResult(null)
  }, [workspace])

  const activeDriver = workspace.drivers.find((d) => d.id === workspace.selectedDriverId)
  const activeVehicle = workspace.vehicles.find((v) => v.id === workspace.selectedEquipmentId)

  const baseParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('month', workspace.month.key)
    if (workspace.selectedDriverId) params.set('driver', workspace.selectedDriverId)
    if (workspace.selectedEquipmentId) params.set('vehicle', workspace.selectedEquipmentId)
    params.set('mode', workspace.mode)
    return params
  }, [workspace])

  function navigate(next: Partial<Record<'month' | 'driver' | 'vehicle' | 'mode', string>>) {
    const params = new URLSearchParams(baseParams)
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    router.push(`/equipment/vehicle-log?${params.toString()}`)
  }

  function updateDraft(date: string, patch: Partial<VehicleLogEntryDraft>) {
    setDrafts((current) => {
      const base = current[date] ?? workspace.rows.find((r) => r.date === date)?.entry
      if (!base) return current
      return {
        ...current,
        [date]: { ...base, ...patch },
      }
    })
  }

  async function saveRow(date: string) {
    const draft = drafts[date]
    if (!draft || !workspace.selectedDriverId || !workspace.selectedEquipmentId) return
    if (!draft.id && !hasMeaningfulDraft(draft)) return
    setRowStates((s) => ({ ...s, [date]: 'saving' }))
    setRowErrors((s) => ({ ...s, [date]: '' }))
    const res = await saveAction({
      equipmentItemId: workspace.selectedEquipmentId,
      driverPersonId: workspace.selectedDriverId,
      entryDate: date,
      entryMode: workspace.mode,
      startOdometer: draft.startOdometer,
      endOdometer: draft.endOdometer,
      businessKm: draft.businessKm,
      personalKm: draft.personalKm,
      siteOrgUnitId: draft.siteOrgUnitId,
      otherDestination: draft.otherDestination,
      hoursOnSite: draft.hoursOnSite,
      manpowerCount: draft.manpowerCount,
      notes: draft.notes,
    })
    if (res.ok) {
      setDrafts((current) => ({ ...current, [date]: res.entry }))
      setRowStates((s) => ({ ...s, [date]: 'saved' }))
      router.refresh()
    } else {
      setRowStates((s) => ({ ...s, [date]: 'error' }))
      setRowErrors((s) => ({ ...s, [date]: res.error }))
    }
  }

  function applyActivity() {
    if (!workspace.selectedDriverId || !workspace.selectedEquipmentId) {
      setActionResult('Choose a driver and vehicle first.')
      return
    }
    if (workspace.totals.workActivityDays === 0) {
      setActionResult(importHint)
      return
    }
    setActionResult(null)
    startTransition(async () => {
      const res = await applyAction({
        equipmentItemId: workspace.selectedEquipmentId,
        driverPersonId: workspace.selectedDriverId,
        month: workspace.month.key,
      })
      if (res.ok) {
        const { created, updated, conflicts, skipped } = res.result
        const changed = created + updated + conflicts
        setActionResult(
          changed === 0
            ? 'No matching work activity was found.'
            : `${created} added · ${updated} refreshed · ${conflicts} conflicts${
                skipped ? ` · ${skipped} skipped` : ''
              }`,
        )
        router.refresh()
      } else {
        setActionResult(res.error)
      }
    })
  }

  function deleteMonth() {
    if (!workspace.selectedDriverId || !workspace.selectedEquipmentId) return
    const label = `${activeDriver?.label ?? 'driver'} / ${activeVehicle?.hint ?? activeVehicle?.label}`
    if (!window.confirm(`Delete ${workspace.month.label} entries for ${label}?`)) return
    setActionResult(null)
    startTransition(async () => {
      const res = await deleteMonthAction({
        equipmentItemId: workspace.selectedEquipmentId,
        driverPersonId: workspace.selectedDriverId,
        month: workspace.month.key,
      })
      if (res.ok) {
        setActionResult(`${res.deleted} deleted`)
        router.refresh()
      } else {
        setActionResult(res.error)
      }
    })
  }

  const canEdit = Boolean(workspace.selectedDriverId && workspace.selectedEquipmentId)
  const hasActiveSource = workspace.workActivity.activeSourceCount > 0
  const importSourceDays = workspace.totals.workActivityDays
  const importHint = !workspace.selectedDriverId
    ? 'Choose a driver first.'
    : !workspace.selectedEquipmentId
      ? 'Choose a vehicle first.'
      : importSourceDays > 0
        ? `${plural(importSourceDays, 'source day')} ready.`
        : hasActiveSource
          ? 'No work activity for this driver/month.'
          : workspace.workActivity.monthRowCount > 0
            ? 'No matching work activity for this driver/month.'
            : 'No work activity source has run for this month.'
  const sourceBadge = hasActiveSource
    ? `${plural(workspace.workActivity.activeSourceCount, 'source')}`
    : 'No source'
  const activityBadge = canEdit
    ? `${plural(importSourceDays, 'source day')}`
    : `${plural(workspace.workActivity.monthRowCount, 'source row')}`
  const canImport = canEdit && importSourceDays > 0 && !pending
  const emptyMessage =
    workspace.drivers.length === 0 || workspace.vehicles.length === 0
      ? 'Add an active driver and vehicle to start logging.'
      : 'Choose a driver and vehicle to start logging.'

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 border-b border-slate-100 p-3 lg:grid-cols-[1.1fr_1.1fr_0.8fr_auto] dark:border-slate-800">
          <div className="space-y-1">
            <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Driver
            </div>
            <Select
              value={workspace.selectedDriverId}
              onChange={(e) => navigate({ driver: e.currentTarget.value })}
            >
              <option value="">Choose driver</option>
              {workspace.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.label}
                  {driver.hint ? ` · ${driver.hint}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Vehicle
            </div>
            <Select
              value={workspace.selectedEquipmentId}
              onChange={(e) => navigate({ vehicle: e.currentTarget.value })}
            >
              <option value="">Choose vehicle</option>
              {workspace.vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.hint ? `${vehicle.hint} · ` : ''}
                  {vehicle.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Mode
            </div>
            <Select
              value={workspace.mode}
              onChange={(e) => navigate({ mode: e.currentTarget.value })}
            >
              <option value="destination">Destination</option>
              <option value="odometer">Odometer</option>
            </Select>
          </div>
          <div className="flex flex-wrap items-end justify-start gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyActivity}
              disabled={!canImport}
              title={importHint}
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <WandSparkles size={14} />
              )}
              Import
            </Button>
            {workspace.workActivity.canConfigureSources && !hasActiveSource ? (
              <Link
                href="/admin/integrations"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800/60"
              >
                <Settings2 size={14} />
                Configure
              </Link>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={deleteMonth}
              disabled={!canEdit || pending}
            >
              <Trash2 size={14} />
              Delete month
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate({ month: workspace.month.previousKey })}
            >
              <ChevronLeft size={14} />
            </Button>
            <div className="flex h-8 min-w-44 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              <CalendarDays size={14} />
              {workspace.month.label}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate({ month: workspace.month.nextKey })}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{workspace.totals.loggedDays} logged</Badge>
            <Badge variant={workspace.totals.pendingActivityDays ? 'warning' : 'outline'}>
              {workspace.totals.pendingActivityDays} pending
            </Badge>
            <Badge variant={workspace.totals.conflictDays ? 'warning' : 'outline'}>
              {workspace.totals.conflictDays} conflicts
            </Badge>
            <Badge variant="outline">{workspace.totals.totalKm} km</Badge>
            <Badge variant={hasActiveSource ? 'outline' : 'warning'}>{sourceBadge}</Badge>
            <Badge variant={importSourceDays ? 'secondary' : 'outline'}>{activityBadge}</Badge>
            {actionResult ? (
              <span className="text-slate-500 dark:text-slate-400">{actionResult}</span>
            ) : !canImport ? (
              <span className="text-slate-500 dark:text-slate-400">{importHint}</span>
            ) : null}
          </div>
        </div>
      </div>

      {workspace.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[1210px] border-collapse text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="sticky left-0 z-20 w-24 bg-slate-50 px-3 py-2 text-left font-medium dark:bg-slate-950">
                  Date
                </th>
                <th className="w-56 px-3 py-2 text-left font-medium">Work activity</th>
                <th className="w-52 px-3 py-2 text-left font-medium">Site</th>
                {workspace.mode === 'destination' ? (
                  <>
                    <th className="w-28 px-2 py-2 text-right font-medium">Business</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">Personal</th>
                  </>
                ) : (
                  <>
                    <th className="w-28 px-2 py-2 text-right font-medium">Start</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">End</th>
                  </>
                )}
                <th className="w-24 px-2 py-2 text-right font-medium">Hours</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Crew</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Total</th>
                <th className="w-60 px-3 py-2 text-left font-medium">Notes</th>
                <th className="w-28 px-3 py-2 text-left font-medium">State</th>
                <th className="w-12 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {workspace.rows.map((row) => {
                const draft = drafts[row.date] ?? cloneDraft(row.entry, workspace.mode)
                const state = rowStates[row.date] ?? 'idle'
                const total =
                  workspace.mode === 'odometer'
                    ? draft.startOdometer != null &&
                      draft.endOdometer != null &&
                      draft.endOdometer >= draft.startOdometer
                      ? draft.endOdometer - draft.startOdometer
                      : null
                    : draft.businessKm != null || draft.personalKm != null
                      ? (draft.businessKm ?? 0) + (draft.personalKm ?? 0)
                      : null
                return (
                  <tr
                    key={row.date}
                    className={cn(
                      'border-t border-slate-100 dark:border-slate-800',
                      row.isWeekend && 'bg-slate-50/60 dark:bg-slate-950/50',
                    )}
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 align-top">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {row.day}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {row.weekday}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.activity ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={draft.id ? 'secondary' : 'warning'}>
                              {draft.id ? 'Matched' : 'Ready'}
                            </Badge>
                            {row.activity.count > 1 ? (
                              <span className="text-xs text-slate-500">
                                {row.activity.count} items
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-slate-600 dark:text-slate-300">
                            {row.activity.sourceLabel ?? row.activity.siteName ?? 'Activity'}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {[
                              row.activity.hours ? `${row.activity.hours} h` : null,
                              row.activity.businessKm != null
                                ? `${row.activity.businessKm} km`
                                : null,
                              row.activity.siteName,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="space-y-1">
                        <Select
                          value={draft.siteOrgUnitId ?? ''}
                          onChange={(e) =>
                            updateDraft(row.date, { siteOrgUnitId: e.currentTarget.value || null })
                          }
                          onBlur={() => void saveRow(row.date)}
                          className="h-8 text-xs"
                        >
                          <option value="">—</option>
                          {workspace.sites.map((site) => (
                            <option key={site.id} value={site.id}>
                              {site.label}
                            </option>
                          ))}
                        </Select>
                        <Input
                          value={draft.otherDestination ?? ''}
                          onChange={(e) =>
                            updateDraft(row.date, { otherDestination: e.currentTarget.value })
                          }
                          onBlur={() => void saveRow(row.date)}
                          placeholder="Other"
                          className="h-8 text-xs"
                        />
                      </div>
                    </td>
                    {workspace.mode === 'destination' ? (
                      <>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={numberValue(draft.businessKm)}
                            onChange={(e) =>
                              updateDraft(row.date, {
                                businessKm: nullableInt(e.currentTarget.value),
                              })
                            }
                            onBlur={() => void saveRow(row.date)}
                            className="h-8 text-right text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={numberValue(draft.personalKm)}
                            onChange={(e) =>
                              updateDraft(row.date, {
                                personalKm: nullableInt(e.currentTarget.value),
                              })
                            }
                            onBlur={() => void saveRow(row.date)}
                            className="h-8 text-right text-xs"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={numberValue(draft.startOdometer)}
                            onChange={(e) =>
                              updateDraft(row.date, {
                                startOdometer: nullableInt(e.currentTarget.value),
                              })
                            }
                            onBlur={() => void saveRow(row.date)}
                            className="h-8 text-right text-xs"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={numberValue(draft.endOdometer)}
                            onChange={(e) =>
                              updateDraft(row.date, {
                                endOdometer: nullableInt(e.currentTarget.value),
                              })
                            }
                            onBlur={() => void saveRow(row.date)}
                            className="h-8 text-right text-xs"
                          />
                        </td>
                      </>
                    )}
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="number"
                        min="0"
                        step="0.25"
                        value={draft.hoursOnSite ?? ''}
                        onChange={(e) =>
                          updateDraft(row.date, { hoursOnSite: e.currentTarget.value })
                        }
                        onBlur={() => void saveRow(row.date)}
                        className="h-8 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={numberValue(draft.manpowerCount)}
                        onChange={(e) =>
                          updateDraft(row.date, {
                            manpowerCount: nullableInt(e.currentTarget.value),
                          })
                        }
                        onBlur={() => void saveRow(row.date)}
                        className="h-8 text-right text-xs"
                      />
                    </td>
                    <td className="px-2 py-2 text-right align-top">
                      <div className="h-8 rounded-md bg-slate-50 px-2 py-1.5 font-medium text-slate-700 tabular-nums dark:bg-slate-950 dark:text-slate-200">
                        {total ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Textarea
                        value={draft.notes ?? ''}
                        onChange={(e) => updateDraft(row.date, { notes: e.currentTarget.value })}
                        onBlur={() => void saveRow(row.date)}
                        rows={1}
                        className="min-h-8 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-col items-start gap-1">
                        {state === 'saving' ? (
                          <Badge variant="secondary">
                            <Loader2 size={11} className="mr-1 animate-spin" />
                            Saving
                          </Badge>
                        ) : state === 'saved' ? (
                          <Badge variant="success">
                            <Check size={11} className="mr-1" />
                            Saved
                          </Badge>
                        ) : state === 'error' ? (
                          <Badge variant="destructive">
                            <AlertTriangle size={11} className="mr-1" />
                            Error
                          </Badge>
                        ) : (
                          statusBadge(draft.importStatus)
                        )}
                        {rowErrors[row.date] ? (
                          <span className="max-w-28 text-[11px] leading-tight text-red-600">
                            {rowErrors[row.date]}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => void saveRow(row.date)}
                        disabled={!canEdit || state === 'saving'}
                        title="Save row"
                      >
                        <Save size={14} />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-medium dark:border-slate-800 dark:bg-slate-950">
              <tr>
                <td className="sticky left-0 bg-slate-50 px-3 py-2 dark:bg-slate-950" colSpan={3}>
                  Totals
                </td>
                {workspace.mode === 'destination' ? (
                  <>
                    <td className="px-2 py-2 text-right">{workspace.totals.businessKm}</td>
                    <td className="px-2 py-2 text-right">{workspace.totals.personalKm}</td>
                  </>
                ) : (
                  <>
                    <td className="px-2 py-2 text-right">—</td>
                    <td className="px-2 py-2 text-right">—</td>
                  </>
                )}
                <td className="px-2 py-2 text-right">{workspace.totals.hoursOnSite.toFixed(2)}</td>
                <td className="px-2 py-2 text-right">{workspace.totals.crewCount}</td>
                <td className="px-2 py-2 text-right">{workspace.totals.totalKm}</td>
                <td className="px-3 py-2" colSpan={3}>
                  <Link
                    href="/reports/definitions/new?entity=vehicle_log_monthly"
                    className="text-xs text-teal-700 hover:underline dark:text-teal-300"
                  >
                    Open in reports
                  </Link>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
