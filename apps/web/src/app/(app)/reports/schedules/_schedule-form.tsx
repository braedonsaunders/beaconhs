'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Shared subscribe/edit schedule form. Posts the exact field contract the
// existing create/update server actions read (definitionId, cadence parts,
// recipientUserIds, recipientEmails, filters-as-JSON) — but composes those
// from humane controls: member checkboxes instead of UUID textareas, a days
// window instead of raw JSON (still available under "Advanced").

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Label, SearchSelect, Select, Textarea } from '@beaconhs/ui'
import {
  isTrainingReportQueryKind,
  normalizeTrainingReportFilters,
  TRAINING_REPORT_DELIVERY_TYPES,
  TRAINING_REPORT_EXPIRY_WINDOWS,
  trainingReportFiltersToRecord,
} from '@beaconhs/reports/training-filters'
import { REPORT_SCHEDULE_LIMITS } from '@beaconhs/reports/schedule-policy'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import type { PickerOption } from '@/lib/picker-options'
import type { TrainingFilterSelections } from '../_training-filter-data'

export type ScheduleFormDefinition = {
  id: string
  name: string
  category: string | null
  kind: 'built_in' | 'custom'
  description: string | null
  queryKind: string
}

export type ScheduleFormMember = { userId: string; name: string; email: string }

type ScheduleFormInitial = {
  definitionId?: string
  name?: string
  cadence?: 'daily' | 'weekly' | 'monthly'
  repeatEvery?: number
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  hour?: number
  minute?: number
  timezone?: string
  startsOn?: string | null
  endsOn?: string | null
  recipientUserIds?: string[]
  recipientEmails?: string[]
  filters?: Record<string, unknown>
  emailSubject?: string | null
  emailMessage?: string | null
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ScheduleForm({
  definitions,
  members,
  initial,
  submitLabel,
  action,
  extraFooter,
  initialTrainingSelections,
}: {
  definitions: ScheduleFormDefinition[]
  members: ScheduleFormMember[]
  initial?: ScheduleFormInitial
  submitLabel: string
  action: (formData: FormData) => Promise<void>
  extraFooter?: React.ReactNode
  initialTrainingSelections?: TrainingFilterSelections
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [definitionId, setDefinitionId] = useState(
    initial?.definitionId ?? definitions[0]?.id ?? '',
  )
  const definition = definitions.find((d) => d.id === definitionId)
  const isTrainingReport = definition ? isTrainingReportQueryKind(definition.queryKind) : false
  const [name, setName] = useState(initial?.name ?? '')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>(
    initial?.cadence ?? 'weekly',
  )
  const [monthlyMode, setMonthlyMode] = useState<'day' | 'weekday'>(
    initial?.weekOfMonth ? 'weekday' : 'day',
  )
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(
    () => new Set(initial?.recipientUserIds ?? []),
  )

  const initialFilterRecord = (initial?.filters ?? {}) as Record<string, unknown>
  const { days: initialDays, ...initialAdvancedRaw } = initialFilterRecord
  const initialAdvanced = Object.fromEntries(
    Object.entries(initialAdvancedRaw).filter(
      ([key]) =>
        ![
          'personIds',
          'departmentIds',
          'groupIds',
          'courseIds',
          'deliveryTypes',
          'groupBy',
          'expiryWindowDays',
          'includeExpired',
        ].includes(key),
    ),
  )
  const initialTraining = normalizeTrainingReportFilters(initialFilterRecord)
  const [days, setDays] = useState<string>(
    typeof initialDays === 'number' ? String(initialDays) : '',
  )
  const [advanced, setAdvanced] = useState<string>(
    Object.keys(initialAdvanced).length ? JSON.stringify(initialAdvanced, null, 2) : '',
  )
  const [trainingPeople, setTrainingPeople] = useState<PickerOption[]>(
    initialTrainingSelections?.people ?? [],
  )
  const [trainingDepartments, setTrainingDepartments] = useState<PickerOption[]>(
    initialTrainingSelections?.departments ?? [],
  )
  const [trainingGroups, setTrainingGroups] = useState<PickerOption[]>(
    initialTrainingSelections?.groups ?? [],
  )
  const [trainingCourses, setTrainingCourses] = useState<PickerOption[]>(
    initialTrainingSelections?.courses ?? [],
  )
  const [trainingDeliveryTypes, setTrainingDeliveryTypes] = useState(
    new Set(initialTraining.deliveryTypes),
  )
  const [trainingGroupBy, setTrainingGroupBy] = useState(initialTraining.groupBy)
  const [trainingExpiryDays, setTrainingExpiryDays] = useState(initialTraining.expiryWindowDays)
  const [trainingIncludeExpired, setTrainingIncludeExpired] = useState(
    initialTraining.includeExpired,
  )

  const { filtersJson, advancedError } = useMemo(() => {
    if (isTrainingReport) {
      return {
        filtersJson: JSON.stringify(
          trainingReportFiltersToRecord({
            personIds: trainingPeople.map((option) => option.value),
            departmentIds: trainingDepartments.map((option) => option.value),
            groupIds: trainingGroups.map((option) => option.value),
            courseIds: trainingCourses.map((option) => option.value),
            deliveryTypes: TRAINING_REPORT_DELIVERY_TYPES.filter((type) =>
              trainingDeliveryTypes.has(type),
            ),
            groupBy: trainingGroupBy,
            expiryWindowDays: trainingExpiryDays,
            includeExpired: trainingIncludeExpired,
          }),
        ),
        advancedError: null,
      }
    }
    let base: Record<string, unknown> = {}
    let err: string | null = null
    if (advanced.trim()) {
      try {
        const parsed = JSON.parse(advanced)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          base = parsed as Record<string, unknown>
        } else {
          err = 'Advanced filters must be a JSON object'
        }
      } catch (e) {
        err = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    const n = Number(days)
    if (days.trim() && Number.isFinite(n) && n > 0) base = { ...base, days: n }
    return { filtersJson: JSON.stringify(base), advancedError: err }
  }, [
    advanced,
    days,
    isTrainingReport,
    trainingCourses,
    trainingDeliveryTypes,
    trainingDepartments,
    trainingExpiryDays,
    trainingGroupBy,
    trainingGroups,
    trainingIncludeExpired,
    trainingPeople,
  ])

  function toggleUser(id: string) {
    setSelectedUsers((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="recipientUserIds" value={Array.from(selectedUsers).join(',')} />
      <input type="hidden" name="filters" value={filtersJson} />

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_0ab5a972fc80fd" /> <span className="text-red-600">*</span>
        </Label>
        <Select
          name="definitionId"
          value={definitionId}
          onChange={(e) => {
            setDefinitionId(e.target.value)
            setDays('')
            setAdvanced('')
          }}
        >
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.kind === 'custom' ? '(custom)' : ''}
            </option>
          ))}
        </Select>
        <GeneratedValue
          value={
            definition?.description ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value={definition.description} />
              </p>
            ) : null
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label>
          <GeneratedText id="m_0fcdcb15bd7604" /> <span className="text-red-600">*</span>
        </Label>
        <Input
          name="name"
          required
          maxLength={REPORT_SCHEDULE_LIMITS.nameChars}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tGeneratedValue(
            definition ? `${definition.name} — ${cadence}` : tGenerated('m_0e6260addabf9b'),
          )}
        />
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedText id="m_03db87cb2e7846" />
        </legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1151ed0308b6d1" />
            </Label>
            <Select
              name="cadence"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              <option value="daily">{'Daily'}</option>
              <option value="weekly">{'Weekly'}</option>
              <option value="monthly">{'Monthly'}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_115d7a60362f86" />
            </Label>
            <div className="flex items-center gap-2">
              <Input
                name="repeatEvery"
                type="number"
                min={1}
                max={999}
                required
                defaultValue={initial?.repeatEvery ?? 1}
                className="w-20"
              />
              <span className="text-xs text-slate-500">
                {cadence === 'daily' ? (
                  <GeneratedText id="m_0621564e8d1aef" />
                ) : cadence === 'weekly' ? (
                  <GeneratedText id="m_1e3123961c3ccb" />
                ) : (
                  <GeneratedText id="m_0d87dcb9dd2a8b" />
                )}
              </span>
            </div>
          </div>
          <GeneratedValue
            value={
              cadence === 'weekly' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_0738c9c7544385" />
                  </Label>
                  <Select name="dayOfWeek" defaultValue={String(initial?.dayOfWeek ?? 1)}>
                    {DOW.map((d, i) => (
                      <option key={d} value={String(i)}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              cadence === 'monthly' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_113a8243148955" />
                  </Label>
                  <Select
                    name="monthlyMode"
                    value={monthlyMode}
                    onChange={(event) => setMonthlyMode(event.target.value as typeof monthlyMode)}
                  >
                    <option value="day">{'Day of month'}</option>
                    <option value="weekday">
                      <GeneratedText id="m_03d04ff4885019" />
                    </option>
                  </Select>
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              cadence === 'monthly' && monthlyMode === 'day' ? (
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_1f8ef50bb3fd8d" />
                  </Label>
                  <Input
                    name="dayOfMonth"
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={initial?.dayOfMonth ?? 1}
                  />
                </div>
              ) : null
            }
          />
          <GeneratedValue
            value={
              cadence === 'monthly' && monthlyMode === 'weekday' ? (
                <>
                  <div className="space-y-1.5">
                    <Label>
                      <GeneratedText id="m_0c348e7e37b197" />
                    </Label>
                    <Select name="weekOfMonth" defaultValue={String(initial?.weekOfMonth ?? 1)}>
                      <option value="1">
                        <GeneratedText id="m_17e8859f590582" />
                      </option>
                      <option value="2">
                        <GeneratedText id="m_1a9504edad7c39" />
                      </option>
                      <option value="3">
                        <GeneratedText id="m_06e296ae537a43" />
                      </option>
                      <option value="4">
                        <GeneratedText id="m_05ddfca283b2c9" />
                      </option>
                      <option value="5">{'Last'}</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      <GeneratedText id="m_0a19a9b2e7c15d" />
                    </Label>
                    <Select name="dayOfWeek" defaultValue={String(initial?.dayOfWeek ?? 1)}>
                      {DOW.map((day, index) => (
                        <option key={day} value={String(index)}>
                          {day}
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              ) : null
            }
          />
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1cf3bee1218779" />
            </Label>
            <div className="flex items-center gap-1">
              <Input
                name="hour"
                type="number"
                min={0}
                max={23}
                defaultValue={initial?.hour ?? 7}
                required
                className="w-18"
                aria-label={tGenerated('m_1cdd126cee80c8')}
              />
              <span className="text-slate-400">:</span>
              <Input
                name="minute"
                type="number"
                min={0}
                max={59}
                defaultValue={initial?.minute ?? 0}
                required
                className="w-18"
                aria-label={tGenerated('m_13b09b05ab2247')}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_14c7a1feb33b17" />
            </Label>
            <Input
              name="timezone"
              required
              maxLength={REPORT_SCHEDULE_LIMITS.timezoneChars}
              defaultValue={initial?.timezone ?? 'America/Toronto'}
              list="report-tz-options"
            />
            <datalist id="report-tz-options">
              <option value="America/Toronto" />
              <option value="America/Vancouver" />
              <option value="America/Edmonton" />
              <option value="America/Winnipeg" />
              <option value="America/Halifax" />
              <option value="America/St_Johns" />
              <option value="UTC" />
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0d3742b5c2be2e" />
            </Label>
            <Input name="startsOn" type="date" defaultValue={initial?.startsOn ?? ''} />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_16d01a6b8edfbf" />
            </Label>
            <Input name="endsOn" type="date" defaultValue={initial?.endsOn ?? ''} />
          </div>
        </div>
      </fieldset>

      {isTrainingReport && definition && isTrainingReportQueryKind(definition.queryKind) ? (
        <TrainingScheduleFilters
          queryKind={definition.queryKind}
          people={trainingPeople}
          setPeople={setTrainingPeople}
          departments={trainingDepartments}
          setDepartments={setTrainingDepartments}
          groups={trainingGroups}
          setGroups={setTrainingGroups}
          courses={trainingCourses}
          setCourses={setTrainingCourses}
          deliveryTypes={trainingDeliveryTypes}
          setDeliveryTypes={setTrainingDeliveryTypes}
          groupBy={trainingGroupBy}
          setGroupBy={setTrainingGroupBy}
          expiryDays={trainingExpiryDays}
          setExpiryDays={setTrainingExpiryDays}
          includeExpired={trainingIncludeExpired}
          setIncludeExpired={setTrainingIncludeExpired}
        />
      ) : null}
      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedText id="m_0d99b2b56f8b5d" />
        </legend>
        <div className="space-y-2">
          <Label>
            <GeneratedText id="m_0ef3898622f868" />
          </Label>
          <GeneratedValue
            value={
              selectedUsers.size > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  <GeneratedValue
                    value={Array.from(selectedUsers).map((id) => {
                      const m = members.find((x) => x.userId === id)
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pr-1 pl-2.5 text-xs text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
                        >
                          <GeneratedValue
                            value={m?.name ?? <GeneratedText id="m_0d19396d98306c" />}
                          />
                          <button
                            type="button"
                            onClick={() => toggleUser(id)}
                            aria-label={tGenerated('m_101f98a70352fa', {
                              value0: m?.name ?? 'recipient',
                            })}
                            className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 hover:text-teal-900 dark:text-teal-400 dark:hover:bg-teal-900"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      )
                    })}
                  />
                </div>
              ) : null
            }
          />
          <SearchSelect
            value=""
            onChange={(id) => {
              if (id) toggleUser(id)
            }}
            options={members
              .filter((m) => !selectedUsers.has(m.userId))
              .map((m) => ({ value: m.userId, label: m.name, hint: m.email }))}
            placeholder={tGenerated('m_080c3856ee74d5')}
            searchPlaceholder={tGenerated('m_0f2fe29f21ee57')}
            sheetTitle="Add recipient"
            ariaLabel="Add member recipient"
            className="max-w-sm"
          />
        </div>
        <div className="mt-3 space-y-1.5">
          <Label>
            <GeneratedText id="m_0bfee91aa5fe88" />
          </Label>
          <Textarea
            name="recipientEmails"
            rows={2}
            maxLength={REPORT_SCHEDULE_LIMITS.recipientEmailListChars}
            defaultValue={(initial?.recipientEmails ?? []).join(', ')}
            placeholder={tGenerated('m_1eef4d230cc634')}
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            <GeneratedText id="m_08778f6f4d177b" />
          </p>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedText id="m_19769015dfe77d" />
        </legend>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0a88689556c4a0" />
            </Label>
            <Input
              name="emailSubject"
              maxLength={REPORT_SCHEDULE_LIMITS.emailSubjectChars}
              defaultValue={initial?.emailSubject ?? ''}
              placeholder={tGenerated('m_0a8a2a0d5db09f')}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_07b4019031bee9" />
            </Label>
            <Textarea
              name="emailMessage"
              rows={4}
              maxLength={REPORT_SCHEDULE_LIMITS.emailMessageChars}
              defaultValue={initial?.emailMessage ?? ''}
              placeholder={tGenerated('m_1efbed41ea9494')}
            />
          </div>
        </div>
      </fieldset>

      {!isTrainingReport ? (
        <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            <GeneratedText id="m_1b6d30e8a7b8f2" />
          </legend>
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label>
                <GeneratedText id="m_0d7a3c5db73e70" />
              </Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder={tGenerated('m_063b869c773315')}
                className="w-36"
              />
            </div>
            <p className="pb-2 text-xs text-slate-400 dark:text-slate-500">
              <GeneratedText id="m_038258667df019" />
            </p>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-teal-700 dark:text-slate-400">
              <GeneratedText id="m_1c766f2981b51f" />
            </summary>
            <Textarea
              rows={3}
              maxLength={REPORT_SCHEDULE_LIMITS.filtersChars}
              value={advanced}
              onChange={(e) => setAdvanced(e.target.value)}
              placeholder={tGenerated('m_03573b6be12a60')}
              className="mt-2 font-mono text-xs"
            />
            <GeneratedValue
              value={
                advancedError ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    <GeneratedValue value={advancedError} />
                  </p>
                ) : null
              }
            />
          </details>
        </fieldset>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div>
          <GeneratedValue value={extraFooter} />
        </div>
        <Button type="submit" disabled={Boolean(advancedError)}>
          <GeneratedValue value={submitLabel} />
        </Button>
      </div>
    </form>
  )
}

type TrainingFilterSetter = (value: PickerOption[]) => void

const TRAINING_DELIVERY_MESSAGE_IDS = {
  classroom: 'm_0e2095879e70e6',
  self_paced: 'm_0ae07f12b9afb0',
  on_the_job: 'm_195306cf88332c',
  external_certificate: 'm_1a9444513d40a2',
  online: 'm_064cf27492eeb4',
} as const

function TrainingScheduleFilters({
  queryKind,
  people,
  setPeople,
  departments,
  setDepartments,
  groups,
  setGroups,
  courses,
  setCourses,
  deliveryTypes,
  setDeliveryTypes,
  groupBy,
  setGroupBy,
  expiryDays,
  setExpiryDays,
  includeExpired,
  setIncludeExpired,
}: {
  queryKind:
    | 'training_certificate_matrix'
    | 'training_certificates'
    | 'training_expired_upcoming'
    | 'training_missing'
  people: PickerOption[]
  setPeople: TrainingFilterSetter
  departments: PickerOption[]
  setDepartments: TrainingFilterSetter
  groups: PickerOption[]
  setGroups: TrainingFilterSetter
  courses: PickerOption[]
  setCourses: TrainingFilterSetter
  deliveryTypes: Set<(typeof TRAINING_REPORT_DELIVERY_TYPES)[number]>
  setDeliveryTypes: (value: Set<(typeof TRAINING_REPORT_DELIVERY_TYPES)[number]>) => void
  groupBy: 'employee' | 'course'
  setGroupBy: (value: 'employee' | 'course') => void
  expiryDays: number
  setExpiryDays: (value: number) => void
  includeExpired: boolean
  setIncludeExpired: (value: boolean) => void
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedText id="m_167fcaf1b02242" />
      </legend>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_0b38e0cf3fa1f4" />
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <ScheduleMulti
          labelId="m_0302a7e2443143"
          lookup="report-training-people"
          value={people}
          onChange={setPeople}
        />
        <ScheduleMulti
          labelId="m_08416151d62d16"
          lookup="report-training-departments"
          value={departments}
          onChange={setDepartments}
        />
        <ScheduleMulti
          labelId="m_00a9926beb1db6"
          lookup="report-training-groups"
          value={groups}
          onChange={setGroups}
        />
        <ScheduleMulti
          labelId="m_0c5dd55a54140d"
          lookup="report-training-courses"
          value={courses}
          onChange={setCourses}
        />
      </div>
      <div className="mt-4 grid items-end gap-4 md:grid-cols-3">
        <fieldset className="space-y-1.5 md:col-span-3">
          <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
            <GeneratedText id="m_0144792027bd01" />
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {TRAINING_REPORT_DELIVERY_TYPES.map((type) => (
              <label key={type} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={deliveryTypes.has(type)}
                  onChange={(event) => {
                    const next = new Set(deliveryTypes)
                    if (event.target.checked) next.add(type)
                    else next.delete(type)
                    setDeliveryTypes(next)
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <GeneratedText id={TRAINING_DELIVERY_MESSAGE_IDS[type]} />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_175ee59112fb66" />
          </Label>
          <Select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as 'employee' | 'course')}
          >
            <option value="course">{tGenerated('m_14fc1e0739b60e')}</option>
            <option value="employee">{tGenerated('m_0d191facfeeb70')}</option>
          </Select>
        </div>
        {queryKind === 'training_expired_upcoming' ? (
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_17f91dad5cc730" />
            </Label>
            <Select
              value={String(expiryDays)}
              onChange={(event) => setExpiryDays(Number(event.target.value))}
            >
              {TRAINING_REPORT_EXPIRY_WINDOWS.map((value) => (
                <option key={value} value={value}>
                  {tGenerated('m_09ef44d65a4a8f', { value0: value })}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {queryKind === 'training_certificates' ? (
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={(event) => setIncludeExpired(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <GeneratedText id="m_02c8309b7043ba" />
          </label>
        ) : null}
      </div>
    </fieldset>
  )
}

function ScheduleMulti({
  labelId,
  lookup,
  value,
  onChange,
}: {
  labelId: 'm_0302a7e2443143' | 'm_08416151d62d16' | 'm_00a9926beb1db6' | 'm_0c5dd55a54140d'
  lookup:
    | 'report-training-people'
    | 'report-training-departments'
    | 'report-training-groups'
    | 'report-training-courses'
  value: PickerOption[]
  onChange: TrainingFilterSetter
}) {
  const tGenerated = useGeneratedTranslations()
  const label = tGenerated(labelId)
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <RemoteMultiSelect
        lookup={lookup}
        value={value}
        onChange={onChange}
        placeholder={tGenerated('m_01dbaab9d75038', { value0: label.toLowerCase() })}
        searchPlaceholder={tGenerated('m_1f0a8c50aedb8c', { value0: label.toLowerCase() })}
        emptyLabel={tGenerated('m_17201516610431')}
        max={50}
      />
    </div>
  )
}
