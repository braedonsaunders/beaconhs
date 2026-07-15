'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

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

type ScopeOption = { value: string; label: string; hint?: string }
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
        placeholder={tGeneratedValue(placeholder)}
        searchPlaceholder={tGeneratedValue(placeholder)}
        sheetTitle={sheetTitle}
      />
      <GeneratedValue
        value={
          chosen.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <GeneratedValue
                value={chosen.map((o) => (
                  <span
                    key={o.value}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-2.5 text-xs font-medium text-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                  >
                    <GeneratedValue value={o.label} />
                    <button
                      type="button"
                      aria-label={tGenerated('m_101f98a70352fa', { value0: o.label })}
                      onClick={() => onChange(value.filter((v) => v !== o.value))}
                      className="rounded-full p-0.5 text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              />
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              <GeneratedText id="m_06cfd9380291af" />
            </p>
          )
        }
      />
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
  const tGenerated = useGeneratedTranslations()
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
        <Label>
          <GeneratedText id="m_1e9292e2d1eeca" />
        </Label>
        <Select value={type} onChange={(e) => setType(e.target.value as ScopeType)}>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <GeneratedValue
          value={
            help ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value={help} />
              </p>
            ) : null
          }
        />
      </div>

      <GeneratedValue
        value={
          type === 'sites' ? (
            <MultiChipSelect
              options={sites}
              value={siteIds}
              onChange={setSiteIds}
              placeholder={tGenerated('m_11118293bef568')}
              sheetTitle="Select sites"
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          type === 'crews' ? (
            <MultiChipSelect
              options={crews}
              value={crewIds}
              onChange={setCrewIds}
              placeholder={tGenerated('m_196c111924cfeb')}
              sheetTitle="Select crews"
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          type === 'people' ? (
            <MultiChipSelect
              options={people}
              value={personIds}
              onChange={setPersonIds}
              placeholder={tGenerated('m_04e9474a19cf4c')}
              sheetTitle="Select people"
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          type === 'team' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_08416151d62d16" />
                </Label>
                <MultiChipSelect
                  options={departments}
                  value={departmentIds}
                  onChange={setDepartmentIds}
                  placeholder={tGenerated('m_083b0c3d76b76d')}
                  sheetTitle="Select departments"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_1668000fa2a811" />
                </Label>
                <MultiChipSelect
                  options={groups}
                  value={groupIds}
                  onChange={setGroupIds}
                  placeholder={tGenerated('m_059b16f0ac25bf')}
                  sheetTitle="Select groups"
                />
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
}
