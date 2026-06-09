'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import {
  AudiencePicker,
  type AudienceItem,
  type AudienceOptions,
  type AudienceType,
} from '@/components/audience-picker'
import { RecurrencePicker, type RecurrenceValue } from '@/components/recurrence-picker'
import { KIND_META, OBLIGATION_KINDS, type ObligationKind, kindLabel } from '../_meta'
import { createObligation, type ObligationInput } from '../_actions'

export type ObligationTargets = {
  inspectionTypes: { id: string; name: string }[]
  documents: { id: string; title: string }[]
  courses: { id: string; label: string }[]
  assessmentTypes: { id: string; name: string }[]
  formTemplates: { id: string; name: string }[]
  equipmentTypes: { id: string; name: string }[]
  ppeTypes: { id: string; name: string }[]
  jobTitles: { id: string; name: string }[]
}

function defaultRecurrence(kind: ObligationKind): RecurrenceValue {
  const f = KIND_META[kind].recurrence
  return {
    kind: f.recurring ? 'frequency' : 'one_time',
    frequency: 'week',
    quantity: 1,
    compliantPercentage: 100,
    remindBeforeDays: 7,
  }
}

export function ObligationForm({
  initialKind,
  targets,
  audienceOptions,
}: {
  initialKind: ObligationKind
  targets: ObligationTargets
  audienceOptions: AudienceOptions
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const [kind, setKind] = useState<ObligationKind>(initialKind)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [inspectionTypeId, setInspectionTypeId] = useState(targets.inspectionTypes[0]?.id ?? '')
  const [documentId, setDocumentId] = useState(targets.documents[0]?.id ?? '')
  const [trainingItemKind, setTrainingItemKind] = useState<'course' | 'assessment_type'>('course')
  const [courseId, setCourseId] = useState('')
  const [assessmentTypeId, setAssessmentTypeId] = useState('')
  const [formTemplateId, setFormTemplateId] = useState(targets.formTemplates[0]?.id ?? '')
  const [equipmentTypeId, setEquipmentTypeId] = useState(targets.equipmentTypes[0]?.id ?? '')
  const [ppeTypeId, setPpeTypeId] = useState(targets.ppeTypes[0]?.id ?? '')
  const [jobTitleId, setJobTitleId] = useState(targets.jobTitles[0]?.id ?? '')

  const meta = KIND_META[kind]
  const [audience, setAudience] = useState<AudienceItem[]>([])
  const [pendingType, setPendingType] = useState<AudienceType>(meta.audienceTypes[0] ?? 'everyone')
  const [pendingValue, setPendingValue] = useState('')
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(defaultRecurrence(initialKind))
  const [error, setError] = useState<string | null>(null)

  function changeKind(next: ObligationKind) {
    setKind(next)
    setAudience([])
    setPendingType(KIND_META[next].audienceTypes[0] ?? 'everyone')
    setPendingValue('')
    setRecurrence(defaultRecurrence(next))
    setError(null)
  }

  const showRecurrence = Object.values(meta.recurrence).some(Boolean)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (kind === 'journal' && !title.trim()) {
      setError('Give the journal obligation a name.')
      return
    }
    const input: ObligationInput = {
      kind,
      title: title.trim(),
      notes: notes.trim() || null,
      audience: meta.audience ? audience : [],
      recurrence,
      inspectionTypeId: kind === 'inspection' ? inspectionTypeId : undefined,
      documentId: kind === 'document' ? documentId : undefined,
      trainingItemKind: kind === 'training' ? trainingItemKind : undefined,
      courseId: kind === 'training' || kind === 'cert_requirement' ? courseId : undefined,
      assessmentTypeId: kind === 'training' ? assessmentTypeId : undefined,
      formTemplateId: kind === 'form' ? formTemplateId : undefined,
      equipmentTypeId: kind === 'equipment_inspection' ? equipmentTypeId : undefined,
      ppeTypeId: kind === 'ppe_inspection' ? ppeTypeId : undefined,
      jobTitleId: kind === 'job_title_signoff' ? jobTitleId : undefined,
    }
    start(async () => {
      const res = await createObligation(input)
      if (res.ok) {
        router.push(`/compliance/obligations/${res.id}`)
        router.refresh()
      } else {
        setError(res.error || 'Failed to create obligation')
      }
    })
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Obligation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ob-kind">Kind *</Label>
            <Select id="ob-kind" value={kind} onChange={(e) => changeKind(e.target.value as ObligationKind)}>
              {OBLIGATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">{meta.hint}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ob-title">Title {kind === 'journal' ? '*' : '(optional)'}</Label>
              <Input
                id="ob-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'journal' ? 'e.g. Daily field journal' : 'Falls back to the kind name'}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ob-notes">Notes</Label>
              <Textarea id="ob-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {meta.target !== 'journalName' ? (
        <Card>
          <CardHeader>
            <CardTitle>What to require</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {meta.target === 'inspectionType' ? (
              <TargetSelect value={inspectionTypeId} onChange={setInspectionTypeId} placeholder="inspection type" options={targets.inspectionTypes.map((t) => ({ id: t.id, label: t.name }))} />
            ) : null}
            {meta.target === 'document' ? (
              <TargetSelect value={documentId} onChange={setDocumentId} placeholder="document" options={targets.documents.map((d) => ({ id: d.id, label: d.title }))} />
            ) : null}
            {meta.target === 'cert' ? (
              <TargetSelect value={courseId} onChange={setCourseId} placeholder="certification (course)" options={targets.courses.map((c) => ({ id: c.id, label: c.label }))} />
            ) : null}
            {meta.target === 'formTemplate' ? (
              <TargetSelect value={formTemplateId} onChange={setFormTemplateId} placeholder="app / form template" options={targets.formTemplates.map((t) => ({ id: t.id, label: t.name }))} />
            ) : null}
            {meta.target === 'equipmentType' ? (
              <TargetSelect value={equipmentTypeId} onChange={setEquipmentTypeId} placeholder="equipment type" options={targets.equipmentTypes.map((t) => ({ id: t.id, label: t.name }))} />
            ) : null}
            {meta.target === 'ppeType' ? (
              <TargetSelect value={ppeTypeId} onChange={setPpeTypeId} placeholder="PPE type" options={targets.ppeTypes.map((t) => ({ id: t.id, label: t.name }))} />
            ) : null}
            {meta.target === 'jobTitle' ? (
              <TargetSelect value={jobTitleId} onChange={setJobTitleId} placeholder="job title" options={targets.jobTitles.map((t) => ({ id: t.id, label: t.name }))} />
            ) : null}
            {meta.target === 'trainingItem' ? (
              <div className="space-y-3">
                <Select value={trainingItemKind} onChange={(e) => setTrainingItemKind(e.target.value as 'course' | 'assessment_type')}>
                  <option value="course">Course</option>
                  <option value="assessment_type">Assessment (graded quiz)</option>
                </Select>
                {trainingItemKind === 'course' ? (
                  <TargetSelect value={courseId} onChange={setCourseId} placeholder="course" options={targets.courses.map((c) => ({ id: c.id, label: c.label }))} />
                ) : (
                  <TargetSelect value={assessmentTypeId} onChange={setAssessmentTypeId} placeholder="assessment type" options={targets.assessmentTypes.map((t) => ({ id: t.id, label: t.name }))} />
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {meta.audience ? (
        <AudiencePicker
          value={audience}
          onChange={setAudience}
          options={audienceOptions}
          allowedTypes={meta.audienceTypes}
          pendingType={pendingType}
          onPendingTypeChange={setPendingType}
          pendingValue={pendingValue}
          onPendingValueChange={setPendingValue}
        />
      ) : null}

      {showRecurrence ? (
        <RecurrencePicker value={recurrence} onChange={setRecurrence} fields={meta.recurrence} />
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Link href="/compliance/obligations">
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create obligation'}
        </Button>
      </div>
    </form>
  )
}

function TargetSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: { id: string; label: string }[]
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Pick a {placeholder} —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}
