'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import { Filter, RotateCcw } from 'lucide-react'
import {
  REPORT_COMPLIANCE_SOURCE_MODULES,
  REPORT_COMPLIANCE_STATUSES,
  REPORT_CORRECTIVE_STATUSES,
  REPORT_EXPIRY_WINDOWS,
  type OperationalFilterReportSlug,
  type OperationalReportFilters,
  type OperationalReportGroupBy,
} from '@beaconhs/reports/operational-filters'
import { RemoteMultiSelect } from '@/components/remote-multi-select'
import type { PickerLookup, PickerOption } from '@/lib/picker-options'
import { GeneratedText, GeneratedValue, useGeneratedTranslations } from '@/i18n/generated'
import type { OperationalFilterSelections } from './_operational-filter-data'

const FILTER_KEYS = [
  'personIds',
  'departmentIds',
  'groupIds',
  'obligationIds',
  'sourceModules',
  'complianceStatuses',
  'skillTypeIds',
  'authorityIds',
  'siteIds',
  'correctiveStatuses',
  'ppeTypeIds',
  'groupBy',
  'expiryWindowDays',
  'cwbStandard',
  'fromDate',
  'toDate',
] as const

const GROUP_LABELS: Record<OperationalReportGroupBy, string> = {
  employee: 'Employee',
  skill: 'Skill',
  authority: 'Issuing authority',
  status: 'Status',
  site: 'Location',
  type: 'PPE type',
}

export function OperationalReportFilterPanel({
  slug,
  filters,
  selections,
}: {
  slug: OperationalFilterReportSlug
  filters: OperationalReportFilters
  selections: OperationalFilterSelections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tGenerated = useGeneratedTranslations()
  const [people, setPeople] = useState(selections.people)
  const [departments, setDepartments] = useState(selections.departments)
  const [groups, setGroups] = useState(selections.groups)
  const [obligations, setObligations] = useState(selections.obligations)
  const [skillTypes, setSkillTypes] = useState(selections.skillTypes)
  const [authorities, setAuthorities] = useState(selections.authorities)
  const [sites, setSites] = useState(selections.sites)
  const [ppeTypes, setPpeTypes] = useState(selections.ppeTypes)
  const [sourceModules, setSourceModules] = useState(new Set(filters.sourceModules))
  const [complianceStatuses, setComplianceStatuses] = useState(new Set(filters.complianceStatuses))
  const [correctiveStatuses, setCorrectiveStatuses] = useState(new Set(filters.correctiveStatuses))
  const [groupBy, setGroupBy] = useState(filters.groupBy)
  const [expiryWindowDays, setExpiryWindowDays] = useState(filters.expiryWindowDays)
  const [cwbStandard, setCwbStandard] = useState(filters.cwbStandard)
  const [fromDate, setFromDate] = useState(filters.fromDate)
  const [toDate, setToDate] = useState(filters.toDate)

  const compliance =
    slug === 'compliance_by_entity' ||
    slug === 'compliance_by_person' ||
    slug === 'hazid_signatures'
  const skills = slug.startsWith('skills_')
  const corrective = slug === 'corrective_actions_list'
  const ppe = slug === 'ppe_list' || slug === 'ppe_expired_upcoming'

  function navigate(reset: boolean) {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of FILTER_KEYS) params.delete(key)
    if (!reset) {
      setList(params, 'personIds', people)
      setList(params, 'departmentIds', departments)
      setList(params, 'groupIds', groups)
      if (compliance) {
        if (slug !== 'hazid_signatures') {
          setList(params, 'obligationIds', obligations)
          setValues(params, 'sourceModules', sourceModules)
        }
        setValues(params, 'complianceStatuses', complianceStatuses)
        if (fromDate) params.set('fromDate', fromDate)
        if (toDate) params.set('toDate', toDate)
      }
      if (skills) {
        setList(params, 'skillTypeIds', skillTypes)
        setList(params, 'authorityIds', authorities)
        params.set('groupBy', groupBy)
        if (slug === 'skills_expired_upcoming') {
          params.set('expiryWindowDays', String(expiryWindowDays))
        }
        if (slug === 'skills_cwb' && cwbStandard.trim()) {
          params.set('cwbStandard', cwbStandard.trim())
        }
      }
      if (corrective) {
        setList(params, 'siteIds', sites)
        setValues(params, 'correctiveStatuses', correctiveStatuses)
        params.set('groupBy', groupBy)
      }
      if (ppe) {
        setList(params, 'ppeTypeIds', ppeTypes)
        params.set('groupBy', groupBy)
        if (slug === 'ppe_expired_upcoming') {
          params.set('expiryWindowDays', String(expiryWindowDays))
        }
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
          <GeneratedText id="m_1c056d78d6ad7d" />
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-3 dark:border-slate-700">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <FilterMulti
            label={tGenerated('m_0302a7e2443143')}
            lookup="report-people"
            value={people}
            onChange={setPeople}
          />
          <FilterMulti
            label={tGenerated('m_08416151d62d16')}
            lookup="report-departments"
            value={departments}
            onChange={setDepartments}
          />
          <FilterMulti
            label={tGenerated('m_00a9926beb1db6')}
            lookup="report-groups"
            value={groups}
            onChange={setGroups}
          />
          {compliance && slug !== 'hazid_signatures' ? (
            <FilterMulti
              label={tGenerated('m_15fff7613e28b7')}
              lookup="report-obligations"
              value={obligations}
              onChange={setObligations}
            />
          ) : null}
          {skills ? (
            <>
              <FilterMulti
                label={tGenerated('m_1a286702b9eafe')}
                lookup="report-skill-types"
                value={skillTypes}
                onChange={setSkillTypes}
              />
              <FilterMulti
                label={tGenerated('m_0ed606ac0a84dc')}
                lookup="report-skill-authorities"
                value={authorities}
                onChange={setAuthorities}
              />
            </>
          ) : null}
          {corrective ? (
            <FilterMulti
              label={tGenerated('m_1c045021411277')}
              lookup="report-sites"
              value={sites}
              onChange={setSites}
            />
          ) : null}
          {ppe ? (
            <FilterMulti
              label={tGenerated('m_0f5423f9b22ae3')}
              lookup="report-ppe-types"
              value={ppeTypes}
              onChange={setPpeTypes}
            />
          ) : null}
        </div>

        {compliance ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {slug !== 'hazid_signatures' ? (
              <CheckSet
                label={tGenerated('m_03abc46dafbce6')}
                values={REPORT_COMPLIANCE_SOURCE_MODULES}
                selected={sourceModules}
                onChange={setSourceModules}
              />
            ) : (
              <div />
            )}
            <CheckSet
              label={tGenerated('m_0d3cd59c13c221')}
              values={REPORT_COMPLIANCE_STATUSES}
              selected={complianceStatuses}
              onChange={setComplianceStatuses}
            />
            <DateField
              label={tGenerated('m_154c9d7a784dda')}
              value={fromDate}
              onChange={setFromDate}
            />
            <DateField label={tGenerated('m_0ea10a854847b2')} value={toDate} onChange={setToDate} />
          </div>
        ) : null}

        <div className="grid items-end gap-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          {skills || corrective || ppe ? (
            <div className="space-y-1.5">
              <Label htmlFor="operational-report-group-by">
                <GeneratedText id="m_175ee59112fb66" />
              </Label>
              <Select
                id="operational-report-group-by"
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as OperationalReportGroupBy)}
              >
                {groupChoices(slug).map((choice) => (
                  <option key={choice} value={choice}>
                    <GeneratedValue value={GROUP_LABELS[choice]} />
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div />
          )}
          {slug === 'skills_expired_upcoming' || slug === 'ppe_expired_upcoming' ? (
            <div className="space-y-1.5">
              <Label htmlFor="operational-report-expiry-window">
                <GeneratedText id="m_077326c27fa788" />
              </Label>
              <Select
                id="operational-report-expiry-window"
                value={String(expiryWindowDays)}
                onChange={(event) => setExpiryWindowDays(Number(event.target.value))}
              >
                {REPORT_EXPIRY_WINDOWS.map((days) => (
                  <option key={days} value={days}>
                    {tGenerated('m_09ef44d65a4a8f', { value0: days })}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div />
          )}
          {slug === 'skills_cwb' ? (
            <div className="space-y-1.5">
              <Label htmlFor="operational-report-cwb-standard">
                <GeneratedText id="m_0095b57bfc66f4" />
              </Label>
              <Input
                id="operational-report-cwb-standard"
                value={cwbStandard}
                onChange={(event) => setCwbStandard(event.target.value)}
                placeholder={tGenerated('m_0f3ad3cc563789')}
                maxLength={120}
              />
            </div>
          ) : corrective ? (
            <CheckSet
              label={tGenerated('m_0d3cd59c13c221')}
              values={REPORT_CORRECTIVE_STATUSES}
              selected={correctiveStatuses}
              onChange={setCorrectiveStatuses}
            />
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
}: {
  label: string
  lookup: PickerLookup
  value: PickerOption[]
  onChange: (value: PickerOption[]) => void
}) {
  const tGenerated = useGeneratedTranslations()
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

function CheckSet<T extends string>({
  label,
  values,
  selected,
  onChange,
}: {
  label: string
  values: readonly T[]
  selected: Set<T>
  onChange: (value: Set<T>) => void
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</legend>
      <div className="flex max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-auto">
        {values.map((value) => (
          <label key={value} className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.has(value)}
              onChange={(event) => {
                const next = new Set(selected)
                if (event.target.checked) next.add(value)
                else next.delete(value)
                onChange(next)
              }}
              className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <GeneratedValue value={formatLabel(value)} />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function groupChoices(slug: OperationalFilterReportSlug): OperationalReportGroupBy[] {
  if (slug === 'skills_matrix') return ['employee', 'skill', 'authority']
  if (slug.startsWith('skills_')) return ['employee', 'skill']
  if (slug === 'corrective_actions_list') return ['status', 'site', 'employee']
  return ['type', 'employee']
}

function setList(params: URLSearchParams, key: string, values: PickerOption[]) {
  if (values.length) params.set(key, values.map((value) => value.value).join(','))
}

function setValues(params: URLSearchParams, key: string, values: Set<string>) {
  if (values.size) params.set(key, [...values].join(','))
}

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
