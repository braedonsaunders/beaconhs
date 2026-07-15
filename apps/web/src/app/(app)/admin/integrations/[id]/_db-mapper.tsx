'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// Live database table-browser + field-mapper. A single SQL connection can feed
// multiple source streams into the same canonical entity, e.g. customers and
// jobs both landing as org_units with different levels.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@beaconhs/ui'
import { introspectConnection, introspectTable, saveDbMapping } from '../_actions'

type TableRef = { name: string; schema?: string }
type Column = { name: string; type: string; nullable?: boolean }
type EntityMapping = {
  label?: string
  table?: string
  schema?: string
  query?: string
  where?: string
  idColumn?: string
  externalIdTemplate?: string
  cursorColumn?: string
  columns: Record<string, string>
  values?: Record<string, string>
}
type MappingDraft = EntityMapping & { localId: string }

const ENTITY_FIELDS: Record<string, { key: string; label: string; help?: string }[]> = {
  people: [
    { key: 'fullName', label: 'Full name', help: 'Split into first/last if those are blank' },
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
    { key: 'status', label: 'Status' },
    { key: 'inactive', label: 'Inactive flag' },
  ],
  org_unit: [
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code' },
    { key: 'level', label: 'Level', help: 'customer, project, site, or area' },
    { key: 'parentCode', label: 'Parent code' },
    { key: 'lat', label: 'Latitude' },
    { key: 'lng', label: 'Longitude' },
    { key: 'geofenceMeters', label: 'Geofence metres' },
    { key: 'addressLine1', label: 'Address line 1' },
    { key: 'addressLine2', label: 'Address line 2' },
    { key: 'addressCity', label: 'City' },
    { key: 'addressRegion', label: 'Region' },
    { key: 'addressPostal', label: 'Postal' },
    { key: 'addressCountry', label: 'Country' },
  ],
  equipment: [
    { key: 'name', label: 'Name' },
    { key: 'assetTag', label: 'Asset tag' },
    { key: 'serialNumber', label: 'Serial number' },
    { key: 'typeName', label: 'Type' },
    { key: 'status', label: 'Status' },
  ],
}

const ENTITY_LABELS: Record<string, string> = {
  people: 'People',
  org_unit: 'Locations & Projects',
  equipment: 'Equipment',
}

const ENTITY_HINTS: Record<string, string> = {
  people: 'Employees, contractors, or HR records.',
  org_unit: 'Add separate streams for customers, projects, sites, or areas.',
  equipment: 'Assets, vehicles, tools, or other tracked equipment.',
}

function tableKey(t: TableRef): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name
}

function parseKey(key: string): TableRef {
  const trimmed = key.trim()
  const dot = trimmed.indexOf('.')
  if (dot === -1) return { name: trimmed }
  return { schema: trimmed.slice(0, dot), name: trimmed.slice(dot + 1) }
}

function newMapping(entity: string, count: number): MappingDraft {
  return {
    localId: `${entity}-${globalThis.crypto.randomUUID()}`,
    label: count > 0 ? `${ENTITY_LABELS[entity] ?? entity} source ${count + 1}` : '',
    table: '',
    columns: {},
    values: {},
  }
}

function asDraft(entity: string, raw: unknown, index: number): MappingDraft {
  const m = (raw ?? {}) as Partial<EntityMapping>
  return {
    localId: `${entity}-${index}-${globalThis.crypto.randomUUID()}`,
    label: m.label ?? '',
    table: m.table ?? '',
    schema: m.schema,
    query: m.query,
    where: m.where,
    idColumn: m.idColumn,
    externalIdTemplate: m.externalIdTemplate,
    cursorColumn: m.cursorColumn,
    columns: m.columns ?? {},
    values: m.values ?? {},
  }
}

function normalizeInitial(
  initial: Record<string, unknown>,
  entities: string[],
): Record<string, MappingDraft[]> {
  const out: Record<string, MappingDraft[]> = {}
  for (const e of entities) {
    const raw = initial[e]
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    out[e] = list.length ? list.map((m, i) => asDraft(e, m, i)) : [newMapping(e, 0)]
  }
  return out
}

function cleanMapping(m: MappingDraft): EntityMapping | null {
  const hasSource = Boolean(m.query?.trim() || m.table?.trim())
  if (!hasSource) return null
  const cleanColumns = Object.fromEntries(
    Object.entries(m.columns ?? {}).filter(([, v]) => v.trim()),
  )
  const cleanValues = Object.fromEntries(Object.entries(m.values ?? {}).filter(([, v]) => v.trim()))
  return {
    ...(m.label?.trim() ? { label: m.label.trim() } : {}),
    ...(m.table?.trim() ? { table: m.table.trim() } : {}),
    ...(m.schema?.trim() ? { schema: m.schema.trim() } : {}),
    ...(m.query?.trim() ? { query: m.query.trim() } : {}),
    ...(m.where?.trim() ? { where: m.where.trim() } : {}),
    ...(m.idColumn?.trim() ? { idColumn: m.idColumn.trim() } : {}),
    ...(m.externalIdTemplate?.trim() ? { externalIdTemplate: m.externalIdTemplate.trim() } : {}),
    ...(m.cursorColumn?.trim() ? { cursorColumn: m.cursorColumn.trim() } : {}),
    columns: cleanColumns,
    ...(Object.keys(cleanValues).length ? { values: cleanValues } : {}),
  }
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [tables, setTables] = useState<TableRef[]>([])
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [columns, setColumns] = useState<Record<string, Column[]>>({})
  const [mappings, setMappings] = useState<Record<string, MappingDraft[]>>(() =>
    normalizeInitial(initialMappings, entities),
  )
  const [pending, startTransition] = useTransition()

  const tableOptions = useMemo(() => tables.map(tableKey), [tables])

  async function loadColumns(localId: string, t: TableRef) {
    if (!t.name) return
    const res = await introspectTable(connectionId, t)
    if (res.ok) setColumns((c) => ({ ...c, [localId]: res.columns ?? [] }))
    else toast.error(tGeneratedValue(res.error ?? tGenerated('m_02fa4ff201cc72')))
  }

  useEffect(() => {
    let cancelled = false
    const initial = Object.values(normalizeInitial(initialMappings, entities))
      .flat()
      .flatMap((mapping) => (mapping.table ? [{ ...mapping, table: mapping.table }] : []))
    void Promise.all(
      initial.map(async (mapping) => ({
        localId: mapping.localId,
        result: await introspectTable(connectionId, {
          name: mapping.table,
          schema: mapping.schema,
        }),
      })),
    ).then((results) => {
      if (cancelled) return
      const loaded: Record<string, Column[]> = {}
      for (const { localId, result } of results) {
        if (result.ok) loaded[localId] = result.columns ?? []
      }
      setColumns(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [connectionId, entities, initialMappings])

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
    toast.success(tGenerated('m_114929c2827651', { value0: res.tables?.length ?? 0 }))
  }

  function updateMapping(entity: string, localId: string, patch: Partial<MappingDraft>) {
    setMappings((prev) => ({
      ...prev,
      [entity]: (prev[entity] ?? []).map((m) => (m.localId === localId ? { ...m, ...patch } : m)),
    }))
  }

  function setTable(entity: string, mapping: MappingDraft, value: string) {
    const t = value ? parseKey(value) : { name: '' }
    updateMapping(entity, mapping.localId, { table: t.name, schema: t.schema })
    if (t.name) void loadColumns(mapping.localId, t)
  }

  function setField(
    entity: string,
    mapping: MappingDraft,
    field: string,
    kind: 'columns' | 'values',
    value: string,
  ) {
    updateMapping(entity, mapping.localId, {
      [kind]: { ...(mapping[kind] ?? {}), [field]: value },
    } as Partial<MappingDraft>)
  }

  function addMapping(entity: string) {
    setMappings((prev) => {
      const list = prev[entity] ?? []
      return { ...prev, [entity]: [...list, newMapping(entity, list.length)] }
    })
  }

  function removeMapping(entity: string, localId: string) {
    setMappings((prev) => {
      const next = (prev[entity] ?? []).filter((m) => m.localId !== localId)
      return { ...prev, [entity]: next.length ? next : [newMapping(entity, 0)] }
    })
  }

  function save() {
    const clean: Record<string, EntityMapping | EntityMapping[]> = {}
    for (const e of entities) {
      const list = (mappings[e] ?? []).map(cleanMapping).filter(Boolean) as EntityMapping[]
      if (list.length === 1) clean[e] = list[0]!
      else if (list.length > 1) clean[e] = list
    }
    startTransition(async () => {
      const res = await saveDbMapping(connectionId, clean)
      if (res.ok) {
        toast.success(tGenerated('m_0115a2c545be23'))
        router.refresh()
      } else toast.error(tGeneratedValue(res.error ?? tGenerated('m_0824d7cd907294')))
    })
  }

  const browsed = tables.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>
              <GeneratedText id="m_08f089aef3ae50" />
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              <GeneratedText id="m_1925bcc5b692d6" /> <code>C-{'{{NetsuiteID}}'}</code>.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={browse} disabled={browsing}>
            <GeneratedValue
              value={
                browsing ? (
                  <GeneratedText id="m_0004275ec9f230" />
                ) : browsed ? (
                  <GeneratedText id="m_0406666880c013" />
                ) : (
                  <GeneratedText id="m_0bdcfef3e94d45" />
                )
              }
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <GeneratedValue
          value={
            browseError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                <GeneratedValue value={browseError} />
              </p>
            ) : null
          }
        />
        <GeneratedValue
          value={
            !browsed && !browseError ? (
              <p className="text-sm text-slate-500">
                <GeneratedValue
                  value={
                    dbKind ? (
                      <>
                        <GeneratedText id="m_007b604913e493" />{' '}
                        <strong>
                          <GeneratedValue value={dbKind} />
                        </strong>{' '}
                        <GeneratedText id="m_193e867f7884ad" />
                      </>
                    ) : (
                      <>
                        <GeneratedText id="m_01b93c0d57bb78" />
                      </>
                    )
                  }
                />
              </p>
            ) : null
          }
        />

        <datalist id="db-table-options">
          <GeneratedValue
            value={tableOptions.map((k) => (
              <option key={k} value={k} />
            ))}
          />
        </datalist>

        <GeneratedValue
          value={entities.map((entity) => {
            const list = mappings[entity] ?? []
            return (
              <section key={entity} className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">
                      <GeneratedValue value={ENTITY_LABELS[entity] ?? entity} />
                    </h4>
                    <p className="text-xs text-slate-500">
                      <GeneratedValue value={ENTITY_HINTS[entity]} />
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addMapping(entity)}
                  >
                    <Plus size={14} /> <GeneratedText id="m_0b09abc7c21f66" />
                  </Button>
                </div>

                <GeneratedValue
                  value={list.map((m, index) => {
                    const cols = columns[m.localId] ?? []
                    const currentKey = m.table
                      ? m.schema
                        ? `${m.schema}.${m.table}`
                        : m.table
                      : ''
                    const listId = `db-columns-${m.localId}`
                    return (
                      <div
                        key={m.localId}
                        className="space-y-3 rounded-md border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={m.label ?? ''}
                            onChange={(event) =>
                              updateMapping(entity, m.localId, { label: event.target.value })
                            }
                            placeholder={tGenerated('m_108ea7d5e08016', {
                              value0: ENTITY_LABELS[entity] ?? entity,
                              value1: index + 1,
                            })}
                            aria-label={tGenerated('m_19f1bfd5122468')}
                            className="max-w-sm bg-white dark:bg-slate-950"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => removeMapping(entity, m.localId)}
                          >
                            <Trash2 size={14} /> <GeneratedText id="m_1a9d8d971b1edb" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>
                              <GeneratedText id="m_041ae7c0b57fc0" />
                            </Label>
                            <Input
                              list="db-table-options"
                              value={currentKey}
                              onChange={(event) => setTable(entity, m, event.target.value)}
                              placeholder={tGenerated('m_1034590c9cdac6')}
                              className="bg-white dark:bg-slate-950"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>
                              <GeneratedText id="m_04dcc637d60dc5" />
                            </Label>
                            <Input
                              value={m.where ?? ''}
                              onChange={(event) =>
                                updateMapping(entity, m.localId, { where: event.target.value })
                              }
                              placeholder={tGenerated('m_1b4856b1000588')}
                              className="bg-white dark:bg-slate-950"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label>
                            <GeneratedText id="m_13064e62ec4400" />
                          </Label>
                          <Textarea
                            value={m.query ?? ''}
                            onChange={(event) =>
                              updateMapping(entity, m.localId, { query: event.target.value })
                            }
                            rows={3}
                            placeholder={tGenerated('m_1fa263cd9bbe16')}
                            className="bg-white font-mono text-xs dark:bg-slate-950"
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>
                              <GeneratedText id="m_0b8e8e8e9239e3" />
                            </Label>
                            <Input
                              list={listId}
                              value={m.idColumn ?? ''}
                              onChange={(event) =>
                                updateMapping(entity, m.localId, { idColumn: event.target.value })
                              }
                              placeholder={tGenerated('m_1dee6e4c7039ad')}
                              className="bg-white dark:bg-slate-950"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>
                              <GeneratedText id="m_0e15974e315c3e" />
                            </Label>
                            <Input
                              value={m.externalIdTemplate ?? ''}
                              onChange={(event) =>
                                updateMapping(entity, m.localId, {
                                  externalIdTemplate: event.target.value,
                                })
                              }
                              placeholder={tGenerated('m_1932f67466feb0')}
                              className="bg-white dark:bg-slate-950"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>
                              <GeneratedText id="m_1973cef4eb7b8b" />
                            </Label>
                            <Input
                              list={listId}
                              value={m.cursorColumn ?? ''}
                              onChange={(event) =>
                                updateMapping(entity, m.localId, {
                                  cursorColumn: event.target.value,
                                })
                              }
                              placeholder={tGenerated('m_19974b78a7b90c')}
                              className="bg-white dark:bg-slate-950"
                            />
                          </div>
                        </div>

                        <datalist id={listId}>
                          <GeneratedValue
                            value={cols.map((c) => (
                              <option key={c.name} value={c.name}>
                                <GeneratedValue value={c.type} />
                              </option>
                            ))}
                          />
                        </datalist>

                        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                          <GeneratedValue
                            value={(ENTITY_FIELDS[entity] ?? []).map((f) => (
                              <div
                                key={f.key}
                                className="grid grid-cols-1 gap-2 rounded border border-slate-100 bg-white p-2 sm:grid-cols-[150px_1fr_1fr] dark:border-slate-800 dark:bg-slate-950"
                              >
                                <div>
                                  <Label className="text-xs">
                                    <GeneratedValue value={f.label} />
                                  </Label>
                                  <GeneratedValue
                                    value={
                                      f.help ? (
                                        <p className="mt-0.5 text-[11px] text-slate-400">
                                          {f.help}
                                        </p>
                                      ) : null
                                    }
                                  />
                                </div>
                                <Input
                                  list={listId}
                                  value={m.columns?.[f.key] ?? ''}
                                  onChange={(event) =>
                                    setField(entity, m, f.key, 'columns', event.target.value)
                                  }
                                  placeholder={tGenerated('m_1bddb60fbfde4e')}
                                />
                                <Input
                                  value={m.values?.[f.key] ?? ''}
                                  onChange={(event) =>
                                    setField(entity, m, f.key, 'values', event.target.value)
                                  }
                                  placeholder={tGenerated('m_18f109b747611a')}
                                />
                              </div>
                            ))}
                          />
                        </div>
                      </div>
                    )
                  })}
                />
              </section>
            )
          })}
        />

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={pending}>
            <GeneratedValue
              value={
                pending ? (
                  <GeneratedText id="m_06a499b116c0d7" />
                ) : (
                  <GeneratedText id="m_1e133f4330037a" />
                )
              }
            />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
