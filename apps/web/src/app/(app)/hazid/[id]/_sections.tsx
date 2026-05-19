// Client-only section helpers — split out so the page itself can stay almost
// entirely server-rendered while these widgets handle the interactive UI bits.

'use client'

import { useState, useTransition } from 'react'
import { Button, Input, Label, Select, Textarea } from '@beaconhs/ui'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'

// -------------------- Task add form --------------------
export function AddTaskForm({
  assessmentId,
  taskLibrary,
  disabled,
  addAction,
}: {
  assessmentId: string
  taskLibrary: { id: string; name: string }[]
  disabled?: boolean
  addAction: (formData: FormData) => Promise<void>
}) {
  const [taskId, setTaskId] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [pending, start] = useTransition()
  function submit() {
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    if (taskId) fd.set('taskId', taskId)
    if (description) fd.set('description', description)
    start(async () => {
      await addAction(fd)
      setTaskId('')
      setDescription('')
    })
  }
  if (disabled) return null
  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3 sm:grid-cols-2">
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
      </div>
      <div className="space-y-1.5">
        <Label>Ad-hoc description (if not from library)</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short task name" />
      </div>
      <div className="flex items-center justify-end sm:col-span-2">
        <Button type="button" onClick={submit} disabled={pending}>
          <Plus size={12} /> {pending ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </div>
  )
}

// -------------------- Task row --------------------
export function TaskRow({
  row,
  assessmentId,
  totalCount,
  index,
  hazardLookup,
  taskName,
  disabled,
  updateAction,
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
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [description, setDescription] = useState<string>(row.description ?? '')
  const [controls, setControls] = useState<string>(row.controls ?? '')
  const [pending, start] = useTransition()

  function save() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('description', description)
    fd.set('controls', controls)
    start(async () => {
      await updateAction(fd)
    })
  }

  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">Task #{index + 1}</div>
          <div className="font-medium text-slate-900">{taskName ?? row.description ?? <span className="text-slate-400">— untitled —</span>}</div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Description override</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={disabled} placeholder={taskName ?? 'Task description'} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Controls</Label>
          <Textarea
            value={controls}
            onChange={(e) => setControls(e.target.value)}
            rows={2}
            disabled={disabled}
            placeholder="What controls / safe-work practices apply?"
          />
        </div>
      </div>
      {row.hazardIds.length > 0 ? (
        <div className="text-xs text-slate-500">
          Linked hazards:{' '}
          <span className="text-slate-700">
            {row.hazardIds.map((id) => hazardLookup.get(id) ?? '?').join(', ')}
          </span>
        </div>
      ) : null}
      {!disabled ? (
        <div className="flex items-center justify-end">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save row'}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

// -------------------- Hazard add form --------------------
export function AddHazardForm({
  assessmentId,
  hazardLibrary,
  hazardSets,
  disabled,
  addAction,
  addSetAction,
}: {
  assessmentId: string
  hazardLibrary: { id: string; name: string; typeName: string | null }[]
  hazardSets: { id: string; name: string; count: number }[]
  disabled?: boolean
  addAction: (formData: FormData) => Promise<void>
  addSetAction: (formData: FormData) => Promise<void>
}) {
  const [hazardId, setHazardId] = useState<string>('')
  const [setId, setSetId] = useState<string>('')
  const [adHoc, setAdHoc] = useState<string>('')
  const [pending, start] = useTransition()
  if (disabled) return null

  function add() {
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    if (hazardId) fd.set('hazardId', hazardId)
    if (adHoc) fd.set('name', adHoc)
    start(async () => {
      await addAction(fd)
      setHazardId('')
      setAdHoc('')
    })
  }
  function addSet() {
    if (!setId) return
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('setId', setId)
    start(async () => {
      await addSetAction(fd)
      setSetId('')
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>From library</Label>
          <Select value={hazardId} onChange={(e) => setHazardId(e.target.value)}>
            <option value="">— pick hazard —</option>
            {hazardLibrary.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.typeName ? ` — ${h.typeName}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Or ad-hoc hazard name</Label>
          <Input value={adHoc} onChange={(e) => setAdHoc(e.target.value)} placeholder="e.g. Sun exposure" />
        </div>
        <div className="flex items-center justify-end sm:col-span-2">
          <Button type="button" onClick={add} disabled={pending || (!hazardId && !adHoc)}>
            <Plus size={12} /> Add hazard
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Or pick a hazard set (bulk-add)</Label>
          <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="">—</option>
            {hazardSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.count})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end justify-end">
          <Button type="button" variant="outline" onClick={addSet} disabled={pending || !setId}>
            Add set
          </Button>
        </div>
      </div>
    </div>
  )
}

// -------------------- Hazard row --------------------
export function HazardRow({
  row,
  assessmentId,
  index,
  totalCount,
  libraryName,
  disabled,
  updateAction,
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
  }
  assessmentId: string
  index: number
  totalCount: number
  libraryName: string | null
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
  moveAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [specific, setSpecific] = useState<string>(row.specificControls ?? '')
  const [applicable, setApplicable] = useState<boolean>(row.applicable)
  const [pending, start] = useTransition()

  function save() {
    const fd = new FormData()
    fd.set('id', row.id)
    fd.set('assessmentId', assessmentId)
    fd.set('specificControls', specific)
    if (applicable) fd.set('applicable', 'on')
    start(async () => {
      await updateAction(fd)
    })
  }

  return (
    <li className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">Hazard #{index + 1}</div>
          <div className="font-medium text-slate-900">
            {libraryName ?? row.name ?? <span className="text-slate-400">— ad-hoc —</span>}
          </div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
            <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
            <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
            <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
          </div>
        )}
      </div>
      {row.standardControls ? (
        <div className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <span className="font-medium uppercase tracking-wide text-slate-500">Standard controls:</span>{' '}
          {row.standardControls}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Specific controls (this job)</Label>
          <Textarea value={specific} onChange={(e) => setSpecific(e.target.value)} rows={2} disabled={disabled} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Applicable</Label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={applicable} onChange={(e) => setApplicable(e.target.checked)} disabled={disabled} />
            Yes — applies to this job
          </label>
        </div>
      </div>
      {!disabled ? (
        <div className="flex items-center justify-end">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save row'}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

// -------------------- PPE add form --------------------
export function AddPPEForm({
  assessmentId,
  disabled,
  addAction,
}: {
  assessmentId: string
  disabled?: boolean
  addAction: (formData: FormData) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [required, setRequired] = useState(true)
  const [pending, start] = useTransition()
  if (disabled) return null
  function submit() {
    if (!name.trim()) return
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('name', name)
    fd.set('description', description)
    if (required) fd.set('required', 'on')
    start(async () => {
      await addAction(fd)
      setName('')
      setDescription('')
    })
  }
  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label>PPE name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hard hat" />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When / why" />
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
        <div className="flex-1" />
        <Button type="button" onClick={submit} disabled={pending}>
          <Plus size={12} /> Add PPE
        </Button>
      </div>
    </div>
  )
}

// -------------------- PPE row --------------------
export function PPERow({
  row,
  assessmentId,
  index,
  totalCount,
  disabled,
  answerAction,
  moveAction,
  deleteAction,
}: {
  row: { id: string; name: string; description: string | null; required: boolean; answer: string | null }
  assessmentId: string
  index: number
  totalCount: number
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
          {row.required ? <span className="ml-2 text-xs uppercase tracking-wide text-red-600">required</span> : null}
        </div>
        {row.description ? <div className="text-xs text-slate-500">{row.description}</div> : null}
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
          <MoveButton id={row.id} assessmentId={assessmentId} direction="up" disabled={index === 0} action={moveAction} />
          <MoveButton id={row.id} assessmentId={assessmentId} direction="down" disabled={index >= totalCount - 1} action={moveAction} />
          <DeleteButton id={row.id} assessmentId={assessmentId} action={deleteAction} />
        </div>
      )}
    </li>
  )
}

// -------------------- Question add form --------------------
export function AddQuestionForm({
  assessmentId,
  disabled,
  addAction,
}: {
  assessmentId: string
  disabled?: boolean
  addAction: (formData: FormData) => Promise<void>
}) {
  const [question, setQuestion] = useState('')
  const [questionType, setQuestionType] = useState<'yes_no' | 'text' | 'multi_select'>('yes_no')
  const [answers, setAnswers] = useState('')
  const [requiresYes, setRequiresYes] = useState(false)
  const [pending, start] = useTransition()
  if (disabled) return null
  function submit() {
    if (!question.trim()) return
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('question', question)
    fd.set('questionType', questionType)
    fd.set('answers', answers)
    if (requiresYes) fd.set('requiresYes', 'on')
    start(async () => {
      await addAction(fd)
      setQuestion('')
      setAnswers('')
      setRequiresYes(false)
    })
  }
  return (
    <div className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Question</Label>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Are all permits posted?" />
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
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Options (one per line)</Label>
            <Textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={3} />
          </div>
        ) : null}
        {questionType === 'yes_no' ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" checked={requiresYes} onChange={(e) => setRequiresYes(e.target.checked)} />
            Requires "Yes" for completion
          </label>
        ) : null}
      </div>
      <div className="flex items-center justify-end">
        <Button type="button" onClick={submit} disabled={pending}>
          <Plus size={12} /> Add question
        </Button>
      </div>
    </div>
  )
}

// -------------------- Question row --------------------
export function QuestionRow({
  row,
  assessmentId,
  index,
  totalCount,
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
            {row.requiresYes ? <span className="ml-2 text-xs text-red-600">requires yes</span> : null}
          </div>
          <div className="text-xs text-slate-500">{row.questionType.replace('_', ' ')}</div>
        </div>
        {disabled ? null : (
          <div className="flex items-center gap-1">
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

// -------------------- Atmospheric add form --------------------
export function AddAtmosphericForm({
  assessmentId,
  sensors,
  disabled,
  addAction,
}: {
  assessmentId: string
  sensors: { id: string; identifier: string }[]
  disabled?: boolean
  addAction: (formData: FormData) => Promise<void>
}) {
  const [sensorId, setSensorId] = useState('')
  const [time, setTime] = useState<string>(new Date().toISOString().slice(0, 16))
  const [s1, setS1] = useState('')
  const [s2, setS2] = useState('')
  const [s3, setS3] = useState('')
  const [s4, setS4] = useState('')
  const [distance, setDistance] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, start] = useTransition()
  if (disabled) return null
  function submit() {
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
      setS1('')
      setS2('')
      setS3('')
      setS4('')
      setDistance('')
      setNotes('')
      setTime(new Date().toISOString().slice(0, 16))
    })
  }
  return (
    <div className="space-y-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
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
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Time</Label>
          <Input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Sensor 1 (O₂ %)</Label>
          <Input value={s1} onChange={(e) => setS1(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Sensor 2 (LEL %)</Label>
          <Input value={s2} onChange={(e) => setS2(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Sensor 3 (CO ppm)</Label>
          <Input value={s3} onChange={(e) => setS3(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Sensor 4 (H₂S ppm)</Label>
          <Input value={s4} onChange={(e) => setS4(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Distance from entry</Label>
          <Input value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="e.g. 2 m below entry" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center justify-end">
        <Button type="button" onClick={submit} disabled={pending}>
          <Plus size={12} /> Add reading
        </Button>
      </div>
    </div>
  )
}

// -------------------- Entry-log add form --------------------
export function AddEntryForm({
  assessmentId,
  people: peopleList,
  disabled,
  addAction,
}: {
  assessmentId: string
  people: { id: string; firstName: string; lastName: string }[]
  disabled?: boolean
  addAction: (formData: FormData) => Promise<void>
}) {
  const [personId, setPersonId] = useState('')
  const [externalName, setExternalName] = useState('')
  const [timeIn, setTimeIn] = useState<string>(new Date().toISOString().slice(0, 16))
  const [pending, start] = useTransition()
  if (disabled) return null
  function submit() {
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    if (personId) fd.set('personId', personId)
    if (externalName) fd.set('externalName', externalName)
    fd.set('timeIn', timeIn)
    start(async () => {
      await addAction(fd)
      setPersonId('')
      setExternalName('')
      setTimeIn(new Date().toISOString().slice(0, 16))
    })
  }
  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50/40 p-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label>Person</Label>
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
        <Input value={externalName} onChange={(e) => setExternalName(e.target.value)} placeholder="Visitor full name" />
      </div>
      <div className="space-y-1.5">
        <Label>Time in</Label>
        <Input type="datetime-local" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} />
      </div>
      <div className="flex items-center justify-end sm:col-span-3">
        <Button type="button" onClick={submit} disabled={pending || (!personId && !externalName)}>
          <Plus size={12} /> Log entry
        </Button>
      </div>
    </div>
  )
}

// -------------------- Shared row buttons --------------------
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

// -------------------- Toggle sub-form (WAH/CS/AF) --------------------
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
