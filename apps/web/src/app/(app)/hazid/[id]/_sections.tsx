// Client-only section helpers — split out so the page itself can stay almost
// entirely server-rendered while these widgets handle the interactive UI bits.
//
// As of the May-2026 wave, all sub-entity create/edit forms live in drawers
// (driven by ?drawer=… on the URL). The components in this file fall into
// three buckets:
//
//   - Drawer body forms        (Add* / Edit*)            — rendered inside an
//                              `<UrlDrawer>` on the detail page.
//   - Row display components   (TaskRow / HazardRow / …) — show the data,
//                              expose an "Edit" link that points to the
//                              edit-* drawer, plus inline reorder + delete
//                              buttons.
//   - Small button helpers     (MoveButton / DeleteButton / SubFormToggle).
//
// Each Add* form dispatches its server action via `useTransition` and on
// success navigates to the section's tab URL (drops the `?drawer=…` param)
// using `router.replace` — this closes the drawer because the page no longer
// matches the `drawer === '<key>'` predicate.

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'

// ============================================================================
// Helpers
// ============================================================================

function useDrawerClose(closeHref: string) {
  const router = useRouter()
  return () => router.replace(closeHref as any)
}

// ============================================================================
// Tasks
// ============================================================================

export function AddTaskDrawerBody({
  assessmentId,
  taskLibrary,
  closeHref,
  addAction,
}: {
  assessmentId: string
  taskLibrary: { id: string; name: string }[]
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [taskId, setTaskId] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [controls, setControls] = useState<string>('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!taskId && !description.trim()) {
      setErr('Pick a library task or enter an ad-hoc description.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    if (taskId) fd.set('taskId', taskId)
    if (description) fd.set('description', description)
    if (controls) fd.set('controls', controls)
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>From library</Label>
          <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">— ad-hoc task —</option>
            {taskLibrary.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">
            Picking a library task pre-fills the controls and links any
            associated hazards.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Ad-hoc description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short task name (required if not from library)"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Controls (override / extra)</Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={3}
            placeholder="Optional — overrides the library task's controls"
          />
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add task" />
    </>
  )
}

export function EditTaskDrawerBody({
  assessmentId,
  closeHref,
  row,
  taskName,
  hazardLookup,
  updateAction,
}: {
  assessmentId: string
  closeHref: string
  row: {
    id: string
    description: string | null
    controls: string | null
    hazardIds: string[]
  }
  taskName: string | null
  hazardLookup: Map<string, string>
  updateAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [description, setDescription] = useState<string>(row.description ?? '')
  const [controls, setControls] = useState<string>(row.controls ?? '')
  const [pending, start] = useTransition()

  function submit() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('description', description)
    fd.set('controls', controls)
    start(async () => {
      await updateAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        {taskName ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              From library
            </div>
            <div className="font-medium text-slate-900">{taskName}</div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>Description override</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={taskName ?? 'Task description'}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Controls</Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={4}
            placeholder="What controls / safe-work practices apply?"
          />
        </div>
        {row.hazardIds.length > 0 ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs">
            <div className="font-medium uppercase tracking-wide text-slate-500">
              Linked hazards
            </div>
            <div className="mt-1 text-slate-700">
              {row.hazardIds.map((id) => hazardLookup.get(id) ?? '?').join(', ')}
            </div>
          </div>
        ) : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Save" />
    </>
  )
}

export function TaskRow({
  row,
  assessmentId,
  totalCount,
  index,
  hazardLookup,
  taskName,
  basePath,
  activeTab,
  disabled,
  moveAction,
  deleteAction,
}: {
  row: {
    id: string
    description: string | null
    controls: string | null
    hazardIds: string[]
    entityOrder: number
  }
  assessmentId: string
  totalCount: number
  index: number
  hazardLookup: Map<string, string>
  taskName: string | null
  basePath: string
  activeTab: string
  disabled?: boolean
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Task #{index + 1}
          </div>
          <div className="font-medium text-slate-900">
            {taskName ?? row.description ?? (
              <span className="text-slate-400">— untitled —</span>
            )}
          </div>
          {row.description && taskName && row.description !== taskName ? (
            <div className="text-xs text-slate-500">Override: {row.description}</div>
          ) : null}
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <EditLinkButton
              href={`${basePath}?tab=${activeTab}&drawer=edit-task&taskId=${row.id}`}
            />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>
      {row.controls ? (
        <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <span className="font-medium uppercase tracking-wide text-slate-500">
            Controls:
          </span>{' '}
          {row.controls}
        </div>
      ) : null}
      {row.hazardIds.length > 0 ? (
        <div className="text-xs text-slate-500">
          Linked hazards:{' '}
          <span className="text-slate-700">
            {row.hazardIds.map((id) => hazardLookup.get(id) ?? '?').join(', ')}
          </span>
        </div>
      ) : null}
    </li>
  )
}

// ============================================================================
// Hazards
// ============================================================================

export function AddHazardLibraryDrawerBody({
  assessmentId,
  hazardLibrary,
  closeHref,
  addAction,
}: {
  assessmentId: string
  hazardLibrary: { id: string; name: string; typeName: string | null }[]
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [hazardId, setHazardId] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const filtered = query.trim()
    ? hazardLibrary.filter((h) => {
        const q = query.toLowerCase()
        return (
          h.name.toLowerCase().includes(q) ||
          (h.typeName ?? '').toLowerCase().includes(q)
        )
      })
    : hazardLibrary

  function submit() {
    setErr(null)
    if (!hazardId) {
      setErr('Pick a hazard from the library.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('hazardId', hazardId)
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Search</Label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hazard library…"
          />
        </div>
        <div className="-mx-1 max-h-[60vh] overflow-y-auto rounded-md border border-slate-200">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500">
              No hazards match.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((h) => (
                <li key={h.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${hazardId === h.id ? 'bg-teal-50' : ''}`}
                  >
                    <input
                      type="radio"
                      name="hazardId"
                      value={h.id}
                      checked={hazardId === h.id}
                      onChange={() => setHazardId(h.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{h.name}</div>
                      {h.typeName ? (
                        <div className="text-xs text-slate-500">{h.typeName}</div>
                      ) : null}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add hazard" />
    </>
  )
}

export function AddHazardSetDrawerBody({
  assessmentId,
  hazardSets,
  closeHref,
  addSetAction,
}: {
  assessmentId: string
  hazardSets: { id: string; name: string; count: number }[]
  closeHref: string
  addSetAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [setId, setSetId] = useState<string>('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!setId) {
      setErr('Pick a hazard set.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('setId', setId)
    start(async () => {
      await addSetAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Hazard sets bulk-add a curated list of hazards in one shot. Existing
          hazards on this assessment are not deduplicated.
        </p>
        <div className="space-y-1.5">
          <Label>Hazard set</Label>
          {hazardSets.length === 0 ? (
            <div className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
              No hazard sets configured for this tenant yet. Create one under
              the HazID library admin.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {hazardSets.map((s) => (
                <li key={s.id}>
                  <label
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-slate-50 ${setId === s.id ? 'border-teal-600 bg-teal-50' : 'border-slate-200'}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="setId"
                        value={s.id}
                        checked={setId === s.id}
                        onChange={() => setSetId(s.id)}
                      />
                      <span className="font-medium text-slate-900">{s.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {s.count} hazard{s.count === 1 ? '' : 's'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add set" />
    </>
  )
}

export function AddHazardDrawerBody({
  assessmentId,
  closeHref,
  addAction,
}: {
  assessmentId: string
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [name, setName] = useState<string>('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!name.trim()) {
      setErr('Give the hazard a name.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('name', name.trim())
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Add an ad-hoc hazard for this job only. To save it for future
          assessments, add it to the hazard library instead.
        </p>
        <div className="space-y-1.5">
          <Label>Hazard name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sun exposure, low overhead beam"
          />
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add hazard" />
    </>
  )
}

export function EditHazardDrawerBody({
  assessmentId,
  closeHref,
  row,
  libraryName,
  updateAction,
}: {
  assessmentId: string
  closeHref: string
  row: {
    id: string
    hazardId: string | null
    name: string | null
    standardControls: string | null
    specificControls: string | null
    applicable: boolean
    preLikelihood: number | null
    preSeverity: number | null
    controls: string | null
    postLikelihood: number | null
    postSeverity: number | null
  }
  libraryName: string | null
  updateAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [name, setName] = useState<string>(row.name ?? '')
  const [standard, setStandard] = useState<string>(row.standardControls ?? '')
  const [specific, setSpecific] = useState<string>(row.specificControls ?? '')
  const [applicable, setApplicable] = useState<boolean>(row.applicable)
  // Risk-rating inputs live as strings so an empty field stays empty (== "not
  // yet rated") instead of being coerced to 0.
  const [preLikelihood, setPreLikelihood] = useState<string>(
    row.preLikelihood == null ? '' : String(row.preLikelihood),
  )
  const [preSeverity, setPreSeverity] = useState<string>(
    row.preSeverity == null ? '' : String(row.preSeverity),
  )
  const [controls, setControls] = useState<string>(row.controls ?? '')
  const [postLikelihood, setPostLikelihood] = useState<string>(
    row.postLikelihood == null ? '' : String(row.postLikelihood),
  )
  const [postSeverity, setPostSeverity] = useState<string>(
    row.postSeverity == null ? '' : String(row.postSeverity),
  )
  const [pending, start] = useTransition()

  const preScore = riskScore(preLikelihood, preSeverity)
  const postScore = riskScore(postLikelihood, postSeverity)

  function submit() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    if (!libraryName) fd.set('name', name)
    fd.set('standardControls', standard)
    fd.set('specificControls', specific)
    if (applicable) fd.set('applicable', 'on')
    // Always send risk-rating fields so the server can null them out when
    // cleared by the user.
    fd.set('preLikelihood', preLikelihood)
    fd.set('preSeverity', preSeverity)
    fd.set('controls', controls)
    fd.set('postLikelihood', postLikelihood)
    fd.set('postSeverity', postSeverity)
    start(async () => {
      await updateAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        {libraryName ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              From library
            </div>
            <div className="font-medium text-slate-900">{libraryName}</div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Hazard name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ad-hoc hazard name"
            />
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Risk-rating block — pre-control L×S = R, then controls textarea, */}
        {/* then post-control L×S = R. Shows the live computed score chip   */}
        {/* next to each set of inputs so users see the rating change as   */}
        {/* they pick values.                                              */}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Pre-control risk (before mitigations)
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Likelihood (1–5)</Label>
              <RiskRatingSelect
                value={preLikelihood}
                onChange={setPreLikelihood}
                name="preLikelihood"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Severity (1–5)</Label>
              <RiskRatingSelect
                value={preSeverity}
                onChange={setPreSeverity}
                name="preSeverity"
              />
            </div>
            <RiskScoreChip score={preScore} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Controls applied</Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={3}
            placeholder="What controls reduce this risk? e.g. lockout/tagout, barricades, signage"
          />
        </div>

        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Post-control risk (after mitigations)
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Likelihood (1–5)</Label>
              <RiskRatingSelect
                value={postLikelihood}
                onChange={setPostLikelihood}
                name="postLikelihood"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Severity (1–5)</Label>
              <RiskRatingSelect
                value={postSeverity}
                onChange={setPostSeverity}
                name="postSeverity"
              />
            </div>
            <RiskScoreChip score={postScore} />
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Legacy free-text controls — kept so existing data still renders */}
        {/* and library snapshots remain editable. Optional for new hazards.*/}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-1.5">
          <Label>Standard controls (library snapshot)</Label>
          <Textarea
            value={standard}
            onChange={(e) => setStandard(e.target.value)}
            rows={2}
            placeholder="From the library; editable for this job"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Specific controls (this job)</Label>
          <Textarea
            value={specific}
            onChange={(e) => setSpecific(e.target.value)}
            rows={2}
            placeholder="Site-specific controls"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={applicable}
            onChange={(e) => setApplicable(e.target.checked)}
          />
          Applies to this job
        </label>
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Save" />
    </>
  )
}

// 1-5 select used for both pre- and post-control likelihood/severity inputs.
// Empty option means "not yet rated" — distinct from a 0 score.
function RiskRatingSelect({
  value,
  onChange,
  name,
}: {
  value: string
  onChange: (next: string) => void
  name: string
}) {
  return (
    <Select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4">4</option>
      <option value="5">5</option>
    </Select>
  )
}

// Computes the risk score from string inputs. Returns null if either side is
// missing so the chip can render a "—" placeholder.
function riskScore(likelihood: string, severity: string): number | null {
  if (!likelihood || !severity) return null
  const l = Number(likelihood)
  const s = Number(severity)
  if (!Number.isFinite(l) || !Number.isFinite(s)) return null
  if (l < 1 || l > 5 || s < 1 || s > 5) return null
  return l * s
}

// Maps a numeric risk score (1-25 on a 5×5 matrix) to a colored chip.
// Tone scheme follows the typical safety risk matrix:
//   low (1-4)        → green
//   moderate (5-9)   → yellow
//   high (10-14)     → orange
//   extreme (15+)    → red
function RiskScoreChip({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="flex h-9 w-12 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-xs text-slate-400">
        —
      </div>
    )
  }
  let bg = 'bg-emerald-100 text-emerald-900 border-emerald-200'
  let label = 'Low'
  if (score >= 15) {
    bg = 'bg-red-100 text-red-900 border-red-300'
    label = 'Extreme'
  } else if (score >= 10) {
    bg = 'bg-orange-100 text-orange-900 border-orange-300'
    label = 'High'
  } else if (score >= 5) {
    bg = 'bg-amber-100 text-amber-900 border-amber-300'
    label = 'Moderate'
  }
  return (
    <div
      className={`flex h-9 w-12 flex-col items-center justify-center rounded-md border text-xs font-semibold ${bg}`}
      title={`${label} risk · score ${score}`}
    >
      <span className="text-sm leading-none">{score}</span>
      <span className="text-[9px] font-medium leading-none tracking-wide">{label}</span>
    </div>
  )
}

export function HazardRow({
  row,
  assessmentId,
  index,
  totalCount,
  libraryName,
  basePath,
  activeTab,
  disabled,
  moveAction,
  deleteAction,
}: {
  row: {
    id: string
    hazardId: string | null
    name: string | null
    standardControls: string | null
    specificControls: string | null
    applicable: boolean
    entityOrder: number
    preLikelihood: number | null
    preSeverity: number | null
    controls: string | null
    postLikelihood: number | null
    postSeverity: number | null
  }
  assessmentId: string
  index: number
  totalCount: number
  libraryName: string | null
  basePath: string
  activeTab: string
  disabled?: boolean
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const preScore =
    row.preLikelihood != null && row.preSeverity != null
      ? row.preLikelihood * row.preSeverity
      : null
  const postScore =
    row.postLikelihood != null && row.postSeverity != null
      ? row.postLikelihood * row.postSeverity
      : null
  return (
    <li className={`space-y-2 rounded-md border border-slate-200 bg-white p-3 ${row.applicable ? '' : 'opacity-60'}`}>
      {/* Header: index + name + row actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Hazard #{index + 1}
            {row.applicable ? null : <span className="ml-2 text-slate-400">(not applicable)</span>}
          </div>
          <div className="font-medium text-slate-900">
            {libraryName ?? row.name ?? <span className="text-slate-400">— ad-hoc —</span>}
          </div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <EditLinkButton
              href={`${basePath}?tab=${activeTab}&drawer=edit-hazard&hazardId=${row.id}`}
            />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>

      {/* Risk-rating block: pre-risk chip · controls · post-risk chip */}
      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[auto_1fr_auto]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Pre
          </span>
          <RiskScoreChip score={preScore} />
        </div>
        <div className="min-w-0 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
          {row.controls ? (
            <>
              <span className="font-medium uppercase tracking-wide text-slate-500">
                Controls:
              </span>{' '}
              {row.controls}
            </>
          ) : (
            <span className="italic text-slate-400">No controls captured yet.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Post
          </span>
          <RiskScoreChip score={postScore} />
        </div>
      </div>

      {/* Legacy standard/specific control snapshots — kept for parity. */}
      {row.standardControls ? (
        <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <span className="font-medium uppercase tracking-wide text-slate-500">
            Standard:
          </span>{' '}
          {row.standardControls}
        </div>
      ) : null}
      {row.specificControls ? (
        <div className="rounded bg-amber-50 px-2 py-1 text-xs text-slate-700">
          <span className="font-medium uppercase tracking-wide text-slate-500">
            Specific:
          </span>{' '}
          {row.specificControls}
        </div>
      ) : null}
    </li>
  )
}

// ============================================================================
// PPE
// ============================================================================

export function AddPPEDrawerBody({
  assessmentId,
  closeHref,
  addAction,
}: {
  assessmentId: string
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [name, setName] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [required, setRequired] = useState<boolean>(true)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!name.trim()) {
      setErr('Give the PPE row a name.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('name', name.trim())
    fd.set('description', description)
    if (required) fd.set('required', 'on')
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>PPE name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hard hat, FR coveralls"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="When / why this PPE is needed"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required (must be answered before assessment completes)
        </label>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add PPE" />
    </>
  )
}

export function EditPPEDrawerBody({
  assessmentId,
  closeHref,
  row,
  updateAction,
}: {
  assessmentId: string
  closeHref: string
  row: { id: string; name: string; description: string | null; required: boolean }
  updateAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [name, setName] = useState<string>(row.name)
  const [description, setDescription] = useState<string>(row.description ?? '')
  const [required, setRequired] = useState<boolean>(row.required)
  const [pending, start] = useTransition()

  function submit() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('name', name)
    fd.set('description', description)
    if (required) fd.set('required', 'on')
    start(async () => {
      await updateAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>PPE name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Save" />
    </>
  )
}

export function PPERow({
  row,
  assessmentId,
  index,
  totalCount,
  basePath,
  activeTab,
  disabled,
  answerAction,
  moveAction,
  deleteAction,
}: {
  row: { id: string; name: string; description: string | null; required: boolean; answer: string | null }
  assessmentId: string
  index: number
  totalCount: number
  basePath: string
  activeTab: string
  disabled?: boolean
  answerAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [pending, start] = useTransition()
  function answer(value: 'yes' | 'no' | 'na') {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('answer', value)
    start(async () => {
      await answerAction(fd)
    })
  }
  return (
    <li className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto_auto]">
      <div>
        <div className="font-medium text-slate-900">
          {row.name}
          {row.required ? (
            <span className="ml-2 text-xs uppercase tracking-wide text-red-600">
              required
            </span>
          ) : null}
        </div>
        {row.description ? (
          <div className="text-xs text-slate-500">{row.description}</div>
        ) : null}
      </div>
      <div className="flex items-center gap-1 text-xs">
        {(['yes', 'no', 'na'] as const).map((v) => (
          <button
            key={v}
            type="button"
            disabled={pending || disabled}
            onClick={() => answer(v)}
            className={`rounded-full border px-2 py-0.5 ${row.answer === v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
      {disabled ? null : (
        <div className="flex items-center gap-1">
          <EditLinkButton
            href={`${basePath}?tab=${activeTab}&drawer=edit-ppe&ppeId=${row.id}`}
          />
          <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
          <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
          <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
        </div>
      )}
    </li>
  )
}

// ============================================================================
// Questions
// ============================================================================

export function AddQuestionDrawerBody({
  assessmentId,
  closeHref,
  addAction,
}: {
  assessmentId: string
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [question, setQuestion] = useState<string>('')
  const [questionType, setQuestionType] = useState<'yes_no' | 'text' | 'multi_select'>('yes_no')
  const [answers, setAnswers] = useState<string>('')
  const [requiresYes, setRequiresYes] = useState<boolean>(false)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!question.trim()) {
      setErr('Enter the question text.')
      return
    }
    if (questionType === 'multi_select' && !answers.trim()) {
      setErr('Multi-select needs at least one option.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('question', question.trim())
    fd.set('questionType', questionType)
    fd.set('answers', answers)
    if (requiresYes) fd.set('requiresYes', 'on')
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Question</Label>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Are all permits posted?"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Answer type</Label>
          <Select
            value={questionType}
            onChange={(e) => setQuestionType(e.target.value as any)}
          >
            <option value="yes_no">Yes / No</option>
            <option value="text">Free text</option>
            <option value="multi_select">Multi-select</option>
          </Select>
        </div>
        {questionType === 'multi_select' ? (
          <div className="space-y-1.5">
            <Label>Options (one per line)</Label>
            <Textarea
              value={answers}
              onChange={(e) => setAnswers(e.target.value)}
              rows={5}
            />
          </div>
        ) : null}
        {questionType === 'yes_no' ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresYes}
              onChange={(e) => setRequiresYes(e.target.checked)}
            />
            Requires "Yes" for completion
          </label>
        ) : null}
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add question" />
    </>
  )
}

export function EditQuestionDrawerBody({
  assessmentId,
  closeHref,
  row,
  updateAction,
}: {
  assessmentId: string
  closeHref: string
  row: {
    id: string
    question: string
    questionType: 'yes_no' | 'text' | 'multi_select'
    answers: string[]
    requiresYes: boolean
  }
  updateAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [question, setQuestion] = useState<string>(row.question)
  const [requiresYes, setRequiresYes] = useState<boolean>(row.requiresYes)
  const [pending, start] = useTransition()

  function submit() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('question', question)
    if (requiresYes) fd.set('requiresYes', 'on')
    start(async () => {
      await updateAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Question</Label>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Answer type
          </div>
          <div className="text-slate-900">{row.questionType.replace('_', ' ')}</div>
          <p className="mt-1 text-xs text-slate-500">
            Changing the answer type would invalidate existing answers — delete
            and re-add instead.
          </p>
        </div>
        {row.questionType === 'multi_select' && row.answers.length > 0 ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Options
            </div>
            <ul className="mt-1 list-inside list-disc text-slate-700">
              {row.answers.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {row.questionType === 'yes_no' ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresYes}
              onChange={(e) => setRequiresYes(e.target.checked)}
            />
            Requires "Yes" for completion
          </label>
        ) : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Save" />
    </>
  )
}

export function QuestionRow({
  row,
  assessmentId,
  index,
  totalCount,
  basePath,
  activeTab,
  disabled,
  answerAction,
  moveAction,
  deleteAction,
}: {
  row: {
    id: string
    question: string
    questionType: 'yes_no' | 'text' | 'multi_select'
    answers: string[]
    requiresYes: boolean
    answer: string | null
  }
  assessmentId: string
  index: number
  totalCount: number
  basePath: string
  activeTab: string
  disabled?: boolean
  answerAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [answer, setAnswer] = useState<string>(row.answer ?? '')
  const [pending, start] = useTransition()
  function save() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('answer', answer)
    start(async () => {
      await answerAction(fd)
    })
  }
  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">
            {row.question}
            {row.requiresYes ? (
              <span className="ml-2 text-xs text-red-600">requires yes</span>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">{row.questionType.replace('_', ' ')}</div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <EditLinkButton
              href={`${basePath}?tab=${activeTab}&drawer=edit-question&questionId=${row.id}`}
            />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>
      {row.questionType === 'yes_no' ? (
        <div className="flex items-center gap-2">
          {['Yes', 'No', 'N/A'].map((v) => (
            <button
              key={v}
              type="button"
              disabled={pending || disabled}
              onClick={() => {
                setAnswer(v)
                const fd = new FormData()
                fd.set('id', row.id)
                fd.set('assessmentId', assessmentId)
                fd.set('answer', v)
                start(async () => {
                  await answerAction(fd)
                })
              }}
              className={`rounded-full border px-3 py-1 text-xs ${(row.answer ?? answer) === v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            >
              {v}
            </button>
          ))}
        </div>
      ) : row.questionType === 'multi_select' ? (
        <Select value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {row.answers.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      ) : (
        <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} disabled={disabled} />
      )}
      {row.questionType !== 'yes_no' && !disabled ? (
        <div className="flex items-center justify-end">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            Save answer
          </Button>
        </div>
      ) : null}
    </li>
  )
}

// ============================================================================
// CS Atmospheric reading
// ============================================================================

export function AddAtmosphericDrawerBody({
  assessmentId,
  sensors,
  closeHref,
  addAction,
}: {
  assessmentId: string
  sensors: { id: string; identifier: string }[]
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [sensorId, setSensorId] = useState<string>('')
  const [time, setTime] = useState<string>(new Date().toISOString().slice(0, 16))
  const [s1, setS1] = useState<string>('')
  const [s2, setS2] = useState<string>('')
  const [s3, setS3] = useState<string>('')
  const [s4, setS4] = useState<string>('')
  const [distance, setDistance] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!time) {
      setErr('Reading time is required.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    if (sensorId) fd.set('atmosphericSensorId', sensorId)
    fd.set('time', time)
    fd.set('sensor1Reading', s1)
    fd.set('sensor2Reading', s2)
    fd.set('sensor3Reading', s3)
    fd.set('sensor4Reading', s4)
    fd.set('distance', distance)
    fd.set('notes', notes)
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Sensor</Label>
            <Select value={sensorId} onChange={(e) => setSensorId(e.target.value)}>
              <option value="">—</option>
              {sensors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.identifier}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Time</Label>
            <Input
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>O₂ (%)</Label>
            <Input value={s1} onChange={(e) => setS1(e.target.value)} placeholder="e.g. 20.9" />
          </div>
          <div className="space-y-1.5">
            <Label>LEL (%)</Label>
            <Input value={s2} onChange={(e) => setS2(e.target.value)} placeholder="e.g. 0" />
          </div>
          <div className="space-y-1.5">
            <Label>CO (ppm)</Label>
            <Input value={s3} onChange={(e) => setS3(e.target.value)} placeholder="e.g. 0" />
          </div>
          <div className="space-y-1.5">
            <Label>H₂S (ppm)</Label>
            <Input value={s4} onChange={(e) => setS4(e.target.value)} placeholder="e.g. 0" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Distance from entry</Label>
          <Input
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="e.g. 2 m below entry"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Add reading" />
    </>
  )
}

// ============================================================================
// CS Entry log
// ============================================================================

export function AddEntryDrawerBody({
  assessmentId,
  people: peopleList,
  closeHref,
  addAction,
}: {
  assessmentId: string
  people: { id: string; firstName: string; lastName: string }[]
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [personId, setPersonId] = useState<string>('')
  const [externalName, setExternalName] = useState<string>('')
  const [timeIn, setTimeIn] = useState<string>(new Date().toISOString().slice(0, 16))
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (!personId && !externalName.trim()) {
      setErr('Pick a person or enter an external name.')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    if (personId) fd.set('personId', personId)
    if (externalName) fd.set('externalName', externalName)
    fd.set('timeIn', timeIn)
    start(async () => {
      await addAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Log a person entering the confined space. Use "Sign out" on the row
          afterward to record their exit.
        </p>
        <div className="space-y-1.5">
          <Label>Internal person</Label>
          <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">—</option>
            {peopleList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Or external name</Label>
          <Input
            value={externalName}
            onChange={(e) => setExternalName(e.target.value)}
            placeholder="Visitor / contractor full name"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Time in</Label>
          <Input
            type="datetime-local"
            value={timeIn}
            onChange={(e) => setTimeIn(e.target.value)}
          />
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Log entry" />
    </>
  )
}

export function ExitEntryDrawerBody({
  assessmentId,
  closeHref,
  row,
  personLabel,
  exitAction,
}: {
  assessmentId: string
  closeHref: string
  row: { id: string; timeIn: Date | null }
  personLabel: string
  exitAction: (formData: FormData) => Promise<void>
}) {
  const close = useDrawerClose(closeHref)
  const [pending, start] = useTransition()

  function submit() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    start(async () => {
      await exitAction(fd)
      close()
    })
  }

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Mark <span className="font-medium text-slate-900">{personLabel}</span>{' '}
          as having exited the confined space. The current time is recorded.
        </p>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Time in
          </div>
          <div className="text-slate-900">
            {row.timeIn ? new Date(row.timeIn).toLocaleString() : '—'}
          </div>
        </div>
      </div>
      <DrawerSubmitHandle pending={pending} onSubmit={submit} closeHref={closeHref} submitLabel="Mark exited" />
    </>
  )
}

// ============================================================================
// Shared row buttons
// ============================================================================

export function MoveButton({
  id,
  assessmentId,
  direction,
  disabled,
  action,
}: {
  id: string
  assessmentId: string
  direction: 'up' | 'down'
  disabled?: boolean
  action: (formData: FormData) => Promise<void>
}) {
  const [pending, start] = useTransition()
  function go() {
    const fd = new FormData()
    fd.set('id', id)
    fd.set('assessmentId', assessmentId)
    fd.set('direction', direction)
    start(async () => {
      await action(fd)
    })
  }
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={go}
      className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
      aria-label={`Move ${direction}`}
    >
      {direction === 'up' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  )
}

export function DeleteButton({
  id,
  assessmentId,
  action,
}: {
  id: string
  assessmentId: string
  action: (formData: FormData) => Promise<void>
}) {
  const [pending, start] = useTransition()
  function go() {
    const fd = new FormData()
    fd.set('id', id)
    fd.set('assessmentId', assessmentId)
    start(async () => {
      await action(fd)
    })
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={go}
      className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30"
      aria-label="Delete"
    >
      <Trash2 size={14} />
    </button>
  )
}

export function EditLinkButton({ href }: { href: string }) {
  return (
    <Link
      href={href as any}
      className="rounded p-1 text-slate-500 hover:bg-slate-100"
      aria-label="Edit"
    >
      <Pencil size={14} />
    </Link>
  )
}

// ============================================================================
// Sub-form toggle (WAH/CS/AF)
// ============================================================================

export function SubFormToggle({
  id,
  field,
  initial,
  label,
  disabled,
  toggleAction,
}: {
  id: string
  field: 'wah' | 'confinedSpace' | 'arcFlash'
  initial: boolean
  label: string
  disabled?: boolean
  toggleAction: (formData: FormData) => Promise<void>
}) {
  const [pending, start] = useTransition()
  function go(next: boolean) {
    const fd = new FormData()
    fd.set('id', id)
    fd.set('field', field)
    fd.set('value', next ? 'on' : '')
    start(async () => {
      await toggleAction(fd)
    })
  }
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2 text-sm">
      <div className="font-medium text-slate-700">{label}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || disabled}
          onClick={() => go(!initial)}
          className={`rounded-full border px-3 py-0.5 text-xs ${initial ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
        >
          {pending ? '…' : initial ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Drawer footer registry
// ============================================================================
//
// The page renders <UrlDrawer footer={...}> and the body inside renders a
// hidden button paired with a custom-event handshake. We side-step that
// complexity by re-rendering the footer on the body itself — the UrlDrawer
// gives us a docked area on the bottom via the `footer` prop, but the
// drawer-body components below take ownership of their own submit button.
//
// Concretely: each *DrawerBody* component renders a `<DrawerSubmitHandle>`
// (a div pinned to bottom in CSS) so the drawer footer prop on the page can
// be omitted. This keeps each body self-contained without needing to thread
// a form ID up to the page.

export function DrawerSubmitHandle({
  pending,
  onSubmit,
  closeHref,
  submitLabel,
}: {
  pending: boolean
  onSubmit: () => void
  closeHref: string
  submitLabel: string
}) {
  return (
    <div className="sticky bottom-0 -mx-6 -mb-5 mt-6 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
      <Link href={closeHref as any}>
        <Button type="button" variant="outline">
          Cancel
        </Button>
      </Link>
      <Button type="button" onClick={onSubmit} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </div>
  )
}
