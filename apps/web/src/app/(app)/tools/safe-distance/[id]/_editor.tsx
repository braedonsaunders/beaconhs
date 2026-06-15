'use client'

// Calculator editor for one pressure-test record.
//
// Controlled inputs drive a LIVE client-side preview (via the shared pure
// `computeSafeDistance`), and the same fields submit through a plain <form>
// server action that recomputes authoritatively + persists. Pipe segments are
// kept in React state and serialised into a hidden field on submit.

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { PersonSelectField } from '@/components/person-select-field'
import { saveSafeDistanceRecordForm } from '../_actions'
import {
  computeSafeDistance,
  distanceUnitLabel,
  pressureUnitLabel,
  SAFE_DISTANCE_METHOD_LABELS,
  SAFE_DISTANCE_METHOD_SUBTITLES,
  SEGMENT_UNIT_LABELS,
  SEGMENT_UNITS,
  segmentVolumeM3,
  volumeUnitLabel,
  type SafeDistanceMethod,
  type SafeDistanceSegmentUnit,
  type SafeDistanceUnit,
  convertPressure,
} from '../_lib'

type SegRow = {
  key: string
  name: string
  unit: SafeDistanceSegmentUnit
  length: string
  diameter: string
}

type Option = { value: string; label: string; hint?: string }

export type SafeDistanceEditorProps = {
  record: {
    id: string
    name: string
    method: SafeDistanceMethod
    unit: SafeDistanceUnit
    testPressure: string
    description: string | null
    notes: string | null
    siteOrgUnitId: string | null
    supervisorTenantUserId: string | null
    operatorPersonId: string | null
    locked: boolean
  }
  initialSegments: Array<{
    name: string | null
    unit: SafeDistanceSegmentUnit
    lengthValue: string
    internalDiameter: string
  }>
  sites: Array<{ id: string; name: string }>
  supervisors: Option[]
  operators: Option[]
}

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `seg-${keyCounter}`
}

const M3_TO_FT3 = 35.3147

export function SafeDistanceEditor({
  record,
  initialSegments,
  sites,
  supervisors,
  operators,
}: SafeDistanceEditorProps) {
  const locked = record.locked
  const [name, setName] = useState(record.name)
  const [method, setMethod] = useState<SafeDistanceMethod>(record.method)
  const [unit, setUnit] = useState<SafeDistanceUnit>(record.unit)
  const [testPressure, setTestPressure] = useState(record.testPressure)
  const [description, setDescription] = useState(record.description ?? '')
  const [notes, setNotes] = useState(record.notes ?? '')
  const [segments, setSegments] = useState<SegRow[]>(
    initialSegments.map((s) => ({
      key: nextKey(),
      name: s.name ?? '',
      unit: s.unit,
      length: s.lengthValue,
      diameter: s.internalDiameter,
    })),
  )

  const results = useMemo(
    () =>
      computeSafeDistance({
        method,
        unit,
        testPressure: Number(testPressure) || 0,
        segments: segments.map((s) => ({
          unit: s.unit,
          lengthValue: Number(s.length) || 0,
          internalDiameter: Number(s.diameter) || 0,
        })),
      }),
    [method, unit, testPressure, segments],
  )

  const segmentsForSubmit = segments.map((s) => ({
    name: s.name || null,
    unit: s.unit,
    lengthValue: Number(s.length) || 0,
    internalDiameter: Number(s.diameter) || 0,
  }))

  function updateSegment(key: string, patch: Partial<SegRow>) {
    setSegments((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }
  function addSegment() {
    setSegments((prev) => [
      ...prev,
      { key: nextKey(), name: '', unit: 'inch', length: '', diameter: '' },
    ])
  }
  function removeSegment(key: string) {
    setSegments((prev) => prev.filter((s) => s.key !== key))
  }

  function onUnitChange(next: SafeDistanceUnit) {
    // Convert the pressure value so the same physical pressure is preserved
    // when toggling psi ↔ bar (mirrors the legacy tool).
    const current = Number(testPressure)
    if (Number.isFinite(current) && current !== 0) {
      setTestPressure(convertPressure(current, next).toFixed(2))
    }
    setUnit(next)
  }

  const distUnit = distanceUnitLabel(unit)
  const volUnit = volumeUnitLabel(unit)

  return (
    <form action={saveSafeDistanceRecordForm} className="space-y-6">
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="segments" value={JSON.stringify(segmentsForSubmit)} />

      <fieldset disabled={locked} className="space-y-6 disabled:opacity-70">
        <Card>
          <CardHeader>
            <CardTitle>System</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">System name</Label>
              <Input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="method-select">Calculation method</Label>
                <Select
                  id="method-select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as SafeDistanceMethod)}
                >
                  {(['nasa', 'asme', 'lloyds'] as const).map((m) => (
                    <option key={m} value={m}>
                      {SAFE_DISTANCE_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-select">Result unit</Label>
                <Select
                  id="unit-select"
                  value={unit}
                  onChange={(e) => onUnitChange(e.target.value as SafeDistanceUnit)}
                >
                  <option value="imperial">Imperial (psi / ft³ / ft)</option>
                  <option value="metric">Metric (bar / m³ / m)</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="testPressure">Test pressure ({pressureUnitLabel(unit)})</Label>
                <Input
                  id="testPressure"
                  name="testPressure"
                  type="number"
                  step="0.01"
                  min="0"
                  value={testPressure}
                  onChange={(e) => setTestPressure(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader>
            <CardTitle>Safe distance results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-4">
              <ResultBox
                label="Total volume"
                subtitle="System volume"
                value={`${results.totalVolume.toFixed(4)} ${volUnit}`}
              />
              <ResultBox
                label={SAFE_DISTANCE_METHOD_LABELS.nasa}
                subtitle={SAFE_DISTANCE_METHOD_SUBTITLES.nasa}
                value={`${results.nasa.toFixed(4)} ${distUnit}`}
                highlight={method === 'nasa'}
              />
              <ResultBox
                label={SAFE_DISTANCE_METHOD_LABELS.asme}
                subtitle={SAFE_DISTANCE_METHOD_SUBTITLES.asme}
                value={`${results.asme.toFixed(4)} ${distUnit}`}
                highlight={method === 'asme'}
              />
              <ResultBox
                label={SAFE_DISTANCE_METHOD_LABELS.lloyds}
                subtitle={SAFE_DISTANCE_METHOD_SUBTITLES.lloyds}
                value={`${results.lloyds.toFixed(4)} ${distUnit}`}
                highlight={method === 'lloyds'}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Live preview. Press <strong>Save</strong> to record the calculation — values are
              recomputed server-side on save.
            </p>
          </CardContent>
        </Card>

        {/* Pipe segments */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Piping system</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addSegment}>
                <Plus size={14} /> Add pipe
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {segments.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No pipe segments yet. Add one to build up the system volume.
              </p>
            ) : (
              segments.map((s, i) => {
                const volM3 = segmentVolumeM3(
                  Number(s.length) || 0,
                  Number(s.diameter) || 0,
                  s.unit,
                )
                const volDisplay = unit === 'imperial' ? volM3 * M3_TO_FT3 : volM3
                return (
                  <div
                    key={s.key}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Pipe {i + 1}
                        <span className="ml-2 font-normal">
                          {volDisplay.toFixed(4)} {volUnit}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSegment(s.key)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={s.name}
                          onChange={(e) => updateSegment(s.key, { name: e.target.value })}
                          placeholder="e.g. Header run"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Unit</Label>
                        <Select
                          value={s.unit}
                          onChange={(e) =>
                            updateSegment(s.key, {
                              unit: e.target.value as SafeDistanceSegmentUnit,
                            })
                          }
                        >
                          {SEGMENT_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {SEGMENT_UNIT_LABELS[u]}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Length</Label>
                          <Input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={s.length}
                            onChange={(e) => updateSegment(s.key, { length: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Int. Ø</Label>
                          <Input
                            type="number"
                            step="0.0001"
                            min="0"
                            value={s.diameter}
                            onChange={(e) => updateSegment(s.key, { diameter: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* People & site + notes */}
        <Card>
          <CardHeader>
            <CardTitle>People &amp; notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="siteOrgUnitId">Site</Label>
                <Select
                  id="siteOrgUnitId"
                  name="siteOrgUnitId"
                  defaultValue={record.siteOrgUnitId ?? ''}
                >
                  <option value="">— No site —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supervisorTenantUserId">Supervisor (sign-off)</Label>
                <PersonSelectField
                  name="supervisorTenantUserId"
                  defaultValue={record.supervisorTenantUserId ?? ''}
                  options={supervisors}
                  placeholder="Select a supervisor…"
                  clearable
                  emptyLabel="— None —"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="operatorPersonId">Operator</Label>
                <PersonSelectField
                  name="operatorPersonId"
                  defaultValue={record.operatorPersonId ?? ''}
                  options={operators}
                  placeholder="Select an operator…"
                  clearable
                  emptyLabel="— None —"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {!locked ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <SaveButton />
          </div>
        ) : null}
      </fieldset>
    </form>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save calculation'}
    </Button>
  )
}

function ResultBox({
  label,
  subtitle,
  value,
  highlight = false,
}: {
  label: string
  subtitle: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? 'border-teal-300 bg-teal-50 dark:border-teal-700 dark:bg-teal-950'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-[10px] tracking-wide text-slate-400 uppercase dark:text-slate-500">
        {subtitle}
      </div>
      <div
        className={`mt-1 text-lg font-semibold ${
          highlight ? 'text-teal-800 dark:text-teal-200' : 'text-slate-900 dark:text-slate-100'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
