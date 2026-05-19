'use client'

// Client island for the new-assessment form. The server page renders the
// shell, the lookup dropdowns, and the submit button — this island owns the
// type-driven conditional fields and the live "required distance preview"
// that updates as the operator picks a kV / height.

import { useMemo, useState } from 'react'
import { Input, Label, Select } from '@beaconhs/ui'
import {
  computeRequiredDistanceM,
  extractVoltageFromDescription,
  formatDistance,
  SAFE_DISTANCE_TYPE_LABELS,
  type SafeDistanceType,
} from '../_lib'

const TYPE_OPTIONS = Object.entries(SAFE_DISTANCE_TYPE_LABELS).map(([v, l]) => ({
  value: v as SafeDistanceType,
  label: l,
}))

export function NewSafeDistanceForm({
  initialType = 'electrical',
}: {
  initialType?: string
}) {
  const startType = (TYPE_OPTIONS.find((o) => o.value === initialType)?.value ??
    'electrical') as SafeDistanceType
  const [type, setType] = useState<SafeDistanceType>(startType)
  const [voltage, setVoltage] = useState<string>('')
  const [height, setHeight] = useState<string>('')
  const [actual, setActual] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [manualRequired, setManualRequired] = useState<string>('')

  const parsedVoltage = voltage.trim() ? Number(voltage) : null
  const parsedHeight = height.trim() ? Number(height) : null
  const parsedActual = actual.trim() ? Number(actual) : null

  // For overhead_crane records that mention a voltage in the description we
  // pre-fill the kV input so the operator doesn't have to type it twice.
  const inferredVoltage = useMemo(
    () => (type === 'overhead_crane' ? extractVoltageFromDescription(description) : null),
    [type, description],
  )
  const effectiveVoltage = parsedVoltage ?? inferredVoltage

  const required = useMemo(() => {
    if (type === 'other') {
      const m = manualRequired.trim() ? Number(manualRequired) : null
      return m !== null && Number.isFinite(m) && m >= 0 ? m : null
    }
    return computeRequiredDistanceM({
      type,
      voltageKv: effectiveVoltage,
      heightM: parsedHeight,
    })
  }, [type, effectiveVoltage, parsedHeight, manualRequired])

  const complies =
    required !== null && parsedActual !== null && Number.isFinite(parsedActual)
      ? parsedActual >= required
      : null

  const showVoltage = type === 'electrical' || type === 'overhead_crane'
  const showHeight = type === 'drone'
  const showManualRequired = type === 'other'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="type">Assessment type</Label>
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as SafeDistanceType)}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sourceDescription">
          Source description{type === 'overhead_crane' ? ' (mention kV to prefill)' : ''}
        </Label>
        <Input
          id="sourceDescription"
          name="sourceDescription"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            type === 'electrical'
              ? 'e.g. Energised 13.8 kV overhead line, west pole'
              : type === 'drone'
                ? 'e.g. DJI Mavic 3 — survey over the south lay-down yard'
                : type === 'overhead_crane'
                  ? 'e.g. RT crane swing path under 13.8 kV transformer feed'
                  : type === 'vehicle'
                    ? 'e.g. Pickup parked near excavation edge'
                    : 'Describe the hazard'
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {showVoltage ? (
          <div className="space-y-2">
            <Label htmlFor="sourceVoltageKv">Source voltage (kV)</Label>
            <Input
              id="sourceVoltageKv"
              name="sourceVoltageKv"
              type="number"
              step="0.01"
              min="0"
              value={voltage}
              onChange={(e) => setVoltage(e.target.value)}
              placeholder={inferredVoltage ? String(inferredVoltage) : 'e.g. 13.8'}
            />
            {inferredVoltage !== null && !voltage.trim() ? (
              <p className="text-xs text-slate-500">
                Inferred from description: <strong>{inferredVoltage} kV</strong>. Type to
                override.
              </p>
            ) : null}
          </div>
        ) : (
          <input type="hidden" name="sourceVoltageKv" value="" />
        )}

        {showHeight ? (
          <div className="space-y-2">
            <Label htmlFor="heightM">Operating height (m)</Label>
            <Input
              id="heightM"
              name="heightM"
              type="number"
              step="0.1"
              min="0"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="e.g. 45"
            />
          </div>
        ) : (
          <input type="hidden" name="heightM" value="" />
        )}

        {showManualRequired ? (
          <div className="space-y-2">
            <Label htmlFor="requiredDistanceMOverride">Required distance (m)</Label>
            <Input
              id="requiredDistanceMOverride"
              name="requiredDistanceMOverride"
              type="number"
              step="0.01"
              min="0"
              value={manualRequired}
              onChange={(e) => setManualRequired(e.target.value)}
              placeholder="Manual minimum required"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="actualDistanceM">Actual measured distance (m)</Label>
          <Input
            id="actualDistanceM"
            name="actualDistanceM"
            type="number"
            step="0.01"
            min="0"
            required
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="e.g. 5.2"
          />
        </div>
      </div>

      <div
        className={`rounded-md border px-4 py-3 text-sm ${
          complies === true
            ? 'border-green-200 bg-green-50 text-green-900'
            : complies === false
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}
      >
        <div className="font-medium">
          {required === null
            ? 'Enter measurements to preview compliance'
            : complies === null
              ? `Required ≥ ${formatDistance(required)} — enter the actual distance`
              : complies
                ? `Compliant — ${formatDistance(parsedActual!)} ≥ ${formatDistance(required)}`
                : `Non-compliant — ${formatDistance(parsedActual!)} < ${formatDistance(required)}`}
        </div>
        {required !== null && type === 'electrical' && effectiveVoltage !== null ? (
          <p className="mt-1 text-xs">
            Based on the limits-of-approach row for &lt; {nextThreshold(effectiveVoltage)} kV.
          </p>
        ) : null}
      </div>
    </div>
  )
}

// Locate the smallest threshold strictly greater than the given kV — just for
// the human-readable footnote shown under the compliance preview.
function nextThreshold(kv: number): string | number {
  const order = [0.75, 150, 250, 550, 750]
  const next = order.find((t) => kv < t)
  return next ?? '∞'
}
