'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The outbound automation builder: name it, pick a TRIGGER, pick a DESTINATION,
// configure the connection + secrets, map the data (per-destination editor with
// click-to-insert {{tokens}} from the trigger), test live, and save. Uncontrolled
// inputs so token insertion can write at the cursor; the mapping is reconstructed
// server-side from the field names by saveOutbound.

import { useMemo, useRef, useState, useTransition } from 'react'
import type { Dispatch, FocusEvent, ReactNode, SetStateAction } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Plus, Send, Trash2, Zap } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, cn } from '@beaconhs/ui'
import type { FieldDef, TriggerDef } from '@beaconhs/integrations'
import { saveOutbound, testOutbound } from '../_actions'

type ConfigFieldLite = {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'boolean'
  options?: { value: string; label: string }[]
  placeholder?: string
  help?: string
  required?: boolean
}
type SecretFieldLite = { key: string; label: string; required?: boolean; help?: string }
export type DestLite = {
  key: string
  name: string
  description: string
  mappingKind: 'sql' | 'http' | 'slack' | 'sheets' | 'email'
  reversible: boolean
  configFields: ConfigFieldLite[]
  secretFields: SecretFieldLite[]
}

type ActiveEl = HTMLInputElement | HTMLTextAreaElement | null

let rowSeq = 0
const nextId = () => `r${rowSeq++}`

export function IntegrationBuilder({
  id,
  initial,
  triggers,
  destinations,
}: {
  id: string
  initial: {
    name: string
    enabled: boolean
    oncePerRecord: boolean
    triggerKey: string
    destinationKey: string
    config: Record<string, unknown>
    secretsPresent: Record<string, boolean>
    mapping: Record<string, unknown>
  }
  triggers: TriggerDef[]
  destinations: DestLite[]
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const formRef = useRef<HTMLFormElement>(null)
  const activeEl = useRef<ActiveEl>(null)
  const [triggerKey, setTriggerKey] = useState(initial.triggerKey)
  const [destinationKey, setDestinationKey] = useState(initial.destinationKey)
  const [testing, startTest] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const trigger = useMemo(() => triggers.find((t) => t.key === triggerKey), [triggers, triggerKey])
  const dest = useMemo(
    () => destinations.find((d) => d.key === destinationKey),
    [destinations, destinationKey],
  )

  const register = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    activeEl.current = e.currentTarget
  }
  const insertToken = (tok: string) => {
    const el = activeEl.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const t = `{{${tok}}}`
    el.value = el.value.slice(0, start) + t + el.value.slice(end)
    const pos = start + t.length
    el.focus()
    el.setSelectionRange(pos, pos)
  }

  function runTest() {
    const form = formRef.current
    if (!form) return
    setResult(null)
    const fd = new FormData(form)
    startTest(async () => {
      try {
        setResult(await testOutbound(fd))
      } catch (e) {
        setResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed.' })
      }
    })
  }

  return (
    <form ref={formRef} action={saveOutbound} className="space-y-6">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="destinationKey" value={destinationKey} />

      {/* 1 — Name */}
      <Field label={tGenerated('m_02b18d5c7f6f2d')}>
        <Input
          name="name"
          defaultValue={initial.name}
          placeholder={tGenerated('m_06131a0939f135')}
          onFocus={register}
        />
      </Field>

      {/* 2 — Trigger */}
      <Section
        step={1}
        title={tGenerated('m_034d6120666473')}
        subtitle={tGenerated('m_08abf3218a25bc')}
      >
        <Select
          name="triggerKey"
          value={triggerKey}
          onChange={(e) => setTriggerKey(e.target.value)}
          aria-label={tGenerated('m_1db1e5c9ca41ce')}
        >
          <option value="">{'Select a trigger…'}</option>
          {triggers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
        <GeneratedValue
          value={
            trigger ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value={trigger.description} />
              </p>
            ) : null
          }
        />
      </Section>

      {/* 3 — Destination */}
      <Section
        step={2}
        title={tGenerated('m_18dc0aaa91045d')}
        subtitle={tGenerated('m_1925b60e0984ae')}
      >
        <Select
          value={destinationKey}
          onChange={(e) => {
            setDestinationKey(e.target.value)
            setResult(null)
          }}
          aria-label={tGenerated('m_0354efc998fbe0')}
        >
          <option value="">{'Select a destination…'}</option>
          {destinations.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name}
            </option>
          ))}
        </Select>
        <GeneratedValue
          value={
            dest ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue value={dest.description} />
              </p>
            ) : null
          }
        />
      </Section>

      {/* 4 + 5 — Connection + mapping, side-by-side with the token panel */}
      <GeneratedValue
        value={
          dest ? (
            <Section
              step={3}
              title={tGenerated('m_0c3627ec1bf266')}
              subtitle={tGenerated('m_0ca0a1f4dff1b8')}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                <div className="space-y-4">
                  <GeneratedValue
                    value={
                      dest.configFields.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <GeneratedValue
                            value={dest.configFields.map((f) => (
                              <FieldInput
                                key={f.key}
                                field={f}
                                value={initial.config[f.key]}
                                onFocus={register}
                              />
                            ))}
                          />
                        </div>
                      ) : null
                    }
                  />

                  <GeneratedValue
                    value={
                      dest.secretFields.length > 0 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <GeneratedValue
                            value={dest.secretFields.map((s) => (
                              <Field
                                key={s.key}
                                label={tGeneratedValue(s.label)}
                                required={s.required}
                                help={s.help}
                              >
                                <Input
                                  name={s.key}
                                  type="password"
                                  autoComplete="new-password"
                                  placeholder={tGeneratedValue(
                                    initial.secretsPresent[s.key]
                                      ? tGenerated('m_1f4710cef5d8ac')
                                      : '',
                                  )}
                                />
                              </Field>
                            ))}
                          />
                        </div>
                      ) : null
                    }
                  />

                  <MappingEditor dest={dest} mapping={initial.mapping} register={register} />
                </div>

                <TokenPanel trigger={trigger} onInsert={insertToken} />
              </div>
            </Section>
          ) : null
        }
      />

      {/* options + result + actions */}
      <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Check
            name="enabled"
            defaultChecked={initial.enabled}
            label={tGenerated('m_0dd399c5304eb6')}
          />
          <GeneratedValue
            value={
              dest && !dest.reversible ? (
                <Check
                  name="oncePerRecord"
                  defaultChecked={initial.oncePerRecord}
                  label={tGenerated('m_0171ea72d4e222')}
                />
              ) : null
            }
          />
        </div>

        <GeneratedValue
          value={
            result ? (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                  result.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
                )}
                role="status"
              >
                <GeneratedValue
                  value={
                    result.ok ? (
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    )
                  }
                />
                <span className="break-words">
                  <GeneratedValue value={result.message} />
                </span>
              </div>
            ) : null
          }
        />

        <div className="flex items-center justify-end gap-2">
          <GeneratedValue
            value={
              dest ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runTest}
                  disabled={testing}
                >
                  <GeneratedValue
                    value={
                      testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />
                    }
                  />
                  <GeneratedValue
                    value={
                      testing ? (
                        <GeneratedText id="m_100301b70a8468" />
                      ) : (
                        <GeneratedText id="m_0b41b4284dc188" />
                      )
                    }
                  />
                </Button>
              ) : null
            }
          />
          <Button type="submit">
            <Zap size={14} /> <GeneratedText id="m_07872cbc52eacc" />
          </Button>
        </div>
      </div>
    </form>
  )
}

// --- mapping editors -------------------------------------------------------

function MappingEditor({
  dest,
  mapping,
  register,
}: {
  dest: DestLite
  mapping: Record<string, unknown>
  register: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  if (dest.mappingKind === 'sql') return <SqlMapping mapping={mapping} register={register} />
  if (dest.mappingKind === 'http') return <HttpMapping mapping={mapping} register={register} />
  if (dest.mappingKind === 'sheets') return <SheetsMapping mapping={mapping} register={register} />
  if (dest.mappingKind === 'slack')
    return (
      <div className="space-y-3">
        <Field
          label={tGenerated('m_0e4ff640f8e7d6')}
          help="The Slack/Teams message. Insert {{tokens}} from the panel."
        >
          <Textarea
            name="map-text"
            rows={4}
            defaultValue={String(mapping.text ?? '')}
            onFocus={register}
            placeholder={tGenerated('m_101359827e2563')}
          />
        </Field>
        <Field
          label={tGenerated('m_00b9166bff564b')}
          help="Slack Block Kit array. Overrides the plain message; one rich message per item. Leave blank for plain text."
        >
          <Textarea
            name="map-blocks"
            rows={4}
            className="font-mono text-xs"
            defaultValue={String(mapping.blocks ?? '')}
            onFocus={register}
            placeholder={tGenerated('m_0f2f601ad1de47')}
          />
        </Field>
      </div>
    )
  // email
  return (
    <Field
      label={tGenerated('m_112e161087a1d9')}
      help="Insert {{tokens}} from the panel. Basic HTML is supported."
    >
      <Textarea
        name="map-body"
        rows={6}
        className="font-mono text-xs"
        defaultValue={String(mapping.body ?? '')}
        onFocus={register}
        placeholder={tGenerated('m_0842d827470824')}
      />
    </Field>
  )
}

function SqlMapping({
  mapping,
  register,
}: {
  mapping: Record<string, unknown>
  register: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const cols0 = Object.entries((mapping.columns as Record<string, unknown>) ?? {}).map(
    ([k, v]) => ({
      id: nextId(),
      name: k,
      val: v == null ? 'null' : String(v),
    }),
  )
  const [rows, setRows] = useState(cols0.length ? cols0 : [{ id: nextId(), name: '', val: '' }])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={tGenerated('m_1068a9c4cc2f75')} required>
          <Input
            name="map-table"
            defaultValue={String(mapping.table ?? '')}
            placeholder={tGenerated('m_1b2a1b054bbbde')}
          />
        </Field>
        <Field
          label={tGenerated('m_11161e26747a7a')}
          help="Required. BeaconHS records returned IDs so a partial retry can remove completed inserts before trying again."
          required
        >
          <Input
            name="map-idColumn"
            defaultValue={String(mapping.idColumn ?? '')}
            placeholder={tGenerated('m_1405ee220a2f7a')}
          />
        </Field>
        <Field label={tGenerated('m_10f5226beae784')}>
          <Select name="map-mode" defaultValue={mapping.mode === 'weekly' ? 'weekly' : 'row'}>
            <option value="row">{'One row per item'}</option>
            <option value="weekly">{'One row per item per ISO week (day1–7 hours)'}</option>
          </Select>
        </Field>
        <Field
          label={tGenerated('m_00897c77bfe378')}
          help="e.g. externalEmployeeId — items missing it are skipped."
        >
          <Input
            name="map-requireField"
            defaultValue={String(mapping.requireField ?? '')}
            placeholder={tGenerated('m_04b4cae0b6ae0e')}
            onFocus={register}
          />
        </Field>
      </div>

      <Field
        label={tGenerated('m_1c737d8b35e103')}
        help='One per line: "Department name = external id". Resolves {{department}}.'
      >
        <Textarea
          name="map-departmentMap"
          rows={2}
          className="font-mono text-xs"
          defaultValue={String(mapping.departmentMap ?? '')}
          placeholder={tGenerated('m_1041f60bc9e153')}
        />
      </Field>

      <div className="space-y-2">
        <Label>
          <GeneratedText id="m_1e6336f2c22840" />
        </Label>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          <GeneratedText id="m_0b27b7e8397181" />{' '}
          <GeneratedValue value={<GeneratedText id="m_1c4eb4fa7c2f7b" />} />.
        </p>
        <RowList
          rows={rows}
          setRows={setRows}
          render={(r) => (
            <>
              <Input
                name="col-name"
                defaultValue={r.name}
                placeholder={tGenerated('m_0fce539f330993')}
                className="sm:w-40"
              />
              <Input
                name="col-val"
                defaultValue={r.val}
                placeholder={tGenerated('m_1454dd1744f30b')}
                onFocus={register}
                className="flex-1"
              />
            </>
          )}
          addLabel="Add column"
        />
      </div>
    </div>
  )
}

function HttpMapping({
  mapping,
  register,
}: {
  mapping: Record<string, unknown>
  register: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const h0 = Object.entries((mapping.headers as Record<string, string>) ?? {}).map(([k, v]) => ({
    id: nextId(),
    name: k,
    val: String(v),
  }))
  const [rows, setRows] = useState(h0)

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>
          <GeneratedText id="m_06c131e0e0c029" />
        </Label>
        <RowList
          rows={rows}
          setRows={setRows}
          render={(r) => (
            <>
              <Input
                name="hdr-key"
                defaultValue={r.name}
                placeholder={tGenerated('m_167a3c84ec8cf4')}
                className="sm:w-44"
              />
              <Input
                name="hdr-val"
                defaultValue={r.val}
                placeholder={tGenerated('m_1454dd1744f30b')}
                onFocus={register}
                className="flex-1"
              />
            </>
          )}
          addLabel="Add header"
        />
      </div>
      <Field
        label={tGenerated('m_1952c22638bdb3')}
        help="The body sent per item. Insert {{tokens}}."
      >
        <Textarea
          name="map-body"
          rows={7}
          className="font-mono text-xs"
          defaultValue={String(mapping.body ?? '')}
          onFocus={register}
          placeholder={tGenerated('m_0652360472ea6e')}
        />
      </Field>
    </div>
  )
}

function SheetsMapping({
  mapping,
  register,
}: {
  mapping: Record<string, unknown>
  register: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const v0 = (Array.isArray(mapping.values) ? (mapping.values as unknown[]) : []).map((v) => ({
    id: nextId(),
    name: '',
    val: v == null ? '' : String(v),
  }))
  const [rows, setRows] = useState(v0.length ? v0 : [{ id: nextId(), name: '', val: '' }])
  return (
    <div className="space-y-2">
      <Label>
        <GeneratedText id="m_1a3928b6193a81" />
      </Label>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_10b8c399f605d2" />{' '}
        <GeneratedValue value={<GeneratedText id="m_1c4eb4fa7c2f7b" />} />.
      </p>
      <RowList
        rows={rows}
        setRows={setRows}
        render={(r) => (
          <Input
            name="val-expr"
            defaultValue={r.val}
            placeholder={tGenerated('m_1454dd1744f30b')}
            onFocus={register}
            className="flex-1"
          />
        )}
        addLabel="Add cell"
      />
    </div>
  )
}

// --- shared bits -----------------------------------------------------------

type Row = { id: string; name: string; val: string }

function RowList({
  rows,
  setRows,
  render,
  addLabel,
}: {
  rows: Row[]
  setRows: Dispatch<SetStateAction<Row[]>>
  render: (r: Row) => ReactNode
  addLabel: string
}) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-2">
      <GeneratedValue
        value={rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <GeneratedValue value={render(r)} />
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
              title={tGenerated('m_1a9d8d971b1edb')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      />
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { id: nextId(), name: '', val: '' }])}
        className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400"
      >
        <Plus size={14} /> <GeneratedValue value={addLabel} />
      </button>
    </div>
  )
}

function TokenPanel({
  trigger,
  onInsert,
}: {
  trigger?: TriggerDef
  onInsert: (t: string) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  if (!trigger) {
    return (
      <aside className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        <GeneratedText id="m_12c527bea62bca" />
      </aside>
    )
  }
  return (
    <aside className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        <GeneratedText id="m_1b12658f0d45ce" />
      </p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        <GeneratedText id="m_03352d77a115d2" />{' '}
        <GeneratedValue value={<GeneratedText id="m_1c4eb4fa7c2f7b" />} />.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <GeneratedValue
          value={trigger.fields.map((fd: FieldDef) => (
            <button
              key={fd.key}
              type="button"
              onClick={() => onInsert(fd.key)}
              title={tGeneratedValue(`{{${fd.key}}}`)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-600"
            >
              <GeneratedValue value={fd.label} />
            </button>
          ))}
        />
      </div>
      <GeneratedValue
        value={
          trigger.dynamicFieldsNote ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              <GeneratedValue value={trigger.dynamicFieldsNote} />
            </p>
          ) : null
        }
      />
    </aside>
  )
}

function Section({
  step,
  title,
  subtitle,
  children,
}: {
  step: number
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-teal-600 text-xs font-semibold text-white">
          <GeneratedValue value={step} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            <GeneratedValue value={title} />
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            <GeneratedValue value={subtitle} />
          </p>
        </div>
      </div>
      <div className="pl-8">
        <GeneratedValue value={children} />
      </div>
    </section>
  )
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string
  required?: boolean
  help?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
      <GeneratedValue
        value={
          help ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              <GeneratedValue value={help} />
            </p>
          ) : null
        }
      />
    </div>
  )
}

function FieldInput({
  field,
  value,
  onFocus,
}: {
  field: ConfigFieldLite
  value: unknown
  onFocus: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const v = value == null ? '' : String(value)
  return (
    <div className={cn('space-y-1.5', field.type === 'textarea' && 'sm:col-span-2')}>
      <Label htmlFor={field.key}>
        <GeneratedValue value={field.label} />
        <GeneratedValue value={field.required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue
        value={
          field.type === 'textarea' ? (
            <Textarea
              id={field.key}
              name={field.key}
              rows={4}
              defaultValue={v}
              placeholder={tGeneratedValue(field.placeholder)}
              className="font-mono text-xs"
              onFocus={onFocus}
            />
          ) : field.type === 'select' ? (
            <Select id={field.key} name={field.key} defaultValue={v}>
              {(field.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : field.type === 'boolean' ? (
            <div className="pt-1">
              <input
                type="checkbox"
                name={field.key}
                defaultChecked={value === true || value === 'true'}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
            </div>
          ) : (
            <Input
              id={field.key}
              name={field.key}
              type={field.type === 'number' ? 'number' : 'text'}
              defaultValue={v}
              placeholder={tGeneratedValue(field.placeholder)}
              onFocus={onFocus}
            />
          )
        }
      />
      <GeneratedValue
        value={
          field.help ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              <GeneratedValue value={field.help} />
            </p>
          ) : null
        }
      />
    </div>
  )
}

function Check({
  name,
  defaultChecked,
  label,
}: {
  name: string
  defaultChecked: boolean
  label: string
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
        <GeneratedValue value={label} />
      </span>
    </label>
  )
}
