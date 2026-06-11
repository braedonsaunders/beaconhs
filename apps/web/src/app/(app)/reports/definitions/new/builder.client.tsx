'use client'

// Client-side custom-report builder. We render a controlled form, build the
// `customQuery` payload on every change, and post it as a hidden JSON field
// alongside name/description/category when the user hits Save. Preview is
// rendered server-side via a redirect to /reports/definitions/[id].

import { useMemo, useState } from 'react'
import { Button, Input, Label, Select, Textarea } from '@beaconhs/ui'
import type { BuilderEntity, BuilderOperator } from '../_builder-meta'

type Filter = {
  id: string
  column: string
  op: string
  value: string
}

export function CustomReportBuilder({
  entities,
  operators,
  initialEntityKey,
  cloneFromId,
  action,
}: {
  entities: BuilderEntity[]
  operators: BuilderOperator[]
  initialEntityKey: string | null
  cloneFromId: string | null
  action: (formData: FormData) => Promise<void>
}) {
  const [entityKey, setEntityKey] = useState<string>(
    initialEntityKey && entities.some((e) => e.key === initialEntityKey)
      ? initialEntityKey
      : entities[0]!.key,
  )
  const entity = useMemo(() => entities.find((e) => e.key === entityKey)!, [entities, entityKey])

  const [name, setName] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [columns, setColumns] = useState<Set<string>>(
    new Set(entity.columns.slice(0, 5).map((c) => c.key)),
  )
  const [filters, setFilters] = useState<Filter[]>([])
  const [groupBy, setGroupBy] = useState<string>('')
  const [sortCol, setSortCol] = useState<string>(entity.defaultSort?.column ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(entity.defaultSort?.direction ?? 'desc')
  const [limit, setLimit] = useState<number>(1000)

  function changeEntity(newKey: string) {
    const newEnt = entities.find((e) => e.key === newKey)!
    setEntityKey(newKey)
    setColumns(new Set(newEnt.columns.slice(0, 5).map((c) => c.key)))
    setFilters([])
    setGroupBy('')
    setSortCol(newEnt.defaultSort?.column ?? '')
    setSortDir(newEnt.defaultSort?.direction ?? 'desc')
  }

  function toggleColumn(key: string) {
    setColumns((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function addFilter() {
    const c = entity.columns[0]
    setFilters((f) => [
      ...f,
      {
        id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        column: c?.key ?? '',
        op: 'eq',
        value: '',
      },
    ])
  }

  function updateFilter(id: string, patch: Partial<Filter>) {
    setFilters((arr) => arr.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function removeFilter(id: string) {
    setFilters((arr) => arr.filter((f) => f.id !== id))
  }

  const customQuery = useMemo(() => {
    return {
      entity: entityKey,
      columns: Array.from(columns),
      filters: filters
        .filter((f) => f.column && f.op)
        .map((f) => ({
          column: f.column,
          op: f.op,
          value: f.value === '' ? null : parseFilterValue(f.op, f.value),
        })),
      groupBy: groupBy || null,
      sort: sortCol ? { column: sortCol, direction: sortDir } : null,
      limit,
    }
  }, [entityKey, columns, filters, groupBy, sortCol, sortDir, limit])

  const canSave = name.trim().length > 0 && columns.size > 0

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="customQuery" value={JSON.stringify(customQuery)} />
      <input type="hidden" name="cloneFromId" value={cloneFromId ?? ''} />

      <div className="space-y-1.5">
        <Label>
          Report name <span className="text-red-600">*</span>
        </Label>
        <Input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. High-severity incidents this quarter"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea
          name="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One sentence about what this report is for. Shown in the catalogue."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>
            Entity <span className="text-red-600">*</span>
          </Label>
          <Select value={entityKey} onChange={(e) => changeEntity(e.target.value)}>
            {entities.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">{entity.description}</p>
        </div>
        <div className="space-y-1.5">
          <Label>Row limit</Label>
          <Input
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 1000)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          Columns to include <span className="text-red-600">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {entity.columns.map((c) => (
            <label
              key={c.key}
              className={
                'flex items-center gap-2 rounded border px-2 py-1.5 text-sm transition-colors ' +
                (columns.has(c.key)
                  ? 'border-teal-700 bg-teal-50 text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-teal-400')
              }
            >
              <input
                type="checkbox"
                checked={columns.has(c.key)}
                onChange={() => toggleColumn(c.key)}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{c.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Filters</Label>
          <Button type="button" variant="outline" size="sm" onClick={addFilter}>
            + Add filter
          </Button>
        </div>
        {filters.length === 0 ? (
          <p className="rounded border border-dashed border-slate-200 p-3 text-xs text-slate-500">
            No filters. The report will return all rows for the selected entity (within the row
            limit).
          </p>
        ) : (
          <ul className="space-y-2">
            {filters.map((f) => {
              const col = entity.columns.find((c) => c.key === f.column)
              const validOps = operators.filter((o) =>
                col && o.applicableKinds ? o.applicableKinds.includes(col.kind) : true,
              )
              const op = validOps.find((o) => o.key === f.op) ?? validOps[0]
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2"
                >
                  <Select
                    className="w-44"
                    value={f.column}
                    onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                  >
                    {entity.columns.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    className="w-44"
                    value={f.op}
                    onChange={(e) => updateFilter(f.id, { op: e.target.value })}
                  >
                    {validOps.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  {op?.needsValue !== 'none' ? (
                    <Input
                      className="flex-1"
                      placeholder={op?.needsValue === 'list' ? 'a,b,c' : 'value'}
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    />
                  ) : (
                    <span className="flex-1 text-xs text-slate-500">(no value needed)</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFilter(f.id)}
                  >
                    Remove
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Group by (optional)</Label>
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">— No grouping —</option>
            {entity.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Sort by</Label>
          <Select value={sortCol} onChange={(e) => setSortCol(e.target.value)}>
            <option value="">— None —</option>
            {entity.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Direction</Label>
          <Select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
        </div>
      </div>

      <details className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">View query JSON</summary>
        <pre className="mt-2 overflow-x-auto text-[11px] leading-snug whitespace-pre text-slate-700">
          {JSON.stringify(customQuery, null, 2)}
        </pre>
      </details>

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" disabled={!canSave}>
          Save report definition
        </Button>
      </div>
    </form>
  )
}

function parseFilterValue(op: string, value: string): string | number | string[] | number[] {
  const trimmed = value.trim()
  if (op === 'in' || op === 'not_in') {
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (op === 'between_days_ago') {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : 30
  }
  // Numeric operators
  if (op === 'gte' || op === 'lte') {
    const n = Number(trimmed)
    if (Number.isFinite(n) && trimmed !== '') return n
  }
  return trimmed
}
