'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Criteria-driven PPE inspection form, for a registered item (its record page)
// or for other PPE that is not in the register (the register and inspections
// list).
//
// Behaviour (per spec):
//   - No "manual overall result" — the result is derived from the answers.
//   - Every criterion MUST be answered before the form can submit.
//   - A live Pass / Fail / Incomplete status shows as you go.
//
// The radios carry `name="criterion_<id>"` so the server action reads them
// straight from FormData; the controlled state drives the live status and the
// submit gate. On a registered item, high+ severity fails still auto-spawn a
// corrective action server-side; other PPE failures are recorded only.
//
// The inspection is created in one call when it is submitted, so its answers
// are kept on the device as the worker goes (see useDeviceForm): a dead zone,
// a reload, or iOS discarding the tab never loses them, and the drawer
// restores them when it reopens. Submitting needs signal (uploading photos
// too); offline, the worker is told and the answers stay on the device.

import * as React from 'react'
import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Textarea,
  UrlDrawer,
  cn,
} from '@beaconhs/ui'
import { DraftRecoveryBanner, DraftSyncIndicator } from '@/components/draft-sync-status'
import { FileUpload, type AttachedFile } from '@/components/file-upload'
import { useDeviceForm } from '@/lib/offline-drafts/use-device-form'
import { useOnlineAction } from '@/lib/offline-drafts/use-online-action'
import { InspectionStatusPill } from '@/components/inspection-status-pill'
import { RemoteSelectField } from '@/components/remote-search-select'
import { submitPpeInspection } from './_inspection-actions'

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

type PickedOption = { value: string; label: string }

/** What the device keeps for an unsubmitted inspection. */
type InspectionAnswers = {
  answers: Record<string, Answer>
  reasons: Record<string, string>
  photos: Record<string, AttachedFile[]>
  serialNumber: string
  suppliedBy: string
  site: PickedOption | null
  supervisor: PickedOption | null
  notes: string
}

type InspectionTarget =
  | { kind: 'item'; itemId: string }
  /** Other PPE: type chosen in the drawer, gear identity typed by the inspector. */
  | { kind: 'other'; typeName: string; changeTypeHref: string; returnTo: string }

export function PpeInspectionForm({
  open,
  closeHref,
  title,
  description,
  target,
  typeId,
  kind,
  criteria,
}: {
  open: boolean
  closeHref: string
  title: string
  description?: string
  target: InspectionTarget
  typeId: string
  kind: 'pre_use' | 'annual'
  criteria: Criterion[]
}) {
  const tGenerated = useGeneratedTranslations()
  const runOnline = useOnlineAction()
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({})
  const [reasons, setReasons] = React.useState<Record<string, string>>({})
  const [photos, setPhotos] = React.useState<Record<string, AttachedFile[]>>({})
  const [serialNumber, setSerialNumber] = React.useState('')
  const [suppliedBy, setSuppliedBy] = React.useState('')
  const [site, setSite] = React.useState<PickedOption | null>(null)
  const [supervisor, setSupervisor] = React.useState<PickedOption | null>(null)
  const [notes, setNotes] = React.useState('')
  // Remounts the uncontrolled pickers when answers are restored or cleared.
  const [pickerVersion, setPickerVersion] = React.useState(0)
  const [uploading, setUploading] = React.useState<Record<string, boolean>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [pending, start] = React.useTransition()

  const applyAnswers = React.useCallback((saved: InspectionAnswers | null) => {
    setAnswers(saved?.answers ?? {})
    setReasons(saved?.reasons ?? {})
    setPhotos(saved?.photos ?? {})
    setSerialNumber(saved?.serialNumber ?? '')
    setSuppliedBy(saved?.suppliedBy ?? '')
    setSite(saved?.site ?? null)
    setSupervisor(saved?.supervisor ?? null)
    setNotes(saved?.notes ?? '')
    setPickerVersion((version) => version + 1)
  }, [])
  const device = useDeviceForm<InspectionAnswers>({
    enabled: open,
    form: 'ppe-inspection',
    localId: `${target.kind === 'item' ? `item:${target.itemId}` : `other:${typeId}`}:${kind}`,
    onRestore: applyAnswers,
  })
  const { save: saveOnDevice } = device
  const current = React.useMemo<InspectionAnswers>(
    () => ({ answers, reasons, photos, serialNumber, suppliedBy, site, supervisor, notes }),
    [answers, reasons, photos, serialNumber, suppliedBy, site, supervisor, notes],
  )
  const started =
    Object.keys(answers).length > 0 ||
    Object.values(reasons).some((reason) => reason.trim()) ||
    Object.values(photos).some((files) => files.length > 0) ||
    Boolean(serialNumber.trim() || suppliedBy.trim() || site || supervisor || notes.trim())
  React.useEffect(() => {
    if (started) saveOnDevice(current)
  }, [current, saveOnDevice, started])

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
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <InspectionStatusPill
              status={status}
              answered={answeredCount}
              total={criteria.length}
              missingEvidence={missingEvidence}
              uploadingCount={uploadingCount}
            />
            <DraftSyncIndicator localOnly state={device.state} onRetry={() => undefined} />
          </div>
          <Button type="submit" form="ppe-inspection-form" disabled={!allAnswered || pending}>
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
      <form
        id="ppe-inspection-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!allAnswered || pending) return
          const data = new FormData(event.currentTarget)
          const answered = current
          setError(null)
          start(async () => {
            await runOnline('finish', async () => {
              // Submitted: the device copy is no longer needed. It is put back
              // if the server refuses the inspection.
              device.clear()
              try {
                const result = await submitPpeInspection(data)
                if (result?.error) {
                  setError(result.error)
                  saveOnDevice(answered)
                }
              } catch (submitError) {
                unstable_rethrow(submitError)
                saveOnDevice(answered)
                setError(
                  'Could not record the inspection. Your answers are kept. Please try again.',
                )
              }
            })
          })
        }}
      >
        {target.kind === 'item' ? (
          <input type="hidden" name="itemId" value={target.itemId} />
        ) : (
          <>
            <input type="hidden" name="target" value="other" />
            <input type="hidden" name="returnTo" value={target.returnTo} />
          </>
        )}
        <input type="hidden" name="typeId" value={typeId} />
        <input type="hidden" name="kind" value={kind} />

        <div className="space-y-4">
          <DraftRecoveryBanner
            localOnly
            restored={device.restored}
            conflict={false}
            onDismiss={device.dismissRestored}
            onDiscard={() => {
              device.clear()
              applyAnswers(null)
            }}
            onTakeDeviceCopy={() => undefined}
            onTakeSavedVersion={() => undefined}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>
                <GeneratedValue value={error} />
              </AlertDescription>
            </Alert>
          ) : null}
          {target.kind === 'other' ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <GeneratedText id="m_172b20c7c26e49" />
                  </p>
                  <p className="text-sm font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-slate-100">
                    <GeneratedValue value={target.typeName} />
                  </p>
                </div>
                <Link
                  href={target.changeTypeHref as never}
                  scroll={false}
                  className="shrink-0 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  <GeneratedText id="m_11c7ed8124774d" />
                </Link>
              </div>
              <p className="text-xs text-slate-500">
                <GeneratedText id="m_05ea800287e27e" />
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ppe-other-serial">
                    <GeneratedText id="m_0ff1343b241439" />
                  </Label>
                  <Input
                    id="ppe-other-serial"
                    name="serialNumber"
                    maxLength={200}
                    value={serialNumber}
                    onChange={(event) => setSerialNumber(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ppe-other-supplied-by">
                    <GeneratedText id="m_15112cdc334968" />
                  </Label>
                  <Input
                    id="ppe-other-supplied-by"
                    name="suppliedBy"
                    maxLength={200}
                    placeholder={tGenerated('m_1507cb4f441bb1')}
                    value={suppliedBy}
                    onChange={(event) => setSuppliedBy(event.target.value)}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                <GeneratedValue value={kindLabel} /> <GeneratedText id="m_0196fe7432bec3" />
              </p>
              <p className="text-xs text-slate-500">
                <GeneratedText id="m_1e7a6e975f16ba" />
              </p>
            </div>
            <InspectionStatusPill
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
              <GeneratedText id="m_055f11420b2da4" />
            </Label>
            <RemoteSelectField
              key={`site-${pickerVersion}`}
              name="siteOrgUnitId"
              lookup="ppe-inspection-sites"
              defaultValue={site?.value ?? ''}
              initialOption={site ?? undefined}
              onOptionChange={(option) =>
                setSite(option ? { value: option.value, label: option.label } : null)
              }
              placeholder={tGenerated('m_00833db103546a')}
              searchPlaceholder={tGenerated('m_016e087c3c8544')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0ccb8e5b917b17" />
            </Label>
            {/* A person, not a tenant user — the foreman who watched the check
              is often someone without a login. */}
            <RemoteSelectField
              key={`supervisor-${pickerVersion}`}
              name="supervisorPersonId"
              lookup="ppe-inspection-supervisors"
              defaultValue={supervisor?.value ?? ''}
              initialOption={supervisor ?? undefined}
              onOptionChange={(option) =>
                setSupervisor(option ? { value: option.value, label: option.label } : null)
              }
              placeholder={tGenerated('m_0ba815306341be')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0b8dadcb78cd08" />
            </Label>
            <Input
              name="notes"
              placeholder={tGenerated('m_0e9c5a8419946e')}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
      </form>
    </UrlDrawer>
  )
}
