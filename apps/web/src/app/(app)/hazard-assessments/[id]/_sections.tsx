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
import { RiskDelta, RiskMatrixField } from '../_risk'

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
      setErr('Select a library task or enter an ad-hoc description.')
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
            Selecting a library task pre-fills the controls and links any associated hazards.
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Add task"
      />
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
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
            <div className="text-xs tracking-wide text-slate-500 uppercase">From library</div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{taskName}</div>
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
            placeholder="Controls and safe-work practices that apply"
          />
        </div>
        {row.hazardIds.length > 0 ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/50">
            <div className="font-medium tracking-wide text-slate-500 uppercase">Linked hazards</div>
            <div className="mt-1 text-slate-700 dark:text-slate-300">
              {row.hazardIds.map((id) => hazardLookup.get(id) ?? '?').join(', ')}
            </div>
          </div>
        ) : null}
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Save"
      />
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
  disabled?: boolean
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs tracking-wide text-slate-500 uppercase">Task #{index + 1}</div>
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {taskName ?? row.description ?? <span className="text-slate-400">— untitled —</span>}
          </div>
          {row.description && taskName && row.description !== taskName ? (
            <div className="text-xs text-slate-500">Override: {row.description}</div>
          ) : null}
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <EditLinkButton href={`${basePath}?drawer=edit-task&taskId=${row.id}`} />
            <MoveButton
              id={row.id}
              assessmentId={assessmentId}
              direction="up"
              disabled={index === 0}
              action={moveAction}
            />
            <MoveButton
              id={row.id}
              assessmentId={assessmentId}
              direction="down"
              disabled={index >= totalCount - 1}
              action={moveAction}
            />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>
      {row.controls ? (
        <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
          <span className="font-medium tracking-wide text-slate-500 uppercase">Controls:</span>{' '}
          {row.controls}
        </div>
      ) : null}
      {row.hazardIds.length > 0 ? (
        <div className="text-xs text-slate-500">
          Linked hazards:{' '}
          <span className="text-slate-700 dark:text-slate-300">
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
        return h.name.toLowerCase().includes(q) || (h.typeName ?? '').toLowerCase().includes(q)
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
        <div className="-mx-1 max-h-[60vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500">No hazards match.</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((h) => (
                <li key={h.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-slate-50 dark:bg-slate-800/50 ${hazardId === h.id ? 'bg-teal-50' : ''}`}
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
                      <div className="font-medium text-slate-900 dark:text-slate-100">{h.name}</div>
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Add hazard"
      />
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Hazard sets bulk-add a curated list of hazards in one shot. Existing hazards on this
          assessment are not deduplicated.
        </p>
        <div className="space-y-1.5">
          <Label>Hazard set</Label>
          {hazardSets.length === 0 ? (
            <div className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:bg-slate-800/50">
              No hazard sets configured. Create one under the hazard library admin.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {hazardSets.map((s) => (
                <li key={s.id}>
                  <label
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-slate-50 dark:bg-slate-800/50 ${setId === s.id ? 'border-teal-600 bg-teal-50' : 'border-slate-200 dark:border-slate-800'}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="setId"
                        value={s.id}
                        checked={setId === s.id}
                        onChange={() => setSetId(s.id)}
                      />
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {s.name}
                      </span>
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Add set"
      />
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Add an ad-hoc hazard for this job only. To save it for future assessments, add it to the
          hazard library instead.
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Add hazard"
      />
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
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
            <div className="text-xs tracking-wide text-slate-500 uppercase">From library</div>
            <div className="font-medium text-slate-900 dark:text-slate-100">{libraryName}</div>
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
        {/* Risk-rating block — pre-control 5×5 matrix, controls textarea,  */}
        {/* then post-control matrix so the residual-risk reduction is      */}
        {/* visible while the user picks values.                            */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <RiskMatrixField
            label="Pre-control risk (before mitigations)"
            likelihoodName="preLikelihood"
            severityName="preSeverity"
            defaultLikelihood={row.preLikelihood}
            defaultSeverity={row.preSeverity}
            onChange={({ likelihood, severity }) => {
              setPreLikelihood(likelihood == null ? '' : String(likelihood))
              setPreSeverity(severity == null ? '' : String(severity))
            }}
          />
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

        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <RiskMatrixField
            label="Post-control risk (after mitigations)"
            likelihoodName="postLikelihood"
            severityName="postSeverity"
            defaultLikelihood={row.postLikelihood}
            defaultSeverity={row.postSeverity}
            onChange={({ likelihood, severity }) => {
              setPostLikelihood(likelihood == null ? '' : String(likelihood))
              setPostSeverity(severity == null ? '' : String(severity))
            }}
          />
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Save"
      />
    </>
  )
}

export function HazardRow({
  row,
  assessmentId,
  index,
  totalCount,
  libraryName,
  basePath,
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
  disabled?: boolean
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  return (
    <li
      className={`space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 ${row.applicable ? '' : 'opacity-60'}`}
    >
      {/* Header: index + name + risk delta + row actions */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs tracking-wide text-slate-500 uppercase">
            Hazard #{index + 1}
            {row.applicable ? null : <span className="ml-2 text-slate-400">(not applicable)</span>}
          </div>
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {libraryName ?? row.name ?? <span className="text-slate-400">— ad-hoc —</span>}
          </div>
          <div className="mt-1.5">
            <RiskDelta
              preLikelihood={row.preLikelihood}
              preSeverity={row.preSeverity}
              postLikelihood={row.postLikelihood}
              postSeverity={row.postSeverity}
            />
          </div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <EditLinkButton href={`${basePath}?drawer=edit-hazard&hazardId=${row.id}`} />
            <MoveButton
              id={row.id}
              assessmentId={assessmentId}
              direction="up"
              disabled={index === 0}
              action={moveAction}
            />
            <MoveButton
              id={row.id}
              assessmentId={assessmentId}
              direction="down"
              disabled={index >= totalCount - 1}
              action={moveAction}
            />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>

      {/* Controls applied to buy the risk down */}
      <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        {row.controls ? (
          <>
            <span className="font-medium tracking-wide text-slate-500 uppercase">Controls:</span>{' '}
            {row.controls}
          </>
        ) : (
          <span className="text-slate-400 italic">No controls captured.</span>
        )}
      </div>

      {/* Legacy standard/specific control snapshots — kept for parity. */}
      {row.standardControls ? (
        <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
          <span className="font-medium tracking-wide text-slate-500 uppercase">Standard:</span>{' '}
          {row.standardControls}
        </div>
      ) : null}
      {row.specificControls ? (
        <div className="rounded bg-amber-50 px-2 py-1 text-xs text-slate-700 dark:text-slate-300">
          <span className="font-medium tracking-wide text-slate-500 uppercase">Specific:</span>{' '}
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Add PPE"
      />
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
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Save"
      />
    </>
  )
}

export function PPERow({
  row,
  assessmentId,
  index,
  totalCount,
  basePath,
  disabled,
  answerAction,
  moveAction,
  deleteAction,
}: {
  row: {
    id: string
    name: string
    description: string | null
    required: boolean
    answer: string | null
  }
  assessmentId: string
  index: number
  totalCount: number
  basePath: string
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
    <li className="grid grid-cols-1 items-center gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_auto_auto] dark:border-slate-800 dark:bg-slate-900">
      <div>
        <div className="font-medium text-slate-900 dark:text-slate-100">
          {row.name}
          {row.required ? (
            <span className="ml-2 text-xs tracking-wide text-red-600 uppercase">required</span>
          ) : null}
        </div>
        {row.description ? <div className="text-xs text-slate-500">{row.description}</div> : null}
      </div>
      <div className="flex items-center gap-1.5 text-sm sm:text-xs">
        {(['yes', 'no', 'na'] as const).map((v) => (
          <button
            key={v}
            type="button"
            disabled={pending || disabled}
            onClick={() => answer(v)}
            className={`min-h-10 flex-1 rounded-full border px-4 font-medium sm:min-h-0 sm:flex-none sm:px-2.5 sm:py-0.5 sm:font-normal ${row.answer === v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'}`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
      {disabled ? null : (
        <div className="flex items-center gap-1">
          <EditLinkButton href={`${basePath}?drawer=edit-ppe&ppeId=${row.id}`} />
          <MoveButton
            id={row.id}
            assessmentId={assessmentId}
            direction="up"
            disabled={index === 0}
            action={moveAction}
          />
          <MoveButton
            id={row.id}
            assessmentId={assessmentId}
            direction="down"
            disabled={index >= totalCount - 1}
            action={moveAction}
          />
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
          <Select value={questionType} onChange={(e) => setQuestionType(e.target.value as any)}>
            <option value="yes_no">Yes / No</option>
            <option value="text">Free text</option>
            <option value="multi_select">Multi-select</option>
          </Select>
        </div>
        {questionType === 'multi_select' ? (
          <div className="space-y-1.5">
            <Label>Options (one per line)</Label>
            <Textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={5} />
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Add question"
      />
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
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
          <div className="text-xs tracking-wide text-slate-500 uppercase">Answer type</div>
          <div className="text-slate-900 dark:text-slate-100">
            {row.questionType.replace('_', ' ')}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Changing the answer type would invalidate existing answers — delete and re-add instead.
          </p>
        </div>
        {row.questionType === 'multi_select' && row.answers.length > 0 ? (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
            <div className="text-xs tracking-wide text-slate-500 uppercase">Options</div>
            <ul className="mt-1 list-inside list-disc text-slate-700 dark:text-slate-300">
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
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel="Save"
      />
    </>
  )
}

export function QuestionRow({
  row,
  assessmentId,
  index,
  totalCount,
  basePath,
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
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {row.question}
            {row.requiresYes ? (
              <span className="ml-2 text-xs text-red-600">requires yes</span>
            ) : null}
          </div>
          <div className="text-xs text-slate-500">{row.questionType.replace('_', ' ')}</div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <EditLinkButton href={`${basePath}?drawer=edit-question&questionId=${row.id}`} />
            <MoveButton
              id={row.id}
              assessmentId={assessmentId}
              direction="up"
              disabled={index === 0}
              action={moveAction}
            />
            <MoveButton
              id={row.id}
              assessmentId={assessmentId}
              direction="down"
              disabled={index >= totalCount - 1}
              action={moveAction}
            />
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
              className={`min-h-10 flex-1 rounded-full border px-4 text-sm font-medium sm:min-h-0 sm:flex-none sm:px-3 sm:py-1 sm:text-xs sm:font-normal ${(row.answer ?? answer) === v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'}`}
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
        <Textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          disabled={disabled}
        />
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
      className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
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
      className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
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
  field: 'wah'
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
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800/30">
      <div className="font-medium text-slate-700 dark:text-slate-300">{label}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || disabled}
          onClick={() => go(!initial)}
          className={`min-h-9 rounded-full border px-4 text-sm sm:min-h-0 sm:px-3 sm:py-0.5 sm:text-xs ${initial ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'}`}
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
    <div className="sticky bottom-0 -mx-6 mt-6 -mb-5 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-800/50">
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
