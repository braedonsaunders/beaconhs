'use client'

// The unified obligation form — one form for every compliance kind, used by
// both the create page (no `initial`) and the edit page (`initial` set). The
// kind is fixed after creation: it determines the subject shape, target picker
// and evaluation adapter.

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
import type { ComplianceTargetRef } from '@beaconhs/db/schema'
import {
  AudiencePicker,
  type AudienceItem,
  type AudienceOptions,
  type AudienceType,
} from '@/components/audience-picker'
import { RecurrencePicker } from '@/components/recurrence-picker'
import type { RecurrenceValue } from '@/components/recurrence'
import { KIND_META, OBLIGATION_KINDS, type ObligationKind, kindLabel } from './_meta'
import { createObligation, updateObligation, type ObligationInput } from './_actions'

export type ObligationTargets = {
  inspectionTypes: { id: string; name: string }[]
  documents: { id: string; title: string }[]
  courses: { id: string; label: string }[]
  assessmentTypes: { id: string; name: string }[]
  skillTypes: { id: string; name: string }[]
  formTemplates: { id: string; name: string }[]
  equipmentTypes: { id: string; name: string }[]
  ppeTypes: { id: string; name: string }[]
  jobTitles: { id: string; name: string }[]
}

/** Stored values an edit page seeds the form with. */
export type ObligationFormInitial = {
  id: string
  title: string
  notes: string | null
  audience: AudienceItem[]
  recurrence: RecurrenceValue
  targetRef: ComplianceTargetRef
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
  initial,
}: {
  initialKind: ObligationKind
  targets: ObligationTargets
  audienceOptions: AudienceOptions
  initial?: ObligationFormInitial
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const editing = Boolean(initial)
  const ref = initial?.targetRef ?? {}

  const [kind, setKind] = useState<ObligationKind>(initialKind)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [inspectionTypeId, setInspectionTypeId] = useState(
    ref.inspectionTypeId ?? targets.inspectionTypes[0]?.id ?? '',
  )
  const [documentId, setDocumentId] = useState(ref.documentId ?? targets.documents[0]?.id ?? '')
  const [trainingItemKind, setTrainingItemKind] = useState<'course' | 'assessment_type'>(
    ref.trainingItemKind ?? 'course',
  )
  const [courseId, setCourseId] = useState(ref.courseId ?? '')
  const [assessmentTypeId, setAssessmentTypeId] = useState(ref.assessmentTypeId ?? '')
  const [certItemKind, setCertItemKind] = useState<'course' | 'skill'>(
    ref.skillTypeId ? 'skill' : 'course',
  )
  const [skillTypeId, setSkillTypeId] = useState(ref.skillTypeId ?? '')
  const [formTemplateId, setFormTemplateId] = useState(
    ref.formTemplateId ?? targets.formTemplates[0]?.id ?? '',
  )
  const [equipmentTypeId, setEquipmentTypeId] = useState(
    ref.equipmentTypeId ?? targets.equipmentTypes[0]?.id ?? '',
  )
  const [ppeTypeId, setPpeTypeId] = useState(ref.ppeTypeId ?? targets.ppeTypes[0]?.id ?? '')
  const [jobTitleId, setJobTitleId] = useState(ref.jobTitleId ?? targets.jobTitles[0]?.id ?? '')

  const meta = KIND_META[kind]
  const [audience, setAudience] = useState<AudienceItem[]>(initial?.audience ?? [])
  const [pendingType, setPendingType] = useState<AudienceType>(meta.audienceTypes[0] ?? 'everyone')
  const [pendingValue, setPendingValue] = useState('')
  const [recurrence, setRecurrence] = useState<RecurrenceValue>(
    initial?.recurrence ?? defaultRecurrence(initialKind),
  )
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
  const cancelHref = editing ? `/compliance/obligations/${initial!.id}` : '/compliance/obligations'

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
      courseId:
        kind === 'training' || (kind === 'cert_requirement' && certItemKind === 'course')
          ? courseId
          : undefined,
      assessmentTypeId: kind === 'training' ? assessmentTypeId : undefined,
      certItemKind: kind === 'cert_requirement' ? certItemKind : undefined,
      skillTypeId:
        kind === 'cert_requirement' && certItemKind === 'skill' ? skillTypeId : undefined,
      formTemplateId: kind === 'form' ? formTemplateId : undefined,
      equipmentTypeId: kind === 'equipment_inspection' ? equipmentTypeId : undefined,
      ppeTypeId: kind === 'ppe_inspection' ? ppeTypeId : undefined,
      jobTitleId: kind === 'job_title_signoff' ? jobTitleId : undefined,
    }
    start(async () => {
      const res = editing
        ? await updateObligation(initial!.id, input)
        : await createObligation(input)
      if (res.ok) {
        router.push(`/compliance/obligations/${res.id}`)
        router.refresh()
      } else {
        setError(
          res.error || (editing ? 'Failed to save obligation' : 'Failed to create obligation'),
        )
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
            <Select
              id="ob-kind"
              value={kind}
              disabled={editing}
              onChange={(e) => changeKind(e.target.value as ObligationKind)}
            >
              {OBLIGATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">
              {editing
                ? 'The kind is fixed after creation — delete and recreate to change it.'
                : meta.hint}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ob-title">Title {kind === 'journal' ? '*' : '(optional)'}</Label>
              <Input
                id="ob-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  kind === 'journal' ? 'e.g. Daily field journal' : 'Falls back to the kind name'
                }
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ob-notes">Notes</Label>
              <Textarea
                id="ob-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
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
              <TargetSelect
                value={inspectionTypeId}
                onChange={setInspectionTypeId}
                placeholder="inspection type"
                options={targets.inspectionTypes.map((t) => ({ id: t.id, label: t.name }))}
              />
            ) : null}
            {meta.target === 'document' ? (
              <TargetSelect
                value={documentId}
                onChange={setDocumentId}
                placeholder="document"
                options={targets.documents.map((d) => ({ id: d.id, label: d.title }))}
              />
            ) : null}
            {meta.target === 'cert' ? (
              <div className="space-y-3">
                <Select
                  value={certItemKind}
                  onChange={(e) => setCertItemKind(e.target.value as 'course' | 'skill')}
                >
                  <option value="course">Certification (course)</option>
                  <option value="skill">Skill type</option>
                </Select>
                {certItemKind === 'course' ? (
                  <TargetSelect
                    value={courseId}
                    onChange={setCourseId}
                    placeholder="certification (course)"
                    options={targets.courses.map((c) => ({ id: c.id, label: c.label }))}
                  />
                ) : (
                  <TargetSelect
                    value={skillTypeId}
                    onChange={setSkillTypeId}
                    placeholder="skill type"
                    options={targets.skillTypes.map((s) => ({ id: s.id, label: s.name }))}
                  />
                )}
              </div>
            ) : null}
            {meta.target === 'formTemplate' ? (
              <TargetSelect
                value={formTemplateId}
                onChange={setFormTemplateId}
                placeholder="app / form template"
                options={targets.formTemplates.map((t) => ({ id: t.id, label: t.name }))}
              />
            ) : null}
            {meta.target === 'equipmentType' ? (
              <TargetSelect
                value={equipmentTypeId}
                onChange={setEquipmentTypeId}
                placeholder="equipment type"
                options={targets.equipmentTypes.map((t) => ({ id: t.id, label: t.name }))}
              />
            ) : null}
            {meta.target === 'ppeType' ? (
              <TargetSelect
                value={ppeTypeId}
                onChange={setPpeTypeId}
                placeholder="PPE type"
                options={targets.ppeTypes.map((t) => ({ id: t.id, label: t.name }))}
              />
            ) : null}
            {meta.target === 'jobTitle' ? (
              <TargetSelect
                value={jobTitleId}
                onChange={setJobTitleId}
                placeholder="job title"
                options={targets.jobTitles.map((t) => ({ id: t.id, label: t.name }))}
              />
            ) : null}
            {meta.target === 'trainingItem' ? (
              <div className="space-y-3">
                <Select
                  value={trainingItemKind}
                  onChange={(e) =>
                    setTrainingItemKind(e.target.value as 'course' | 'assessment_type')
                  }
                >
                  <option value="course">Course</option>
                  <option value="assessment_type">Assessment (graded quiz)</option>
                </Select>
                {trainingItemKind === 'course' ? (
                  <TargetSelect
                    value={courseId}
                    onChange={setCourseId}
                    placeholder="course"
                    options={targets.courses.map((c) => ({ id: c.id, label: c.label }))}
                  />
                ) : (
                  <TargetSelect
                    value={assessmentTypeId}
                    onChange={setAssessmentTypeId}
                    placeholder="assessment type"
                    options={targets.assessmentTypes.map((t) => ({ id: t.id, label: t.name }))}
                  />
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
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Link href={cancelHref}>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={pending}>
          {pending
            ? editing
              ? 'Saving…'
              : 'Creating…'
            : editing
              ? 'Save changes'
              : 'Create obligation'}
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
