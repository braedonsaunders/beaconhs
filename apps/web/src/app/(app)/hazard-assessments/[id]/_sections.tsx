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
//   - Small button helpers     (MoveButton / DeleteButton).
//
// Each Add* form dispatches its server action via `useTransition` and on
// success navigates to the section's tab URL (drops the `?drawer=…` param)
// using `router.replace` — this closes the drawer because the page no longer
// matches the `drawer === '<key>'` predicate.

'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGenerated = useGeneratedTranslations()
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
          <Label>
            <GeneratedText id="m_1ea86ac5ad7afa" />
          </Label>
          <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">
              <GeneratedText id="m_168189b204837c" />
            </option>
            <GeneratedValue
              value={taskLibrary.map((t) => (
                <option key={t.id} value={t.id}>
                  <GeneratedValue value={t.name} />
                </option>
              ))}
            />
          </Select>
          <p className="text-xs text-slate-500">
            <GeneratedText id="m_0c8805d993d503" />
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1f66885a1eaae2" />
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tGenerated('m_143fbcb93fa38e')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1000e754ae934f" />
          </Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={3}
            placeholder={tGenerated('m_19b0625a801b33')}
          />
        </div>
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_02ac1cf154a4f9')}
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        <GeneratedValue
          value={
            taskName ? (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <div className="text-xs tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_1ea86ac5ad7afa" />
                </div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={taskName} />
                </div>
              </div>
            ) : null
          }
        />
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_197d24c1b596bb" />
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tGeneratedValue(taskName ?? tGenerated('m_122f8628a8f74b'))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_163b887b41bdd5" />
          </Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={4}
            placeholder={tGenerated('m_0b1ab817c141f3')}
          />
        </div>
        <GeneratedValue
          value={
            row.hazardIds.length > 0 ? (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/50">
                <div className="font-medium tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_0d68207e1f7148" />
                </div>
                <div className="mt-1 text-slate-700 dark:text-slate-300">
                  <GeneratedValue
                    value={row.hazardIds.map((id) => hazardLookup.get(id) ?? '?').join(', ')}
                  />
                </div>
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_19e6bff894c3c7')}
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
          <div className="text-xs tracking-wide text-slate-500 uppercase">
            <GeneratedText id="m_1c0e96e4dbce0f" />
            <GeneratedValue value={index + 1} />
          </div>
          <div className="font-medium text-slate-900 dark:text-slate-100">
            <GeneratedValue
              value={
                taskName ??
                row.description ?? (
                  <span className="text-slate-400">
                    <GeneratedText id="m_1ffac86e914f96" />
                  </span>
                )
              }
            />
          </div>
          <GeneratedValue
            value={
              row.description && taskName && row.description !== taskName ? (
                <div className="text-xs text-slate-500">
                  <GeneratedText id="m_1e041e56c1d295" /> <GeneratedValue value={row.description} />
                </div>
              ) : null
            }
          />
        </div>
        <GeneratedValue
          value={
            disabled ? null : (
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
            )
          }
        />
      </div>
      <GeneratedValue
        value={
          row.controls ? (
            <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
              <span className="font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_1cf9abb5566412" />
              </span>
              <GeneratedValue value={' '} />
              <GeneratedValue value={row.controls} />
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          row.hazardIds.length > 0 ? (
            <div className="text-xs text-slate-500">
              <GeneratedText id="m_07d8bdb7c50c15" />
              <GeneratedValue value={' '} />
              <span className="text-slate-700 dark:text-slate-300">
                <GeneratedValue
                  value={row.hazardIds.map((id) => hazardLookup.get(id) ?? '?').join(', ')}
                />
              </span>
            </div>
          ) : null
        }
      />
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
  const tGenerated = useGeneratedTranslations()
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
          <Label>
            <GeneratedText id="m_1417e84947b481" />
          </Label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tGenerated('m_1a2234377867d3')}
          />
        </div>
        <div className="-mx-1 max-h-[60vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
          <GeneratedValue
            value={
              filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-slate-500">
                  <GeneratedText id="m_0c5c7559170aa0" />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  <GeneratedValue
                    value={filtered.map((h) => (
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
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              <GeneratedValue value={h.name} />
                            </div>
                            <GeneratedValue
                              value={
                                h.typeName ? (
                                  <div className="text-xs text-slate-500">
                                    <GeneratedValue value={h.typeName} />
                                  </div>
                                ) : null
                              }
                            />
                          </div>
                        </label>
                      </li>
                    ))}
                  />
                </ul>
              )
            }
          />
        </div>
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_1302603dc58ef5')}
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
  const tGenerated = useGeneratedTranslations()
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
          <GeneratedText id="m_17ba1e4ba95d23" />
        </p>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_148930df26b358" />
          </Label>
          <GeneratedValue
            value={
              hazardSets.length === 0 ? (
                <div className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:bg-slate-800/50">
                  <GeneratedText id="m_086a17af5daaea" />
                </div>
              ) : (
                <ul className="space-y-1.5">
                  <GeneratedValue
                    value={hazardSets.map((s) => (
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
                              <GeneratedValue value={s.name} />
                            </span>
                          </div>
                          <span className="text-xs text-slate-500">
                            <GeneratedValue value={s.count} />{' '}
                            <GeneratedText id="m_1f4e6f2368a144" />
                            <GeneratedValue
                              value={s.count === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                            />
                          </span>
                        </label>
                      </li>
                    ))}
                  />
                </ul>
              )
            }
          />
        </div>
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_130c47677645f8')}
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
  const tGenerated = useGeneratedTranslations()
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
          <GeneratedText id="m_035c0272757ccb" />
        </p>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_04ecd25c7edb2f" />
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tGenerated('m_0b9a3a5d75eb5c')}
          />
        </div>
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_1302603dc58ef5')}
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
  const tGenerated = useGeneratedTranslations()
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
        <GeneratedValue
          value={
            libraryName ? (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <div className="text-xs tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_1ea86ac5ad7afa" />
                </div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={libraryName} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_04ecd25c7edb2f" />
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tGenerated('m_1a6bcfd6e8ddff')}
                />
              </div>
            )
          }
        />

        {/* ---------------------------------------------------------------- */}
        {/* Risk-rating block — pre-control 5×5 matrix, controls textarea,  */}
        {/* then post-control matrix so the residual-risk reduction is      */}
        {/* visible while the user picks values.                            */}
        {/* ---------------------------------------------------------------- */}
        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <RiskMatrixField
            label={tGenerated('m_0db23760897db4')}
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
          <Label>
            <GeneratedText id="m_19b78594439f75" />
          </Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={3}
            placeholder={tGenerated('m_08eb3f746c12fb')}
          />
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <RiskMatrixField
            label={tGenerated('m_05dbd720c56577')}
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
          <Label>
            <GeneratedText id="m_19993dfe7ce042" />
          </Label>
          <Textarea
            value={standard}
            onChange={(e) => setStandard(e.target.value)}
            rows={2}
            placeholder={tGenerated('m_1053eecb672045')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_1d748b07675565" />
          </Label>
          <Textarea
            value={specific}
            onChange={(e) => setSpecific(e.target.value)}
            rows={2}
            placeholder={tGenerated('m_0ddf30e0532923')}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={applicable}
            onChange={(e) => setApplicable(e.target.checked)}
          />
          <GeneratedText id="m_1178b70bd65edc" />
        </label>
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_19e6bff894c3c7')}
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
            <GeneratedText id="m_109851c20ddcba" />
            <GeneratedValue value={index + 1} />
            <GeneratedValue
              value={
                row.applicable ? null : (
                  <span className="ml-2 text-slate-400">
                    <GeneratedText id="m_170d7555e9e90d" />
                  </span>
                )
              }
            />
          </div>
          <div className="font-medium text-slate-900 dark:text-slate-100">
            <GeneratedValue
              value={
                libraryName ??
                row.name ?? (
                  <span className="text-slate-400">
                    <GeneratedText id="m_11cfcdae5a47de" />
                  </span>
                )
              }
            />
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
        <GeneratedValue
          value={
            disabled ? null : (
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
            )
          }
        />
      </div>

      {/* Controls applied to buy the risk down */}
      <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        <GeneratedValue
          value={
            row.controls ? (
              <>
                <span className="font-medium tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_1cf9abb5566412" />
                </span>
                <GeneratedValue value={' '} />
                <GeneratedValue value={row.controls} />
              </>
            ) : (
              <span className="text-slate-400 italic">
                <GeneratedText id="m_0447c23bd275b8" />
              </span>
            )
          }
        />
      </div>

      {/* Legacy standard/specific control snapshots — kept for parity. */}
      <GeneratedValue
        value={
          row.standardControls ? (
            <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
              <span className="font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_0807af7d2f1773" />
              </span>
              <GeneratedValue value={' '} />
              <GeneratedValue value={row.standardControls} />
            </div>
          ) : null
        }
      />
      <GeneratedValue
        value={
          row.specificControls ? (
            <div className="rounded bg-amber-50 px-2 py-1 text-xs text-slate-700 dark:bg-amber-950/40 dark:text-slate-300">
              <span className="font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_0b2e8dbe0d0825" />
              </span>
              <GeneratedValue value={' '} />
              <GeneratedValue value={row.specificControls} />
            </div>
          ) : null
        }
      />
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
  const tGenerated = useGeneratedTranslations()
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
          <Label>
            <GeneratedText id="m_0985c7b921de77" />
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tGenerated('m_0c81eb734829ba')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={tGenerated('m_0cdecffb780f14')}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          <GeneratedText id="m_0c3d22a4f5a477" />
        </label>
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_0068c6e22ca766')}
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
  const tGenerated = useGeneratedTranslations()
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
          <Label>
            <GeneratedText id="m_0985c7b921de77" />
          </Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_14d923495cf14c" />
          </Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          <GeneratedText id="m_12fe2fe7a9ddad" />
        </label>
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_19e6bff894c3c7')}
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
          <GeneratedValue value={row.name} />
          <GeneratedValue
            value={
              row.required ? (
                <span className="ml-2 text-xs tracking-wide text-red-600 uppercase">
                  <GeneratedText id="m_07ca2266909f33" />
                </span>
              ) : null
            }
          />
        </div>
        <GeneratedValue
          value={
            row.description ? (
              <div className="text-xs text-slate-500">
                <GeneratedValue value={row.description} />
              </div>
            ) : null
          }
        />
      </div>
      <div className="flex items-center gap-1.5 text-sm sm:text-xs">
        <GeneratedValue
          value={(['yes', 'no', 'na'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={pending || disabled}
              onClick={() => answer(v)}
              className={`min-h-10 flex-1 rounded-full border px-4 font-medium sm:min-h-0 sm:flex-none sm:px-2.5 sm:py-0.5 sm:font-normal ${row.answer === v ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'}`}
            >
              <GeneratedValue value={v.toUpperCase()} />
            </button>
          ))}
        />
      </div>
      <GeneratedValue
        value={
          disabled ? null : (
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
          )
        }
      />
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
  const tGenerated = useGeneratedTranslations()
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
          <Label>
            <GeneratedText id="m_1a895b5691321b" />
          </Label>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={tGenerated('m_0ebf65c61b6d2b')}
          />
        </div>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_10fb4d4125aba0" />
          </Label>
          <Select value={questionType} onChange={(e) => setQuestionType(e.target.value as any)}>
            <option value="yes_no">
              <GeneratedText id="m_0bf8b14108bd13" />
            </option>
            <option value="text">
              <GeneratedText id="m_1510e6eb6b18ad" />
            </option>
            <option value="multi_select">
              <GeneratedText id="m_1bee29efec322c" />
            </option>
          </Select>
        </div>
        <GeneratedValue
          value={
            questionType === 'multi_select' ? (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_02057adc77a443" />
                </Label>
                <Textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={5} />
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            questionType === 'yes_no' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requiresYes}
                  onChange={(e) => setRequiresYes(e.target.checked)}
                />
                <GeneratedText id="m_01b4f1b5df17f0" />
              </label>
            ) : null
          }
        />
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_029dffafbff34b')}
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
  const tGenerated = useGeneratedTranslations()
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
          <Label>
            <GeneratedText id="m_1a895b5691321b" />
          </Label>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
          <div className="text-xs tracking-wide text-slate-500 uppercase">
            <GeneratedText id="m_10fb4d4125aba0" />
          </div>
          <div className="text-slate-900 dark:text-slate-100">
            <GeneratedValue value={row.questionType.replace('_', ' ')} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            <GeneratedText id="m_1292ce6c839323" />
          </p>
        </div>
        <GeneratedValue
          value={
            row.questionType === 'multi_select' && row.answers.length > 0 ? (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
                <div className="text-xs tracking-wide text-slate-500 uppercase">
                  <GeneratedText id="m_0e69ebb67d27c2" />
                </div>
                <ul className="mt-1 list-inside list-disc text-slate-700 dark:text-slate-300">
                  <GeneratedValue
                    value={row.answers.map((a) => (
                      <li key={a}>
                        <GeneratedValue value={a} />
                      </li>
                    ))}
                  />
                </ul>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            row.questionType === 'yes_no' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requiresYes}
                  onChange={(e) => setRequiresYes(e.target.checked)}
                />
                <GeneratedText id="m_01b4f1b5df17f0" />
              </label>
            ) : null
          }
        />
      </div>
      <DrawerSubmitHandle
        pending={pending}
        onSubmit={submit}
        closeHref={closeHref}
        submitLabel={tGenerated('m_19e6bff894c3c7')}
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
            <GeneratedValue value={row.question} />
            <GeneratedValue
              value={
                row.requiresYes ? (
                  <span className="ml-2 text-xs text-red-600">
                    <GeneratedText id="m_1579cafa005687" />
                  </span>
                ) : null
              }
            />
          </div>
          <div className="text-xs text-slate-500">
            <GeneratedValue value={row.questionType.replace('_', ' ')} />
          </div>
        </div>
        <GeneratedValue
          value={
            disabled ? null : (
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
            )
          }
        />
      </div>
      <GeneratedValue
        value={
          row.questionType === 'yes_no' ? (
            <div className="flex items-center gap-2">
              <GeneratedValue
                value={['Yes', 'No', 'N/A'].map((v) => (
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
                    <GeneratedValue value={v} />
                  </button>
                ))}
              />
            </div>
          ) : row.questionType === 'multi_select' ? (
            <Select value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={disabled}>
              <option value="">—</option>
              <GeneratedValue
                value={row.answers.map((a) => (
                  <option key={a} value={a}>
                    <GeneratedValue value={a} />
                  </option>
                ))}
              />
            </Select>
          ) : (
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              disabled={disabled}
            />
          )
        }
      />
      <GeneratedValue
        value={
          row.questionType !== 'yes_no' && !disabled ? (
            <div className="flex items-center justify-end">
              <Button type="button" size="sm" onClick={save} disabled={pending}>
                <GeneratedText id="m_1c4c76f00e3b16" />
              </Button>
            </div>
          ) : null
        }
      />
    </li>
  )
}

// ============================================================================
// Shared row buttons
// ============================================================================

function MoveButton({
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
  const tGenerated = useGeneratedTranslations()
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
      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 sm:min-h-0 sm:min-w-0 dark:hover:bg-slate-800"
      aria-label={tGenerated('m_1c4d1fdc0a5204', { value0: direction })}
    >
      <GeneratedValue
        value={direction === 'up' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      />
    </button>
  )
}

function DeleteButton({
  id,
  assessmentId,
  action,
}: {
  id: string
  assessmentId: string
  action: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
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
      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30 sm:min-h-0 sm:min-w-0"
      aria-label={tGenerated('m_11773f3c3f7558')}
    >
      <Trash2 size={16} />
    </button>
  )
}

function EditLinkButton({ href }: { href: string }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <Link
      href={href as any}
      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded p-1 text-slate-500 hover:bg-slate-100 sm:min-h-0 sm:min-w-0 dark:hover:bg-slate-800"
      aria-label={tGenerated('m_03a66f9d34ac7b')}
    >
      <Pencil size={16} />
    </Link>
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

function DrawerSubmitHandle({
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
          <GeneratedText id="m_112e2e8ecda428" />
        </Button>
      </Link>
      <Button type="button" onClick={onSubmit} disabled={pending}>
        <GeneratedValue value={pending ? <GeneratedText id="m_106811f2aac664" /> : submitLabel} />
      </Button>
    </div>
  )
}
