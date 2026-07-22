'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Label, Select } from '@beaconhs/ui'
import { Filter, RotateCcw } from 'lucide-react'
import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import {
  TRAINING_REPORT_DELIVERY_TYPES,
  TRAINING_REPORT_EXPIRY_WINDOWS,
  type TrainingReportFilters,
  type TrainingReportQueryKind,
} from '@beaconhs/reports/training-filters'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import type { PickerOption } from '@/lib/picker-options'
import type { TrainingFilterSelections } from './_training-filter-data'

const DELIVERY_LABELS: Record<(typeof TRAINING_REPORT_DELIVERY_TYPES)[number], string> = {
  classroom: 'Classroom',
  self_paced: 'Self-paced',
  on_the_job: 'On the job',
  external_certificate: 'External certificate',
  online: 'Online',
}

const FILTER_KEYS = [
  'personIds',
  'departmentIds',
  'groupIds',
  'courseIds',
  'deliveryTypes',
  'groupBy',
  'expiryWindowDays',
  'includeExpired',
] as const

export function TrainingReportFilterPanel({
  queryKind,
  filters,
  selections,
}: {
  queryKind: TrainingReportQueryKind
  filters: TrainingReportFilters
  selections: TrainingFilterSelections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tGenerated = useGeneratedTranslations()
  const [peopleValue, setPeopleValue] = useState<PickerOption[]>(selections.people)
  const [departmentValue, setDepartmentValue] = useState<PickerOption[]>(selections.departments)
  const [groupValue, setGroupValue] = useState<PickerOption[]>(selections.groups)
  const [courseValue, setCourseValue] = useState<PickerOption[]>(selections.courses)
  const [deliveryTypes, setDeliveryTypes] = useState(new Set(filters.deliveryTypes))
  const [groupBy, setGroupBy] = useState(filters.groupBy)
  const [expiryWindowDays, setExpiryWindowDays] = useState(filters.expiryWindowDays)
  const [includeExpired, setIncludeExpired] = useState(filters.includeExpired)

  function navigate(reset: boolean) {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of FILTER_KEYS) params.delete(key)
    if (!reset) {
      setList(params, 'personIds', peopleValue)
      setList(params, 'departmentIds', departmentValue)
      setList(params, 'groupIds', groupValue)
      setList(params, 'courseIds', courseValue)
      if (deliveryTypes.size) params.set('deliveryTypes', [...deliveryTypes].join(','))
      params.set('groupBy', groupBy)
      if (queryKind === 'training_expired_upcoming') {
        params.set('expiryWindowDays', String(expiryWindowDays))
      }
      if (queryKind === 'training_certificates') {
        params.set('includeExpired', String(includeExpired))
      }
    }
    router.push(`${pathname}${params.size ? `?${params.toString()}` : ''}` as never)
  }

  return (
    <details className="group rounded-lg border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-slate-700 marker:hidden dark:text-slate-200">
        <span className="inline-flex items-center gap-2">
          <Filter size={14} /> <GeneratedText id="m_14b3a865c422bc" />
        </span>
        <span className="text-xs font-normal text-slate-500 group-open:hidden dark:text-slate-400">
          <GeneratedText id="m_192b4eb3d02634" />
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3 dark:border-slate-700">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <FilterMulti
            label={tGenerated('m_0302a7e2443143')}
            lookup="report-training-people"
            value={peopleValue}
            onChange={setPeopleValue}
            placeholder={tGenerated('m_1bf6bad927fd90')}
          />
          <FilterMulti
            label={tGenerated('m_08416151d62d16')}
            lookup="report-training-departments"
            value={departmentValue}
            onChange={setDepartmentValue}
            placeholder={tGenerated('m_05c052bd93f704')}
          />
          <FilterMulti
            label={tGenerated('m_00a9926beb1db6')}
            lookup="report-training-groups"
            value={groupValue}
            onChange={setGroupValue}
            placeholder={tGenerated('m_1acb38c886c316')}
          />
          <FilterMulti
            label={tGenerated('m_0c5dd55a54140d')}
            lookup="report-training-courses"
            value={courseValue}
            onChange={setCourseValue}
            placeholder={tGenerated('m_040b9cb201a0b0')}
          />
        </div>

        <div className="grid items-end gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
          <fieldset className="space-y-1.5">
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
                  <GeneratedValue value={DELIVERY_LABELS[type]} />
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="training-report-group-by">
              <GeneratedText id="m_175ee59112fb66" />
            </Label>
            <Select
              id="training-report-group-by"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}
            >
              <option value="course">{tGenerated('m_14fc1e0739b60e')}</option>
              <option value="employee">{tGenerated('m_0d191facfeeb70')}</option>
            </Select>
          </div>

          {queryKind === 'training_expired_upcoming' ? (
            <div className="space-y-1.5">
              <Label htmlFor="training-report-expiry-window">
                <GeneratedText id="m_17f91dad5cc730" />
              </Label>
              <Select
                id="training-report-expiry-window"
                value={String(expiryWindowDays)}
                onChange={(event) => setExpiryWindowDays(Number(event.target.value))}
              >
                {TRAINING_REPORT_EXPIRY_WINDOWS.map((days) => (
                  <option key={days} value={days}>
                    {tGenerated('m_09ef44d65a4a8f', { value0: days })}
                  </option>
                ))}
              </Select>
            </div>
          ) : queryKind === 'training_certificates' ? (
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeExpired}
                onChange={(event) => setIncludeExpired(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <GeneratedText id="m_02c8309b7043ba" />
            </label>
          ) : (
            <div />
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate(true)}>
              <RotateCcw size={14} className="mr-1.5" />
              <GeneratedText id="m_1bd5864b59f5f2" />
            </Button>
            <Button type="button" size="sm" onClick={() => navigate(false)}>
              <GeneratedText id="m_01185cdc1c20a5" />
            </Button>
          </div>
        </div>
      </div>
    </details>
  )
}

function FilterMulti({
  label,
  lookup,
  value,
  onChange,
  placeholder,
}: {
  label: string
  lookup:
    | 'report-training-people'
    | 'report-training-departments'
    | 'report-training-groups'
    | 'report-training-courses'
  value: PickerOption[]
  onChange: (value: PickerOption[]) => void
  placeholder: string
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <RemoteMultiSelect
        lookup={lookup}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        searchPlaceholder={tGenerated('m_1f0a8c50aedb8c', { value0: label.toLowerCase() })}
        emptyLabel={tGenerated('m_17201516610431')}
        max={50}
      />
    </div>
  )
}

function setList(params: URLSearchParams, key: string, value: PickerOption[]) {
  if (value.length) params.set(key, value.map((option) => option.value).join(','))
}
