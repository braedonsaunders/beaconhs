'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
import { RemoteSearchSelect } from '@/components/remote-search-select'
import type { RecurrenceValue } from '@/components/recurrence'
import type { PickerLookup } from '@/lib/picker-options'
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
  prefillTargetRef,
  onClose,
}: {
  initialKind: ObligationKind
  targets: ObligationTargets
  audienceOptions: AudienceOptions
  initial?: ObligationFormInitial
  // Pre-select the target for a NEW obligation (e.g. arriving from a Builder
  // app's "make this a compliance obligation" link). Unlike `initial`, this does
  // NOT put the form in edit mode.
  prefillTargetRef?: ComplianceTargetRef
  // Supplied when the form is hosted in a drawer (edit flyout): on success or
  // cancel the form calls this instead of navigating to the detail page itself.
  onClose?: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const editing = Boolean(initial)
  const embedded = Boolean(onClose)
  const ref = initial?.targetRef ?? prefillTargetRef ?? {}

  const [kind, setKind] = useState<ObligationKind>(initialKind)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [inspectionTypeId, setInspectionTypeId] = useState(ref.inspectionTypeId ?? '')
  const [documentId, setDocumentId] = useState(ref.documentId ?? '')
  const [trainingItemKind, setTrainingItemKind] = useState<'course' | 'assessment_type'>(
    ref.trainingItemKind ?? 'course',
  )
  const [courseId, setCourseId] = useState(ref.courseId ?? '')
  const [assessmentTypeId, setAssessmentTypeId] = useState(ref.assessmentTypeId ?? '')
  const [certItemKind, setCertItemKind] = useState<'course' | 'skill'>(
    ref.skillTypeId ? 'skill' : 'course',
  )
  const [skillTypeId, setSkillTypeId] = useState(ref.skillTypeId ?? '')
  const [formTemplateId, setFormTemplateId] = useState(ref.formTemplateId ?? '')
  const [equipmentTypeId, setEquipmentTypeId] = useState(ref.equipmentTypeId ?? '')
  const [ppeTypeId, setPpeTypeId] = useState(ref.ppeTypeId ?? '')
  const [jobTitleId, setJobTitleId] = useState(ref.jobTitleId ?? '')

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
    setError(tGeneratedValue(null))
  }

  const showRecurrence = Object.values(meta.recurrence).some(Boolean)
  const cancelHref = editing ? `/compliance/obligations/${initial!.id}` : '/compliance/obligations'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(tGeneratedValue(null))
    if (kind === 'journal' && !title.trim()) {
      setError(tGenerated('m_0fe4ce5672c759'))
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
        if (onClose) {
          onClose()
        } else {
          router.push(`/compliance/obligations/${res.id}`)
          router.refresh()
        }
      } else {
        setError(
          tGeneratedValue(
            res.error ||
              (editing ? tGenerated('m_07fd3686ec112e') : tGenerated('m_097ae1482033f8')),
          ),
        )
      }
    })
  }

  return (
    <form onSubmit={submit} className={embedded ? 'space-y-5' : 'mt-6 space-y-5'}>
      <Card>
        <CardHeader>
          <CardTitle>
            <GeneratedText id="m_186a52fb889daf" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ob-kind">
              <GeneratedText id="m_177f2cd709878a" />
            </Label>
            <Select
              id="ob-kind"
              value={kind}
              disabled={editing}
              onChange={(e) => changeKind(e.target.value as ObligationKind)}
            >
              <GeneratedValue
                value={OBLIGATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    <GeneratedValue value={kindLabel(k)} />
                  </option>
                ))}
              />
            </Select>
            <p className="text-xs text-slate-500">
              <GeneratedValue
                value={editing ? <GeneratedText id="m_012f19ff613100" /> : meta.hint}
              />
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ob-title">
                <GeneratedText id="m_0decefd558c355" />{' '}
                <GeneratedValue
                  value={kind === 'journal' ? '*' : <GeneratedText id="m_1f61ed87b795bd" />}
                />
              </Label>
              <Input
                id="ob-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tGeneratedValue(
                  kind === 'journal'
                    ? tGenerated('m_1157a96b290c11')
                    : tGenerated('m_053fb966c03797'),
                )}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ob-notes">
                <GeneratedText id="m_0b8dadcb78cd08" />
              </Label>
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

      <GeneratedValue
        value={
          meta.target !== 'journalName' && meta.target !== 'none' ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_1f502396ce15e2" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <GeneratedValue
                  value={
                    meta.target === 'inspectionType' ? (
                      <TargetSelect
                        lookup="compliance-obligation-inspection-types"
                        value={inspectionTypeId}
                        onChange={setInspectionTypeId}
                        placeholder={tGenerated('m_05d2f6e00eb8b5')}
                        options={targets.inspectionTypes.map((t) => ({ id: t.id, label: t.name }))}
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'document' ? (
                      <TargetSelect
                        lookup="compliance-obligation-documents"
                        value={documentId}
                        onChange={setDocumentId}
                        placeholder={tGenerated('m_08927559ee23e3')}
                        options={targets.documents.map((d) => ({ id: d.id, label: d.title }))}
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'cert' ? (
                      <div className="space-y-3">
                        <Select
                          value={certItemKind}
                          onChange={(e) => setCertItemKind(e.target.value as 'course' | 'skill')}
                        >
                          <option value="course">
                            <GeneratedText id="m_0dec824473c3c4" />
                          </option>
                          <option value="skill">
                            <GeneratedText id="m_0d77c6bf9fe7a3" />
                          </option>
                        </Select>
                        <GeneratedValue
                          value={
                            certItemKind === 'course' ? (
                              <TargetSelect
                                lookup="compliance-obligation-courses"
                                value={courseId}
                                onChange={setCourseId}
                                placeholder={tGenerated('m_1c702dc1690d62')}
                                options={targets.courses.map((c) => ({ id: c.id, label: c.label }))}
                              />
                            ) : (
                              <TargetSelect
                                lookup="compliance-obligation-skill-types"
                                value={skillTypeId}
                                onChange={setSkillTypeId}
                                placeholder={tGenerated('m_0517043c1615d8')}
                                options={targets.skillTypes.map((s) => ({
                                  id: s.id,
                                  label: s.name,
                                }))}
                              />
                            )
                          }
                        />
                      </div>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'formTemplate' ? (
                      <TargetSelect
                        lookup="compliance-obligation-form-templates"
                        value={formTemplateId}
                        onChange={setFormTemplateId}
                        placeholder={tGenerated('m_0e039a5f33b261')}
                        options={targets.formTemplates.map((t) => ({ id: t.id, label: t.name }))}
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'equipmentType' ? (
                      <TargetSelect
                        lookup="compliance-obligation-equipment-types"
                        value={equipmentTypeId}
                        onChange={setEquipmentTypeId}
                        placeholder={tGenerated('m_0bfe8ba4c03426')}
                        options={targets.equipmentTypes.map((t) => ({ id: t.id, label: t.name }))}
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'ppeType' ? (
                      <TargetSelect
                        lookup="compliance-obligation-ppe-types"
                        value={ppeTypeId}
                        onChange={setPpeTypeId}
                        placeholder={tGenerated('m_0bdc13fe741bfd')}
                        options={targets.ppeTypes.map((t) => ({ id: t.id, label: t.name }))}
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'jobTitle' ? (
                      <TargetSelect
                        lookup="compliance-obligation-job-titles"
                        value={jobTitleId}
                        onChange={setJobTitleId}
                        placeholder={tGenerated('m_185066327b7459')}
                        options={targets.jobTitles.map((t) => ({ id: t.id, label: t.name }))}
                      />
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    meta.target === 'trainingItem' ? (
                      <div className="space-y-3">
                        <Select
                          value={trainingItemKind}
                          onChange={(e) =>
                            setTrainingItemKind(e.target.value as 'course' | 'assessment_type')
                          }
                        >
                          <option value="course">
                            <GeneratedText id="m_14fc1e0739b60e" />
                          </option>
                          <option value="assessment_type">
                            <GeneratedText id="m_07c3c257b72ebf" />
                          </option>
                        </Select>
                        <GeneratedValue
                          value={
                            trainingItemKind === 'course' ? (
                              <TargetSelect
                                lookup="compliance-obligation-courses"
                                value={courseId}
                                onChange={setCourseId}
                                placeholder={tGenerated('m_10c061343d4223')}
                                options={targets.courses.map((c) => ({ id: c.id, label: c.label }))}
                              />
                            ) : (
                              <TargetSelect
                                lookup="compliance-obligation-assessment-types"
                                value={assessmentTypeId}
                                onChange={setAssessmentTypeId}
                                placeholder={tGenerated('m_0c8e079fa860f7')}
                                options={targets.assessmentTypes.map((t) => ({
                                  id: t.id,
                                  label: t.name,
                                }))}
                              />
                            )
                          }
                        />
                      </div>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          ) : null
        }
      />

      <GeneratedValue
        value={
          meta.audience ? (
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
          ) : null
        }
      />

      <GeneratedValue
        value={
          showRecurrence ? (
            <RecurrencePicker
              value={recurrence}
              onChange={setRecurrence}
              fields={meta.recurrence}
            />
          ) : null
        }
      />

      <GeneratedValue
        value={
          error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <GeneratedValue value={error} />
            </div>
          ) : null
        }
      />

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
        <GeneratedValue
          value={
            embedded ? (
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                <GeneratedText id="m_112e2e8ecda428" />
              </Button>
            ) : (
              <Link href={cancelHref}>
                <Button type="button" variant="outline" disabled={pending}>
                  <GeneratedText id="m_112e2e8ecda428" />
                </Button>
              </Link>
            )
          }
        />
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={
              pending ? (
                editing ? (
                  <GeneratedText id="m_106811f2aac664" />
                ) : (
                  <GeneratedText id="m_14edc14616e78d" />
                )
              ) : editing ? (
                <GeneratedText id="m_1ab9025ed1067c" />
              ) : (
                <GeneratedText id="m_091151509dd3fd" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}

function TargetSelect({
  lookup,
  value,
  onChange,
  placeholder,
  options,
}: {
  lookup: PickerLookup
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: { id: string; label: string }[]
}) {
  const tGenerated = useGeneratedTranslations()
  const initialOption = options.find((candidate) => candidate.id === value)
  return (
    <RemoteSearchSelect
      lookup={lookup}
      value={value}
      onChange={onChange}
      initialOption={
        initialOption ? { value: initialOption.id, label: initialOption.label } : undefined
      }
      placeholder={tGenerated('m_1c66e8f32eb556', { value0: placeholder })}
      searchPlaceholder={tGenerated('m_13a874065f07f8', { value0: placeholder })}
      sheetTitle={`Pick a ${placeholder}`}
      ariaLabel={`Pick a ${placeholder}`}
      clearable
      emptyLabel={tGenerated('m_1c66e8f32eb556', { value0: placeholder })}
    />
  )
}
