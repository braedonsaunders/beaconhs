'use client'

// Data-visibility scope picker for a role assignment. Mirrors the RoleScope
// union: tenant-wide · specific sites · a department (departments/groups) ·
// hand-picked people · crews · self. Multi-value scopes use a SearchSelect +
// removable chips over ACTIVE-only option lists (per the active-people-picker
// mandate). The chosen scope is serialized to a hidden <input> so it posts in a
// plain server-action form with no field-contract change.

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Label, SearchSelect, Select } from '@beaconhs/ui'
import type { RoleScope } from '@beaconhs/db/schema'

export type ScopeOption = { value: string; label: string; hint?: string }
type ScopeType = RoleScope['type']

const TYPE_OPTIONS: { value: ScopeType; label: string; help: string }[] = [
  { value: 'self', label: 'Only their own records', help: 'Sees only what they create or own.' },
  { value: 'tenant', label: 'Everyone in the tenant', help: 'Sees every record in the tenant.' },
  {
    value: 'sites',
    label: 'Specific sites',
    help: 'Their own records plus records at the chosen sites.',
  },
  {
    value: 'team',
    label: 'Department or group',
    help: 'Their own records plus people in the chosen departments or groups.',
  },
  {
    value: 'people',
    label: 'Specific people',
    help: 'Their own records plus a hand-picked set of people.',
  },
  {
    value: 'crews',
    label: 'Specific crews',
    help: 'Their own records plus people in the chosen crews.',
  },
]

function MultiChipSelect({
  options,
  value,
  onChange,
  placeholder,
  sheetTitle,
}: {
  options: ScopeOption[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder: string
  sheetTitle: string
}) {
  const available = useMemo(() => options.filter((o) => !value.includes(o.value)), [options, value])
  const chosen = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is ScopeOption => Boolean(o))
  return (
    <div className="space-y-2">
      <SearchSelect
        value=""
        onChange={(v) => v && onChange([...value, v])}
        options={available}
        placeholder={placeholder}
        searchPlaceholder={placeholder}
        sheetTitle={sheetTitle}
      />
      {chosen.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-2.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
            >
              {o.label}
              <button
                type="button"
                aria-label={`Remove ${o.label}`}
                onClick={() => onChange(value.filter((v) => v !== o.value))}
                className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500">None selected yet.</p>
      )}
    </div>
  )
}

export function ScopePicker({
  name = 'scope',
  defaultScope,
  sites,
  crews,
  departments,
  groups,
  people,
}: {
  name?: string
  defaultScope?: RoleScope
  sites: ScopeOption[]
  crews: ScopeOption[]
  departments: ScopeOption[]
  groups: ScopeOption[]
  people: ScopeOption[]
}) {
  const [type, setType] = useState<ScopeType>(defaultScope?.type ?? 'self')
  const [siteIds, setSiteIds] = useState<string[]>(
    defaultScope?.type === 'sites' ? defaultScope.siteIds : [],
  )
  const [crewIds, setCrewIds] = useState<string[]>(
    defaultScope?.type === 'crews' ? defaultScope.crewIds : [],
  )
  const [personIds, setPersonIds] = useState<string[]>(
    defaultScope?.type === 'people' ? defaultScope.personIds : [],
  )
  const [departmentIds, setDepartmentIds] = useState<string[]>(
    defaultScope?.type === 'team' ? defaultScope.departmentIds : [],
  )
  const [groupIds, setGroupIds] = useState<string[]>(
    defaultScope?.type === 'team' ? defaultScope.groupIds : [],
  )

  const scope: RoleScope = useMemo(() => {
    switch (type) {
      case 'sites':
        return { type, siteIds }
      case 'crews':
        return { type, crewIds }
      case 'people':
        return { type, personIds }
      case 'team':
        return { type, departmentIds, groupIds }
      case 'self':
        return { type }
      default:
        return { type: 'self' }
    }
  }, [type, siteIds, crewIds, personIds, departmentIds, groupIds])

  const help = TYPE_OPTIONS.find((t) => t.value === type)?.help

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={JSON.stringify(scope)} />
      <div className="space-y-1.5">
        <Label>Data scope</Label>
        <Select value={type} onChange={(e) => setType(e.target.value as ScopeType)}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        {help ? <p className="text-xs text-slate-500 dark:text-slate-400">{help}</p> : null}
      </div>

      {type === 'sites' ? (
        <MultiChipSelect
          options={sites}
          value={siteIds}
          onChange={setSiteIds}
          placeholder="Add a site…"
          sheetTitle="Select sites"
        />
      ) : null}
      {type === 'crews' ? (
        <MultiChipSelect
          options={crews}
          value={crewIds}
          onChange={setCrewIds}
          placeholder="Add a crew…"
          sheetTitle="Select crews"
        />
      ) : null}
      {type === 'people' ? (
        <MultiChipSelect
          options={people}
          value={personIds}
          onChange={setPersonIds}
          placeholder="Add a person…"
          sheetTitle="Select people"
        />
      ) : null}
      {type === 'team' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Departments</Label>
            <MultiChipSelect
              options={departments}
              value={departmentIds}
              onChange={setDepartmentIds}
              placeholder="Add a department…"
              sheetTitle="Select departments"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Groups</Label>
            <MultiChipSelect
              options={groups}
              value={groupIds}
              onChange={setGroupIds}
              placeholder="Add a group…"
              sheetTitle="Select groups"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
