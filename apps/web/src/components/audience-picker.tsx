'use client'

import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Shared audience builder — the union of every per-module audience model.
//
// Generalised from the documents `new-assignment-form.tsx` builder (which only
// did role/trade/department/person/everyone) and extended with `org_unit`
// (site/project) so it covers inspection/journal/form audiences too. It is the
// single audience UI for the unified compliance hub.
//
// Controlled component: the parent owns `value: AudienceItem[]` and gets
// `onChange`. The resolved people set is the UNION of every row (deduped).
//
// Kind-aware: pass `allowedTypes` to restrict the type dropdown. Each obligation
// kind exposes only audience dimensions its evaluator can resolve, while every
// persisted target uses the unified `compliance_audience` table.

import { useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import type { PickerLookup, PickerOption } from '@/lib/picker-options'

export type AudienceType = 'everyone' | 'role' | 'trade' | 'department' | 'person' | 'org_unit'

export type AudienceItem = { type: AudienceType; entityKey: string }

export type AudienceOptions = {
  roles: { key: string; name: string }[]
  trades: { id: string; label: string }[]
  departments: { id: string; label: string }[]
  people: { id: string; label: string; sub?: string }[]
  orgUnits: { id: string; label: string }[]
}

const ALL_AUDIENCE_TYPES: AudienceType[] = [
  'everyone',
  'role',
  'trade',
  'department',
  'person',
  'org_unit',
]

const TYPE_LABEL: Record<AudienceType, string> = {
  everyone: 'Everyone',
  role: 'Role',
  trade: 'Trade',
  department: 'Department',
  person: 'Person',
  org_unit: 'Site / project',
}

// `everyone` carries a UI sentinel entityKey ('all'); obligation actions
// normalize it to the canonical empty key when persisting the audience row.
export const EVERYONE_KEY = 'all'

function lookupFor(type: Exclude<AudienceType, 'everyone'>): PickerLookup {
  switch (type) {
    case 'role':
      return 'compliance-obligation-audience-roles'
    case 'trade':
      return 'compliance-obligation-audience-trades'
    case 'department':
      return 'compliance-obligation-audience-departments'
    case 'person':
      return 'compliance-obligation-audience-people'
    case 'org_unit':
      return 'compliance-obligation-audience-org-units'
  }
}

export function AudiencePicker({
  value,
  onChange,
  options,
  allowedTypes = ALL_AUDIENCE_TYPES,
  pendingType,
  onPendingTypeChange,
  pendingValue,
  onPendingValueChange,
}: {
  value: AudienceItem[]
  onChange: (next: AudienceItem[]) => void
  options: AudienceOptions
  allowedTypes?: AudienceType[]
  // The "row being composed" is controlled too so the parent can reset it when
  // the obligation kind changes (which changes `allowedTypes`).
  pendingType: AudienceType
  onPendingTypeChange: (t: AudienceType) => void
  pendingValue: string
  onPendingValueChange: (v: string) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const types = ALL_AUDIENCE_TYPES.filter((t) => allowedTypes.includes(t))
  const [resolvedOptions, setResolvedOptions] = useState(options)

  function valueOptions(): { value: string; label: string }[] {
    if (pendingType === 'role')
      return resolvedOptions.roles.map((r) => ({ value: r.key, label: r.name }))
    if (pendingType === 'trade')
      return resolvedOptions.trades.map((t) => ({ value: t.id, label: t.label }))
    if (pendingType === 'department')
      return resolvedOptions.departments.map((d) => ({ value: d.id, label: d.label }))
    if (pendingType === 'org_unit')
      return resolvedOptions.orgUnits.map((o) => ({ value: o.id, label: o.label }))
    if (pendingType === 'person')
      return resolvedOptions.people.map((p) => ({
        value: p.id,
        label: `${p.label}${p.sub ? ' · ' + p.sub : ''}`,
      }))
    return []
  }

  function rememberOption(type: Exclude<AudienceType, 'everyone'>, option?: PickerOption) {
    if (!option) return
    setResolvedOptions((current) => {
      if (type === 'role') {
        if (current.roles.some((row) => row.key === option.value)) return current
        return { ...current, roles: [...current.roles, { key: option.value, name: option.label }] }
      }
      const key =
        type === 'trade'
          ? 'trades'
          : type === 'department'
            ? 'departments'
            : type === 'org_unit'
              ? 'orgUnits'
              : 'people'
      if (current[key].some((row) => row.id === option.value)) return current
      return {
        ...current,
        [key]: [...current[key], { id: option.value, label: option.label }],
      }
    })
  }

  function add() {
    if (pendingType === 'everyone') {
      if (value.some((a) => a.type === 'everyone')) return
      onChange([...value, { type: 'everyone', entityKey: EVERYONE_KEY }])
      return
    }
    if (!pendingValue) return
    if (value.some((a) => a.type === pendingType && a.entityKey === pendingValue)) return
    onChange([...value, { type: pendingType, entityKey: pendingValue }])
    onPendingValueChange('')
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Users size={16} /> <GeneratedText id="m_1d6e21e94d2295" />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_0b49aaed2d4b1b" />
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="aud-type">
              <GeneratedText id="m_074ba2f160c506" />
            </Label>
            <Select
              id="aud-type"
              value={pendingType}
              onChange={(e) => {
                onPendingTypeChange(e.target.value as AudienceType)
                onPendingValueChange('')
              }}
            >
              {types.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aud-value">
              <GeneratedText id="m_12ef8453778e3d" />
            </Label>
            <GeneratedValue
              value={
                pendingType === 'everyone' ? (
                  <Input
                    id="aud-value"
                    value="All active people"
                    disabled
                    className="bg-slate-50 dark:bg-slate-900"
                  />
                ) : (
                  <RemoteSearchSelect
                    id="aud-value"
                    lookup={lookupFor(pendingType)}
                    value={pendingValue}
                    onChange={onPendingValueChange}
                    onOptionChange={(option) => rememberOption(pendingType, option)}
                    initialOption={valueOptions().find((option) => option.value === pendingValue)}
                    excludedValues={value
                      .filter((item) => item.type === pendingType)
                      .map((item) => item.entityKey)}
                    placeholder={tGenerated('m_1e9cb0f49f978f')}
                    searchPlaceholder={tGenerated('m_1f0a8c50aedb8c', {
                      value0: TYPE_LABEL[pendingType].toLowerCase(),
                    })}
                    sheetTitle={`Select a ${TYPE_LABEL[pendingType].toLowerCase()}`}
                    ariaLabel={`Pick a ${TYPE_LABEL[pendingType].toLowerCase()}`}
                    clearable
                    emptyLabel={tGenerated('m_1e9cb0f49f978f')}
                  />
                )
              }
            />
          </div>
          <Button type="button" variant="outline" onClick={add}>
            <Plus size={14} /> <GeneratedText id="m_16c8592e5020a4" />
          </Button>
        </div>

        <GeneratedValue
          value={
            value.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <GeneratedText id="m_17cdd0f4ce49be" />
              </div>
            ) : (
              <ul className="space-y-2 text-sm">
                <GeneratedValue
                  value={value.map((a, idx) => (
                    <li
                      key={`${a.type}-${a.entityKey}-${idx}`}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">
                          <GeneratedValue value={TYPE_LABEL[a.type]} />
                        </Badge>
                        <span className="text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={audienceLabel(a, resolvedOptions)} />
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(idx)}
                        aria-label={tGenerated('m_1a9d8d971b1edb')}
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />
      </CardContent>
    </Card>
  )
}

function audienceLabel(row: AudienceItem, options: AudienceOptions): string {
  if (row.type === 'everyone') return 'Everyone (all active people)'
  if (row.type === 'role')
    return options.roles.find((x) => x.key === row.entityKey)?.name ?? row.entityKey
  if (row.type === 'trade')
    return options.trades.find((x) => x.id === row.entityKey)?.label ?? row.entityKey
  if (row.type === 'department')
    return options.departments.find((x) => x.id === row.entityKey)?.label ?? row.entityKey
  if (row.type === 'org_unit')
    return options.orgUnits.find((x) => x.id === row.entityKey)?.label ?? row.entityKey
  return options.people.find((x) => x.id === row.entityKey)?.label ?? row.entityKey
}
