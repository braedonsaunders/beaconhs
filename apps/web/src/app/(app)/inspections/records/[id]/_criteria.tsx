'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Single-page criterion fill — the inspections analogue of the hazard-assessment
// row components. Each criterion is one always-live card: tap an answer to save
// it (optimistic), and the fail-only metadata (severity, reason, action taken,
// assignee, due date, corrected-on) auto-saves on blur/change. No Save buttons,
// no edit drawer — the input on the page IS the field, matching the
// hazard-assessment recipe (see @/components/live-field).

import { useState } from 'react'
import Link from 'next/link'
import { Badge, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { AlertOctagon, Camera } from 'lucide-react'
import type { InspectionSeverity } from '@/components/builder/inspection-severity'
import {
  MAX_INSPECTION_TEXT_ANSWER_LENGTH,
  inspectionCriterionIsAnswered,
  isInspectionOutcomeResponseType,
  type InspectionResponseType,
} from '@/lib/inspection-response-config'
import {
  AutosaveTextarea as AutoTextarea,
  CRITERION_SEVERITY_OPTIONS as SEVERITY_OPTS,
  CriterionPhotosPanel,
  CriterionSaveIndicator as SaveDot,
  CriterionSeverityPicker,
  useCriterionAutosave as useAutosave,
} from '@/components/inspection/criterion-controls'

type CriterionAnswer = 'pass' | 'fail' | 'n_a'
export type CriterionSeverity = InspectionSeverity
export type CriterionResponseType = InspectionResponseType

// Answer labels vary by the criterion's response type — yes/no questions read
// "Yes / No" while keeping the underlying pass/fail/n_a enum.
const ANSWER_LABELS: Record<
  'pass_fail_na' | 'rating' | 'yes_no',
  Record<CriterionAnswer, string>
> = {
  pass_fail_na: { pass: 'Pass', fail: 'Fail', n_a: 'N/A' },
  rating: { pass: 'Pass', fail: 'Fail', n_a: 'N/A' },
  yes_no: { pass: 'Yes', fail: 'No', n_a: 'N/A' },
}

type CriterionActions = {
  setAnswer: (fd: FormData) => Promise<void>
  setChoiceAnswer: (fd: FormData) => Promise<void>
  setValueAnswer: (fd: FormData) => Promise<void>
  setSeverity: (fd: FormData) => Promise<void>
  setNonCompliance: (fd: FormData) => Promise<void>
  setActionTaken: (fd: FormData) => Promise<void>
  setCompliantNote: (fd: FormData) => Promise<void>
  setAssignment: (fd: FormData) => Promise<void>
  setCorrected: (fd: FormData) => Promise<void>
  addPhotos: (fd: FormData) => Promise<void>
  updatePhoto: (
    recordId: string,
    rowId: string,
    attachmentId: string,
    input: unknown,
  ) => Promise<{ ok: boolean; error?: string }>
  removePhoto: (
    recordId: string,
    rowId: string,
    attachmentId: string,
  ) => Promise<{ ok: boolean; error?: string }>
  reorderPhotos: (
    recordId: string,
    rowId: string,
    attachmentIds: string[],
  ) => Promise<{ ok: boolean; error?: string }>
}

export function CriterionCard({
  recordId,
  rowId,
  index,
  question,
  subtext,
  responseType,
  choiceOptions,
  choiceAnswer: initialChoiceAnswer,
  textAnswer: initialTextAnswer,
  numberAnswer: initialNumberAnswer,
  requiresPhoto,
  requiresComment,
  answer: initialAnswer,
  severity: initialSeverity,
  nonComplianceDescription,
  actionTaken,
  compliantNote,
  assignedToPersonId,
  assignedDueDate,
  correctedOn,
  overdue,
  photoPreviews,
  correctiveActionRef,
  correctiveActionId,
  locked,
  allowCompliantNotes,
  actions,
}: {
  recordId: string
  rowId: string
  index: number
  question: string
  /** Optional guidance/help line shown under the question. */
  subtext?: string | null
  responseType: CriterionResponseType
  choiceOptions: string[]
  choiceAnswer: string | null
  textAnswer: string | null
  numberAnswer: string | null
  requiresPhoto: boolean
  requiresComment: boolean
  answer: CriterionAnswer | null
  severity: CriterionSeverity | null
  nonComplianceDescription: string | null
  actionTaken: string | null
  compliantNote: string | null
  assignedToPersonId: string | null
  assignedDueDate: string | null
  correctedOn: string | null
  overdue: boolean
  photoPreviews: import('@/components/photo-gallery').GalleryPhoto[]
  correctiveActionRef: string | null
  correctiveActionId: string | null
  locked: boolean
  allowCompliantNotes: boolean
  actions: CriterionActions
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const { state, save, refresh } = useAutosave()
  // Optimistic local state for the values that drive what's shown.
  const [answer, setAnswerState] = useState<CriterionAnswer | null>(initialAnswer)
  const [choiceAnswer, setChoiceAnswerState] = useState(initialChoiceAnswer ?? '')
  const [textAnswer, setTextAnswerState] = useState(initialTextAnswer ?? '')
  const [numberAnswer, setNumberAnswerState] = useState(initialNumberAnswer ?? '')
  const [severity, setSeverityState] = useState<CriterionSeverity | null>(initialSeverity)
  const [assignee, setAssignee] = useState(assignedToPersonId ?? '')
  const [due, setDue] = useState(assignedDueDate ?? '')
  const [corrected, setCorrected] = useState(correctedOn ?? '')

  const labels = isInspectionOutcomeResponseType(responseType) ? ANSWER_LABELS[responseType] : null
  const responseAnswered = inspectionCriterionIsAnswered({
    responseType,
    outcomeAnswer: answer,
    choiceAnswer: choiceAnswer || null,
    textAnswer: textAnswer || null,
    numberAnswer: numberAnswer || null,
  })

  function pickAnswer(next: CriterionAnswer) {
    setAnswerState(next)
    // Mirror the server: leaving 'fail' clears the failure metadata.
    if (next !== 'fail') {
      setSeverityState(null)
      setAssignee('')
      setDue('')
      setCorrected('')
    }
    save(actions.setAnswer, { recordId, rowId, answer: next })
  }

  function pickChoiceAnswer(next: string) {
    setChoiceAnswerState(next)
    save(actions.setChoiceAnswer, { recordId, rowId, choiceAnswer: next })
  }

  function saveValueAnswer(next: string) {
    if (responseType === 'number') setNumberAnswerState(next)
    else setTextAnswerState(next)
    save(actions.setValueAnswer, { recordId, rowId, value: next })
  }

  function pickSeverity(next: CriterionSeverity) {
    const value = severity === next ? '' : next
    setSeverityState(value === '' ? null : (value as CriterionSeverity))
    save(actions.setSeverity, { recordId, rowId, severity: value })
  }

  function saveAssignment(nextAssignee: string, nextDue: string) {
    save(actions.setAssignment, {
      recordId,
      rowId,
      assignedToPersonId: nextAssignee,
      assignedDueDate: nextDue,
    })
  }

  const tone =
    answer === 'fail'
      ? 'border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20'
      : answer === 'pass'
        ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20'
        : answer === 'n_a'
          ? 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/30'
          : responseAnswered
            ? 'border-teal-200 bg-teal-50/40 dark:border-teal-900/60 dark:bg-teal-950/20'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'

  const hasBadges =
    requiresPhoto ||
    requiresComment ||
    (Boolean(severity) && answer === 'fail') ||
    overdue ||
    (Boolean(corrected) && answer === 'fail') ||
    Boolean(correctiveActionRef)

  return (
    <div className={cn('rounded-lg border p-2.5 transition-colors sm:p-3', tone)}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-slate-900 dark:text-slate-100">
            <span className="mr-1.5 align-baseline text-xs font-normal text-slate-400 tabular-nums dark:text-slate-500">
              <GeneratedValue value={index + 1} />.
            </span>
            <span className="font-medium">
              <GeneratedValue value={question} />
            </span>
          </p>
          <GeneratedValue
            value={
              subtext ? (
                <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={subtext} />
                </p>
              ) : null
            }
          />
          <GeneratedValue
            value={
              hasBadges ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <GeneratedValue
                    value={
                      requiresPhoto ? (
                        <Badge variant="secondary" className="gap-1">
                          <Camera size={10} /> <GeneratedText id="m_013eaaf5f5bde1" />
                        </Badge>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      requiresComment ? (
                        <Badge variant="secondary">
                          <GeneratedText id="m_05543f5d84beb9" />
                        </Badge>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      severity && answer === 'fail' ? (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                            SEVERITY_OPTS.find((o) => o.value === severity)?.active,
                          )}
                        >
                          <GeneratedValue value={severity} />
                        </span>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      overdue ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-700 uppercase dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                          <AlertOctagon size={10} /> <GeneratedText id="m_1e40bdcf2d1ba1" />
                        </span>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      corrected && answer === 'fail' ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <GeneratedText id="m_0b2c1ac227de74" />{' '}
                          <GeneratedValue value={corrected} />
                        </span>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      correctiveActionRef ? (
                        <Link
                          href={`/corrective-actions/${correctiveActionId}`}
                          className="text-teal-700 hover:underline dark:text-teal-400"
                        >
                          ↳ <GeneratedValue value={correctiveActionRef} />
                        </Link>
                      ) : null
                    }
                  />
                </div>
              ) : null
            }
          />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <SaveDot state={state} />
          <GeneratedValue
            value={
              locked ? (
                <Badge variant="outline">
                  <GeneratedValue
                    value={
                      responseType === 'choice'
                        ? choiceAnswer || '—'
                        : responseType === 'text' || responseType === 'long_text'
                          ? textAnswer || '—'
                          : responseType === 'number'
                            ? numberAnswer || '—'
                            : answer
                              ? labels![answer]
                              : '—'
                    }
                  />
                </Badge>
              ) : responseType === 'choice' ? (
                <Select
                  value={choiceAnswer}
                  onChange={(event) => pickChoiceAnswer(event.target.value)}
                  aria-label={tGenerated('m_136d6440d6732f', { value0: question })}
                  className="max-w-64 min-w-40"
                >
                  <option value="">{'Select one…'}</option>
                  {choiceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : responseType === 'text' ? (
                <Input
                  value={textAnswer}
                  maxLength={MAX_INSPECTION_TEXT_ANSWER_LENGTH}
                  onChange={(event) => setTextAnswerState(event.target.value)}
                  onBlur={(event) => saveValueAnswer(event.target.value)}
                  aria-label={tGenerated('m_136d6440d6732f', { value0: question })}
                  className="w-64 max-w-[45vw]"
                />
              ) : responseType === 'long_text' ? (
                <Textarea
                  value={textAnswer}
                  maxLength={MAX_INSPECTION_TEXT_ANSWER_LENGTH}
                  rows={3}
                  onChange={(event) => setTextAnswerState(event.target.value)}
                  onBlur={(event) => saveValueAnswer(event.target.value)}
                  aria-label={tGenerated('m_136d6440d6732f', { value0: question })}
                  className="w-80 max-w-[50vw]"
                />
              ) : responseType === 'number' ? (
                <Input
                  type="number"
                  step="any"
                  value={numberAnswer}
                  onChange={(event) => setNumberAnswerState(event.target.value)}
                  onBlur={(event) => saveValueAnswer(event.target.value)}
                  aria-label={tGenerated('m_136d6440d6732f', { value0: question })}
                  className="w-40 max-w-[40vw]"
                />
              ) : (
                <div className="flex items-center gap-1">
                  <GeneratedValue
                    value={(['pass', 'fail', 'n_a'] as const).map((opt) => {
                      const active = answer === opt
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => pickAnswer(opt)}
                          aria-pressed={active}
                          className={cn(
                            'min-h-9 rounded-md border px-2.5 text-sm font-medium transition-colors sm:min-h-0 sm:py-1 sm:text-xs',
                            active
                              ? opt === 'pass'
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : opt === 'fail'
                                  ? 'border-red-500 bg-red-500 text-white'
                                  : 'border-slate-500 bg-slate-500 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                          )}
                        >
                          <GeneratedValue value={labels![opt]} />
                        </button>
                      )
                    })}
                  />
                </div>
              )
            }
          />
        </div>
      </div>

      {/* Failure metadata — only when failed and editable. */}
      <GeneratedValue
        value={
          answer === 'fail' && !locked ? (
            <div className="mt-3 space-y-3 border-t border-red-200/70 pt-3 dark:border-red-900/50">
              <CriterionSeverityPicker
                severity={severity}
                onPick={pickSeverity}
                helper={
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    <GeneratedText id="m_1f08915d9ec184" />
                  </p>
                }
              />

              <AutoTextarea
                label={tGenerated('m_04d0cf04f2240b')}
                initial={nonComplianceDescription}
                placeholder={tGenerated('m_0016970632a81e')}
                onCommit={(v) => save(actions.setNonCompliance, { recordId, rowId, value: v })}
              />
              <AutoTextarea
                label={tGenerated('m_0da1a29f41377e')}
                initial={actionTaken}
                placeholder={tGenerated('m_0692fe3c89bfd4')}
                onCommit={(v) => save(actions.setActionTaken, { recordId, rowId, value: v })}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_1a298419b85cba" />
                  </Label>
                  <RemoteSearchSelect
                    lookup="inspection-people"
                    value={assignee}
                    onChange={(next) => {
                      setAssignee(next)
                      saveAssignment(next, due)
                    }}
                    placeholder={tGenerated('m_1f2bc1976a0465')}
                    searchPlaceholder={tGenerated('m_06c2338b990aea')}
                    sheetTitle="Assign finding"
                    ariaLabel="Assigned to"
                    clearable
                    emptyLabel={tGenerated('m_1f2bc1976a0465')}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_18244bb4488b03" />
                  </Label>
                  <Input
                    type="date"
                    value={due}
                    onChange={(e) => {
                      setDue(e.target.value)
                      saveAssignment(assignee, e.target.value)
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    <GeneratedText id="m_1d319f81e2b3ae" />
                  </Label>
                  <Input
                    type="date"
                    value={corrected}
                    onChange={(e) => {
                      setCorrected(e.target.value)
                      save(actions.setCorrected, { recordId, rowId, correctedOn: e.target.value })
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null
        }
      />

      {/* Compliant note — pass / N-A, when the type allows it. Criteria that
          require a comment always get the field (the submit gate enforces it). */}
      <GeneratedValue
        value={
          (allowCompliantNotes || requiresComment) &&
          responseAnswered &&
          answer !== 'fail' &&
          !locked ? (
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <AutoTextarea
                label={tGeneratedValue(
                  requiresComment ? tGenerated('m_1d0999bf7378f8') : tGenerated('m_0256671f892999'),
                )}
                initial={compliantNote}
                rows={1}
                placeholder={tGenerated('m_152b01fa42432d')}
                onCommit={(v) => save(actions.setCompliantNote, { recordId, rowId, value: v })}
              />
            </div>
          ) : null
        }
      />

      {/* Photos — always offered on fails and on photo-required criteria (the
          submit gate refuses photo-required rows with no attachment). */}
      <GeneratedValue
        value={
          photoPreviews.length > 0 || (!locked && (answer === 'fail' || requiresPhoto)) ? (
            <CriterionPhotosPanel
              photoPreviews={photoPreviews}
              editable={!locked}
              recordId={recordId}
              rowId={rowId}
              addPhotos={actions.addPhotos}
              updatePhoto={actions.updatePhoto}
              removePhoto={actions.removePhoto}
              reorderPhotos={actions.reorderPhotos}
              onDone={refresh}
            />
          ) : null
        }
      />

      {/* Locked read-only summary */}
      <GeneratedValue
        value={
          locked &&
          (nonComplianceDescription ||
            actionTaken ||
            compliantNote ||
            assignedDueDate ||
            corrected) ? (
            <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <GeneratedValue
                value={
                  severity ? (
                    <div>
                      <GeneratedText id="m_104cb4e8ca96db" /> <GeneratedValue value={severity} />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  nonComplianceDescription ? (
                    <div>
                      <GeneratedText id="m_12fc6abc8edf57" />{' '}
                      <GeneratedValue value={nonComplianceDescription} />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  actionTaken ? (
                    <div>
                      <GeneratedText id="m_19a70f86732c4c" /> <GeneratedValue value={actionTaken} />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  assignedDueDate ? (
                    <div>
                      <GeneratedText id="m_127e9d33555bb5" />{' '}
                      <GeneratedValue value={assignedDueDate} />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  corrected ? (
                    <div>
                      <GeneratedText id="m_0b5e3c4f1ee0cf" /> <GeneratedValue value={corrected} />
                    </div>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  compliantNote ? (
                    <div>
                      <GeneratedText id="m_0a37275b6826e2" />{' '}
                      <GeneratedValue value={compliantNote} />
                    </div>
                  ) : null
                }
              />
            </div>
          ) : null
        }
      />
    </div>
  )
}
