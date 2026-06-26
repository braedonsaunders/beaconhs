'use client'

// Live database table-browser + field-mapper. Browse the source schema, pick a
// table per canonical entity, then map each field to a source column.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from '@beaconhs/ui'
import { introspectConnection, introspectTable, saveDbMapping } from '../_actions'

type TableRef = { name: string; schema?: string }
type Column = { name: string; type: string; nullable?: boolean }
type EntityMapping = {
  table: string
  schema?: string
  where?: string
  idColumn?: string
  columns: Record<string, string>
}

const ENTITY_FIELDS: Record<string, { key: string; label: string }[]> = {
  people: [
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'employeeNo', label: 'Employee no.' },
    { key: 'externalEmployeeId', label: 'External employee ID' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'jobTitle', label: 'Job title' },
    { key: 'departmentName', label: 'Department' },
    { key: 'tradeName', label: 'Trade' },
    { key: 'hireDate', label: 'Hire date' },
  ],
  org_unit: [
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code' },
    { key: 'parentCode', label: 'Parent code' },
  ],
  equipment: [
    { key: 'name', label: 'Name' },
    { key: 'assetTag', label: 'Asset tag' },
    { key: 'serialNumber', label: 'Serial number' },
    { key: 'typeName', label: 'Type' },
  ],
}

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
}

function tableKey(t: TableRef): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name
}
function parseKey(key: string): TableRef {
  const dot = key.indexOf('.')
  if (dot === -1) return { name: key }
  return { schema: key.slice(0, dot), name: key.slice(dot + 1) }
}

function normalizeInitial(
  initial: Record<string, unknown>,
  entities: string[],
): Record<string, EntityMapping> {
  const out: Record<string, EntityMapping> = {}
  for (const e of entities) {
    const m = (initial[e] ?? {}) as Partial<EntityMapping>
    out[e] = {
      table: m.table ?? '',
      schema: m.schema,
      where: m.where,
      idColumn: m.idColumn,
      columns: m.columns ?? {},
    }
  }
  return out
}

export function DbMapper({
  connectionId,
  dbKind,
  entities,
  initialMappings,
}: {
  connectionId: string
  dbKind: string
  entities: string[]
  initialMappings: Record<string, unknown>
}) {
  const router = useRouter()
  const [tables, setTables] = useState<TableRef[]>([])
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [columns, setColumns] = useState<Record<string, Column[]>>({})
  const [mappings, setMappings] = useState<Record<string, EntityMapping>>(() =>
    normalizeInitial(initialMappings, entities),
  )
  const [pending, startTransition] = useTransition()

  const get = (e: string): EntityMapping => mappings[e] ?? { table: '', columns: {} }

  async function loadColumns(entity: string, t: TableRef) {
    if (!t.name) return
    const res = await introspectTable(connectionId, t)
    if (res.ok) setColumns((c) => ({ ...c, [entity]: res.columns ?? [] }))
    else toast.error(res.error ?? 'Could not read columns')
  }

  // Load columns for any entity that already has a table mapped.
  useEffect(() => {
    for (const e of entities) {
      const m = mappings[e]
      // loadColumns fetches then setState in a later tick (not synchronously).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (m?.table) void loadColumns(e, { name: m.table, schema: m.schema })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function browse() {
    setBrowsing(true)
    setBrowseError(null)
    const res = await introspectConnection(connectionId)
    setBrowsing(false)
    if (!res.ok) {
      setBrowseError(res.error ?? 'Failed to connect.')
      return
    }
    setTables(res.tables ?? [])
    toast.success(`Found ${res.tables?.length ?? 0} table(s).`)
  }

  function setTable(entity: string, key: string) {
    const t = key ? (tables.find((x) => tableKey(x) === key) ?? parseKey(key)) : { name: '' }
    setMappings((m) => ({
      ...m,
      [entity]: { ...get(entity), table: t.name, schema: t.schema },
    }))
    if (t.name) void loadColumns(entity, t)
  }
  function setField(entity: string, field: string, col: string) {
    setMappings((m) => {
      const cur = m[entity] ?? { table: '', columns: {} }
      return { ...m, [entity]: { ...cur, columns: { ...cur.columns, [field]: col } } }
    })
  }
  function setMeta(entity: string, key: 'idColumn' | 'where', val: string) {
    setMappings((m) => ({ ...m, [entity]: { ...get(entity), [key]: val } }))
  }

  function save() {
    const clean: Record<string, EntityMapping> = {}
    for (const e of entities) {
      const m = mappings[e]
      if (m?.table) clean[e] = m
    }
    startTransition(async () => {
      const res = await saveDbMapping(connectionId, clean)
      if (res.ok) {
        toast.success('Mappings saved.')
        router.refresh()
      } else toast.error(res.error ?? 'Save failed.')
    })
  }

  const browsed = tables.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Tables &amp; field mapping</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={browse} disabled={browsing}>
            {browsing ? 'Connecting…' : browsed ? 'Refresh tables' : 'Test & browse tables'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {browseError ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{browseError}</p>
        ) : null}
        {!browsed && !browseError ? (
          <p className="text-sm text-slate-500">
            {dbKind ? (
              <>
                Save your <strong>{dbKind}</strong> credentials above, then browse the schema to map
                tables.
              </>
            ) : (
              <>Choose a database type and save credentials above, then browse the schema.</>
            )}
          </p>
        ) : null}

        {entities.map((entity) => {
          const m = get(entity)
          const fields = ENTITY_FIELDS[entity] ?? []
          const cols = columns[entity] ?? []
          const currentKey = m.table ? (m.schema ? `${m.schema}.${m.table}` : m.table) : ''
          const tableOptions = browsed ? tables.map(tableKey) : currentKey ? [currentKey] : []
          return (
            <div key={entity} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800">
                  {ENTITY_LABELS[entity] ?? entity}
                </h4>
              </div>
              <div className="space-y-1.5">
                <Label>Source table</Label>
                <Select
                  value={currentKey}
                  onChange={(e) => setTable(entity, e.target.value)}
                  disabled={!browsed && !currentKey}
                >
                  <option value="">— not synced —</option>
                  {tableOptions.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </div>

              {m.table ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {fields.map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label className="text-xs">{f.label}</Label>
                        <Select
                          value={m.columns[f.key] ?? ''}
                          onChange={(e) => setField(entity, f.key, e.target.value)}
                        >
                          <option value="">—</option>
                          {cols.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} ({c.type})
                            </option>
                          ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">ID column (match key)</Label>
                      <Select
                        value={m.idColumn ?? ''}
                        onChange={(e) => setMeta(entity, 'idColumn', e.target.value)}
                      >
                        <option value="">— natural key —</option>
                        {cols.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">WHERE filter (optional)</Label>
                      <Input
                        value={m.where ?? ''}
                        onChange={(e) => setMeta(entity, 'where', e.target.value)}
                        placeholder="active = 1"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save mappings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
