'use client'

// Risk matrix editor. Authoring model: pick the axis sizes, name each level, and
// tune a handful of risk bands (label + colour + the score they kick in at). The
// live preview is the exact grid crews see on an assessment, built through the
// same buildMatrix() the renderers use, so what you see is what saves.

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Minus, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from '@beaconhs/ui'
import {
  DEFAULT_RISK_MATRIX,
  MAX_AXIS,
  MIN_AXIS,
  RiskMatrixGrid,
  bandsFromMatrix,
  buildMatrix,
  type RiskBandDef,
  type RiskMatrixConfig,
} from '@/components/risk-matrix'
import { saveRiskMatrix } from './_actions'
import { RISK_MATRIX_LABEL_MAX } from './_policy'

type Band = RiskBandDef & { id: string }

const NEW_BAND_COLOR = '#64748b' // slate-500

function withIds(bands: RiskBandDef[], nextId: () => string): Band[] {
  return bands.map((b) => ({ ...b, id: nextId() }))
}

export function RiskMatrixEditor({ initial }: { initial: RiskMatrixConfig }) {
  const router = useRouter()
  // New band ids are minted only in event handlers (add / reset), never during
  // render — so the initial bands take deterministic index ids.
  const idRef = useRef(0)
  const newId = () => `band-${idRef.current++}`

  const [sevLabels, setSevLabels] = useState<string[]>(() => [...initial.axes.severity.values])
  const [likLabels, setLikLabels] = useState<string[]>(() => [...initial.axes.likelihood.values])
  const [bands, setBands] = useState<Band[]>(() =>
    bandsFromMatrix(initial).map((b, i) => ({ ...b, id: `init-${i}` })),
  )
  const [pending, startTransition] = useTransition()

  const matrix = useMemo(
    () => buildMatrix(sevLabels, likLabels, bands),
    [sevLabels, likLabels, bands],
  )
  const maxScore = sevLabels.length * likLabels.length

  // Baseline to diff against — both sides run through buildMatrix so an untouched
  // editor reads as "saved" even if the stored matrix was a hair off-normal.
  const [savedKey, setSavedKey] = useState<string>(() =>
    JSON.stringify(
      buildMatrix(
        initial.axes.severity.values,
        initial.axes.likelihood.values,
        bandsFromMatrix(initial),
      ),
    ),
  )
  const dirty = JSON.stringify(matrix) !== savedKey

  // --- axis mutations ---
  const setLabel = (axis: 'sev' | 'lik', i: number, value: string) =>
    (axis === 'sev' ? setSevLabels : setLikLabels)((prev) =>
      prev.map((v, idx) => (idx === i ? value : v)),
    )

  const resize = (axis: 'sev' | 'lik', delta: number) => {
    const apply = (prev: string[]) => {
      const next = prev.length + delta
      if (next < MIN_AXIS || next > MAX_AXIS) return prev
      return delta > 0 ? [...prev, ''] : prev.slice(0, next)
    }
    if (axis === 'sev') setSevLabels(apply)
    else setLikLabels(apply)
  }

  // --- band mutations ---
  const updateBand = (id: string, patch: Partial<RiskBandDef>) =>
    setBands((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  const removeBand = (id: string) =>
    setBands((prev) => (prev.length <= 1 ? prev : prev.filter((b) => b.id !== id)))
  const addBand = () =>
    setBands((prev) => {
      const top = Math.max(0, ...prev.map((b) => b.minScore))
      return [
        ...prev,
        {
          id: newId(),
          label: 'New band',
          color: NEW_BAND_COLOR,
          minScore: Math.min(top + 1, maxScore),
        },
      ]
    })

  const reset = () => {
    setSevLabels([...DEFAULT_RISK_MATRIX.axes.severity.values])
    setLikLabels([...DEFAULT_RISK_MATRIX.axes.likelihood.values])
    setBands(withIds(bandsFromMatrix(DEFAULT_RISK_MATRIX), newId))
  }

  const save = () =>
    startTransition(async () => {
      const res = await saveRiskMatrix(matrix)
      if (res.ok) {
        setSavedKey(JSON.stringify(matrix))
        toast.success('Risk matrix saved')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })

  const sortedBands = [...bands].sort((a, b) => a.minScore - b.minScore)

  return (
    <div className="space-y-5 pb-20">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Live preview */}
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>The grid as it appears on every assessment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <RiskMatrixGrid matrix={matrix} />
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {sortedBands.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"
                >
                  <span
                    className="size-3 rounded-sm ring-1 ring-black/10"
                    style={{ background: b.color }}
                  />
                  <span className="font-medium">{b.label || 'Unnamed'}</span>
                  <span className="text-slate-400">≥ {b.minScore}</span>
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Score = severity × likelihood, running 1–{maxScore}. Each cell takes the colour of the
              highest band its score reaches.
            </p>
          </CardContent>
        </Card>

        {/* Scales */}
        <Card>
          <CardHeader>
            <CardTitle>Scales</CardTitle>
            <CardDescription>Name each level and set how many the matrix uses.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Stepper
                label="Severity levels"
                value={sevLabels.length}
                onDec={() => resize('sev', -1)}
                onInc={() => resize('sev', 1)}
                min={MIN_AXIS}
                max={MAX_AXIS}
              />
              <Stepper
                label="Likelihood levels"
                value={likLabels.length}
                onDec={() => resize('lik', -1)}
                onInc={() => resize('lik', 1)}
                min={MIN_AXIS}
                max={MAX_AXIS}
              />
            </div>

            <AxisLabels
              title="Severity"
              prefix="S"
              labels={sevLabels}
              onChange={(i, v) => setLabel('sev', i, v)}
            />
            <AxisLabels
              title="Likelihood"
              prefix="L"
              labels={likLabels}
              onChange={(i, v) => setLabel('lik', i, v)}
            />
          </CardContent>
        </Card>
      </div>

      {/* Bands */}
      <Card>
        <CardHeader>
          <CardTitle>Risk bands</CardTitle>
          <CardDescription>
            Set the label and colour for each tier, and the score it starts at. The lowest band
            covers everything beneath the next threshold.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {sortedBands.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="space-y-1.5">
                  <Label className="text-xs">Colour</Label>
                  <input
                    type="color"
                    aria-label={`${b.label || 'Band'} colour`}
                    value={b.color}
                    onChange={(e) => updateBand(b.id, { color: e.target.value })}
                    className="h-9 w-12 cursor-pointer rounded-md border border-slate-300 bg-transparent p-0.5 dark:border-slate-700"
                  />
                </div>
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label className="text-xs">Label</Label>
                  <Input
                    value={b.label}
                    maxLength={RISK_MATRIX_LABEL_MAX}
                    onChange={(e) => updateBand(b.id, { label: e.target.value })}
                    placeholder="e.g. High"
                  />
                </div>
                <div className="w-32 space-y-1.5">
                  <Label className="text-xs">Applies from score</Label>
                  <Input
                    type="number"
                    min={1}
                    max={maxScore}
                    value={b.minScore}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      if (Number.isFinite(n))
                        updateBand(b.id, { minScore: Math.min(Math.max(n, 1), 999) })
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${b.label || 'band'}`}
                  disabled={bands.length <= 1}
                  onClick={() => removeBand(b.id)}
                  className="text-slate-500 hover:text-red-600"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addBand}>
            <Plus size={14} /> Add band
          </Button>
        </CardContent>
      </Card>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={pending}>
              <RotateCcw size={14} /> Reset to default
            </Button>
            <Button type="button" onClick={save} disabled={pending || !dirty}>
              {pending ? 'Saving…' : 'Save matrix'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
  min,
  max,
}: {
  label: string
  value: number
  onDec: () => void
  onInc: () => void
  min: number
  max: number
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={onDec}
        >
          <Minus size={14} />
        </Button>
        <span className="w-8 text-center text-sm font-semibold tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={onInc}
        >
          <Plus size={14} />
        </Button>
      </div>
    </div>
  )
}

function AxisLabels({
  title,
  prefix,
  labels,
  onChange,
}: {
  title: string
  prefix: string
  labels: string[]
  onChange: (i: number, value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{title} levels</Label>
      <div className="space-y-1.5">
        {labels.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500',
                'dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              {prefix}
              {i + 1}
            </span>
            <Input
              value={label}
              maxLength={RISK_MATRIX_LABEL_MAX}
              aria-label={`${title} level ${i + 1}`}
              onChange={(e) => onChange(i, e.target.value)}
              placeholder={`${title} ${i + 1}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
