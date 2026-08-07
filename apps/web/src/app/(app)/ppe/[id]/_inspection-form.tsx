'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Criteria-driven inspection form for the PPE record page.
//
// Behaviour (per spec):
//   - No "manual overall result" — the result is derived from the answers.
//   - Every criterion MUST be answered before the form can submit.
//   - A live Pass / Fail / Incomplete status shows as you go.
//
// The radios carry `name="criterion_<id>"` so the existing server action reads
// them straight from FormData; the controlled state drives the live status and
// the submit gate. High+ severity fails still auto-spawn a corrective action
// server-side.

import * as React from 'react'
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import { Badge, Button, Input, Label, Textarea, UrlDrawer, cn } from '@beaconhs/ui'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { RemoteSelectField } from '@/components/remote-search-select'

type Answer = 'pass' | 'fail' | 'n_a'
type Criterion = {
  id: string
  question: string
  description: string | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  requiresPhoto: boolean
}

const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'n_a', label: 'N/A' },
]

export function PpeInspectionForm({
  open,
  closeHref,
  title,
  description,
  itemId,
  typeId,
  kind,
  criteria,
  action,
}: {
  open: boolean
  closeHref: string
  title: string
  description?: string
  itemId: string
  typeId: string
  kind: 'pre_use' | 'annual'
  criteria: Criterion[]
  action: (fd: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({})
  const [reasons, setReasons] = React.useState<Record<string, string>>({})
  const [photos, setPhotos] = React.useState<Record<string, AttachedFile[]>>({})
  const [uploading, setUploading] = React.useState<Record<string, boolean>>({})

  const answeredCount = criteria.filter((c) => answers[c.id]).length
  const missingEvidence = criteria.filter((criterion) => {
    const answer = answers[criterion.id]
    if (!answer) return false
    if (answer === 'fail' && !(reasons[criterion.id] ?? '').trim()) return true
    return criterion.requiresPhoto && answer !== 'n_a' && (photos[criterion.id]?.length ?? 0) === 0
  }).length
  const uploadingCount = Object.values(uploading).filter(Boolean).length
  const allAnswered =
    criteria.length > 0 &&
    answeredCount === criteria.length &&
    missingEvidence === 0 &&
    uploadingCount === 0
  const anyFail = criteria.some((c) => answers[c.id] === 'fail')
  const status: 'pass' | 'fail' | 'incomplete' = !allAnswered
    ? 'incomplete'
    : anyFail
      ? 'fail'
      : 'pass'

  const kindLabel = kind === 'annual' ? 'Annual' : 'Pre-use'

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={title}
      description={description}
      size="lg"
      footer={
        // The drawer's own footer sits OUTSIDE the scroll container. A sticky
        // bar inside it competed with the scrolling list: answers changed the
        // content height, and the tail of the checklist rendered under and past
        // the bar — the drawer appeared to lurch and end early.
        <div className="flex w-full items-center justify-between gap-3">
          <StatusBadge
            status={status}
            answered={answeredCount}
            total={criteria.length}
            missingEvidence={missingEvidence}
            uploadingCount={uploadingCount}
          />
          <Button type="submit" form="ppe-inspection-form" disabled={!allAnswered}>
            <GeneratedValue
              value={
                status === 'fail' ? (
                  <GeneratedText id="m_1ed7946243bd47" />
                ) : (
                  <GeneratedText id="m_1867ec444b9ac8" />
                )
              }
            />
          </Button>
        </div>
      }
    >
      <form id="ppe-inspection-form" action={action}>
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="typeId" value={typeId} />
        <input type="hidden" name="kind" value={kind} />

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                <GeneratedValue value={kindLabel} /> <GeneratedText id="m_0196fe7432bec3" />
              </p>
              <p className="text-xs text-slate-500">
                <GeneratedText id="m_1e7a6e975f16ba" />
              </p>
            </div>
            <StatusBadge
              status={status}
              answered={answeredCount}
              total={criteria.length}
              missingEvidence={missingEvidence}
              uploadingCount={uploadingCount}
            />
          </div>

          <ul className="space-y-2">
            <GeneratedValue
              value={criteria.map((c, i) => (
                <li
                  key={c.id}
                  className={cn(
                    'rounded border bg-white p-3 dark:bg-slate-900',
                    answers[c.id] === 'fail'
                      ? 'border-red-300 dark:border-red-900'
                      : 'border-slate-200 dark:border-slate-800',
                  )}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                        <span className="text-slate-400">
                          <GeneratedValue value={i + 1} />.
                        </span>
                        <span className="flex-1">
                          <GeneratedValue value={c.question} />
                        </span>
                        <Badge
                          variant={
                            c.severity === 'critical' || c.severity === 'high'
                              ? 'destructive'
                              : c.severity === 'medium'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          <GeneratedValue value={c.severity} />
                        </Badge>
                      </div>
                      <GeneratedValue
                        value={
                          c.description ? (
                            <p className="mt-1 text-xs text-slate-500">
                              <GeneratedValue value={c.description} />
                            </p>
                          ) : null
                        }
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <GeneratedValue
                        value={ANSWERS.map((a) => {
                          const active = answers[c.id] === a.value
                          return (
                            <label
                              key={a.value}
                              className={cn(
                                'cursor-pointer rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                                active && a.value === 'pass'
                                  ? 'border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                                  : active && a.value === 'fail'
                                    ? 'border-red-400 bg-red-100 text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200'
                                    : active
                                      ? 'border-slate-400 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
                                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
                              )}
                            >
                              <input
                                type="radio"
                                name={`criterion_${c.id}`}
                                value={a.value}
                                checked={active}
                                disabled={uploading[c.id] === true}
                                onChange={() =>
                                  setAnswers((prev) => ({ ...prev, [c.id]: a.value }))
                                }
                                className="sr-only"
                              />
                              <GeneratedValue value={a.label} />
                            </label>
                          )
                        })}
                      />
                    </div>
                  </div>
                  <GeneratedValue
                    value={
                      answers[c.id] === 'fail' ? (
                        <div className="mt-3 space-y-1.5 border-t border-red-200 pt-3 dark:border-red-900/70">
                          <Label htmlFor={`criterion_reason_${c.id}`}>
                            <GeneratedText id="m_0deb332b6749bf" />{' '}
                            <span className="text-red-600">*</span>
                          </Label>
                          <Textarea
                            id={`criterion_reason_${c.id}`}
                            name={`criterion_reason_${c.id}`}
                            value={reasons[c.id] ?? ''}
                            maxLength={10_000}
                            required
                            rows={2}
                            placeholder={tGenerated('m_1dc91a165513e8')}
                            onChange={(event) =>
                              setReasons((previous) => ({
                                ...previous,
                                [c.id]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      // Only expand where evidence is actually wanted: a failure,
                      // or a criterion whose type demands a photo. Opening a
                      // photo panel under every Pass made the list lurch as you
                      // worked down it — each answer grew the page under your
                      // thumb — for a control almost nobody used on a pass.
                      answers[c.id] &&
                      answers[c.id] !== 'n_a' &&
                      (answers[c.id] === 'fail' || c.requiresPhoto) ? (
                        <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
                          <div className="flex items-center justify-between gap-2">
                            <Label>
                              <GeneratedText id="m_065ba2f8f7df4e" />
                              <GeneratedValue
                                value={
                                  c.requiresPhoto ? <span className="text-red-600"> *</span> : ''
                                }
                              />
                            </Label>
                            <GeneratedValue
                              value={
                                !c.requiresPhoto ? (
                                  <span className="text-xs text-slate-500">
                                    <GeneratedText id="m_0cadbe8ae1ae4e" />
                                  </span>
                                ) : null
                              }
                            />
                          </div>
                          <FileUpload
                            variant="photo"
                            maxFiles={10}
                            value={photos[c.id] ?? []}
                            onChange={(files) =>
                              setPhotos((previous) => ({ ...previous, [c.id]: files }))
                            }
                            onUploadingChange={(isUploading) =>
                              setUploading((previous) =>
                                previous[c.id] === isUploading
                                  ? previous
                                  : { ...previous, [c.id]: isUploading },
                              )
                            }
                          />
                          <p className="text-xs text-slate-500">
                            <GeneratedText id="m_14afd8403e2327" />
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <input
                    type="hidden"
                    name={`criterion_photos_${c.id}`}
                    value={(photos[c.id] ?? []).map((file) => file.attachmentId).join(',')}
                  />
                </li>
              ))}
            />
          </ul>

          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0ccb8e5b917b17" />
            </Label>
            {/* A person, not a tenant user — the foreman who watched the check
              is often someone without a login. */}
            <RemoteSelectField
              name="supervisorPersonId"
              lookup="ppe-active-people"
              placeholder={tGenerated('m_0ba815306341be')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0b8dadcb78cd08" />
            </Label>
            <Input name="notes" placeholder={tGenerated('m_0e9c5a8419946e')} />
          </div>
        </div>
      </form>
    </UrlDrawer>
  )
}

function StatusBadge({
  status,
  answered,
  total,
  missingEvidence,
  uploadingCount,
}: {
  status: 'pass' | 'fail' | 'incomplete'
  answered: number
  total: number
  missingEvidence: number
  uploadingCount: number
}) {
  if (status === 'incomplete') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <CircleDashed size={13} />
        <GeneratedValue value={' '} />
        <GeneratedValue
          value={
            uploadingCount > 0 ? (
              <GeneratedText
                id="m_05040bfa089e75"
                values={{ value0: uploadingCount, value1: uploadingCount === 1 ? '' : 's' }}
              />
            ) : answered === total && missingEvidence > 0 ? (
              <GeneratedText
                id="m_0ad8b310bbb7d4"
                values={{ value0: missingEvidence, value1: missingEvidence === 1 ? '' : 's' }}
              />
            ) : (
              <GeneratedText id="m_1a4120b4c3f046" values={{ value0: answered, value1: total }} />
            )
          }
        />
      </span>
    )
  }
  if (status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300">
        <XCircle size={13} /> <GeneratedText id="m_169669494a86f8" />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
      <CheckCircle2 size={13} /> <GeneratedText id="m_0e4b19568a01bf" />
    </span>
  )
}
