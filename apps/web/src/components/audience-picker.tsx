'use client'

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
// Kind-aware: pass `allowedTypes` to restrict the type dropdown. In Milestone 1
// the hub writes to LEGACY per-module tables, and each table only supports a
// subset of audience kinds — so the obligation form narrows `allowedTypes` by
// kind to avoid silently dropping unsupported targets. The unified
// `compliance_audience` table (M3) supports all six for every kind.

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
  SearchSelect,
  Select,
} from '@beaconhs/ui'

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

// `everyone` carries a sentinel entityKey ('all') to match the documents
// convention; the unified audience table later normalises this.
export const EVERYONE_KEY = 'all'

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
  const types = ALL_AUDIENCE_TYPES.filter((t) => allowedTypes.includes(t))

  function valueOptions(): { value: string; label: string }[] {
    if (pendingType === 'role') return options.roles.map((r) => ({ value: r.key, label: r.name }))
    if (pendingType === 'trade') return options.trades.map((t) => ({ value: t.id, label: t.label }))
    if (pendingType === 'department')
      return options.departments.map((d) => ({ value: d.id, label: d.label }))
    if (pendingType === 'org_unit')
      return options.orgUnits.map((o) => ({ value: o.id, label: o.label }))
    if (pendingType === 'person')
      return options.people.map((p) => ({
        value: p.id,
        label: `${p.label}${p.sub ? ' · ' + p.sub : ''}`,
      }))
    return []
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
            <Users size={16} /> Audience
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Add one or more audience targets. The resolved people set is the union of every row;
          duplicates are de-duped.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="aud-type">Type</Label>
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
            <Label htmlFor="aud-value">Pick</Label>
            {pendingType === 'everyone' ? (
              <Input
                id="aud-value"
                value="All active people"
                disabled
                className="bg-slate-50 dark:bg-slate-900"
              />
            ) : pendingType === 'person' ? (
              <SearchSelect
                value={pendingValue}
                onChange={onPendingValueChange}
                options={valueOptions()}
                placeholder="— pick —"
                searchPlaceholder="Search people…"
                sheetTitle="Select a person"
                ariaLabel="Pick a person"
                clearable
                emptyLabel="— pick —"
              />
            ) : (
              <Select
                id="aud-value"
                value={pendingValue}
                onChange={(e) => onPendingValueChange(e.target.value)}
              >
                <option value="">— pick —</option>
                {valueOptions().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <Button type="button" variant="outline" onClick={add}>
            <Plus size={14} /> Add
          </Button>
        </div>

        {value.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            No audience yet — add at least one above.
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {value.map((a, idx) => (
              <li
                key={`${a.type}-${a.entityKey}-${idx}`}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">{TYPE_LABEL[a.type]}</Badge>
                  <span className="text-slate-900 dark:text-slate-100">
                    {audienceLabel(a, options)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(idx)}
                  aria-label="Remove"
                >
                  <Trash2 size={14} className="text-red-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}
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

/** One-line summary of an audience for list/detail rows. */
function summariseAudience(value: AudienceItem[]): string {
  if (value.length === 0) return '—'
  if (value.some((a) => a.type === 'everyone')) return 'Everyone'
  const counts = new Map<AudienceType, number>()
  for (const a of value) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
  const parts: string[] = []
  for (const [type, n] of counts) {
    const noun = TYPE_LABEL[type].toLowerCase()
    parts.push(`${n} ${noun}${n === 1 ? '' : 's'}`)
  }
  return parts.join(', ')
}
