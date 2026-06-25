'use client'

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
      <Field label="Name">
        <Input
          name="name"
          defaultValue={initial.name}
          placeholder="e.g. Post incidents to Slack"
          onFocus={register}
        />
      </Field>

      {/* 2 — Trigger */}
      <Section step={1} title="When this happens" subtitle="The event that fires the automation.">
        <Select
          name="triggerKey"
          value={triggerKey}
          onChange={(e) => setTriggerKey(e.target.value)}
          aria-label="Trigger"
        >
          <option value="">Select a trigger…</option>
          {triggers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
        {trigger ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{trigger.description}</p>
        ) : null}
      </Section>

      {/* 3 — Destination */}
      <Section
        step={2}
        title="Send it here"
        subtitle="The external service that receives the data."
      >
        <Select
          value={destinationKey}
          onChange={(e) => {
            setDestinationKey(e.target.value)
            setResult(null)
          }}
          aria-label="Destination"
        >
          <option value="">Select a destination…</option>
          {destinations.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name}
            </option>
          ))}
        </Select>
        {dest ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{dest.description}</p>
        ) : null}
      </Section>

      {/* 4 + 5 — Connection + mapping, side-by-side with the token panel */}
      {dest ? (
        <Section
          step={3}
          title="Configure & map"
          subtitle="Connect the service, then map your data."
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <div className="space-y-4">
              {dest.configFields.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {dest.configFields.map((f) => (
                    <FieldInput
                      key={f.key}
                      field={f}
                      value={initial.config[f.key]}
                      onFocus={register}
                    />
                  ))}
                </div>
              ) : null}

              {dest.secretFields.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {dest.secretFields.map((s) => (
                    <Field key={s.key} label={s.label} required={s.required} help={s.help}>
                      <Input
                        name={s.key}
                        type="password"
                        autoComplete="new-password"
                        placeholder={initial.secretsPresent[s.key] ? '•••••••• (unchanged)' : ''}
                      />
                    </Field>
                  ))}
                </div>
              ) : null}

              <MappingEditor dest={dest} mapping={initial.mapping} register={register} />
            </div>

            <TokenPanel trigger={trigger} onInsert={insertToken} />
          </div>
        </Section>
      ) : null}

      {/* options + result + actions */}
      <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Check name="enabled" defaultChecked={initial.enabled} label="Enabled" />
          {dest && !dest.reversible ? (
            <Check
              name="oncePerRecord"
              defaultChecked={initial.oncePerRecord}
              label="Only send once per record"
            />
          ) : null}
        </div>

        {result ? (
          <div
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
              result.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
            )}
            role="status"
          >
            {result.ok ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
            )}
            <span className="break-words">{result.message}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {dest ? (
            <Button type="button" variant="outline" size="sm" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          ) : null}
          <Button type="submit">
            <Zap size={14} /> Save automation
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
  if (dest.mappingKind === 'sql') return <SqlMapping mapping={mapping} register={register} />
  if (dest.mappingKind === 'http') return <HttpMapping mapping={mapping} register={register} />
  if (dest.mappingKind === 'sheets') return <SheetsMapping mapping={mapping} register={register} />
  if (dest.mappingKind === 'slack')
    return (
      <div className="space-y-3">
        <Field label="Message" help="The Slack/Teams message. Insert {{tokens}} from the panel.">
          <Textarea
            name="map-text"
            rows={4}
            defaultValue={String(mapping.text ?? '')}
            onFocus={register}
            placeholder="🚨 New {{type}} — {{title}} ({{reference}})\n{{url}}"
          />
        </Field>
        <Field
          label="Blocks JSON (Slack, optional)"
          help="Slack Block Kit array. Overrides the plain message; one rich message per item. Leave blank for plain text."
        >
          <Textarea
            name="map-blocks"
            rows={4}
            className="font-mono text-xs"
            defaultValue={String(mapping.blocks ?? '')}
            onFocus={register}
            placeholder={'[{"type":"section","text":{"type":"mrkdwn","text":"*{{title}}*"}}]'}
          />
        </Field>
      </div>
    )
  // email
  return (
    <Field
      label="Email body (HTML)"
      help="Insert {{tokens}} from the panel. Basic HTML is supported."
    >
      <Textarea
        name="map-body"
        rows={6}
        className="font-mono text-xs"
        defaultValue={String(mapping.body ?? '')}
        onFocus={register}
        placeholder="<p>A new {{type}} was reported: <b>{{title}}</b></p>\n<p>{{url}}</p>"
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
        <Field label="Target table" required>
          <Input
            name="map-table"
            defaultValue={String(mapping.table ?? '')}
            placeholder="timesheet"
          />
        </Field>
        <Field
          label="Identity column"
          help="Set to enable idempotent re-posting. Blank = always insert."
        >
          <Input
            name="map-idColumn"
            defaultValue={String(mapping.idColumn ?? '')}
            placeholder="id"
          />
        </Field>
        <Field label="Row granularity">
          <Select name="map-mode" defaultValue={mapping.mode === 'weekly' ? 'weekly' : 'row'}>
            <option value="row">One row per item</option>
            <option value="weekly">One row per item per ISO week (day1–7 hours)</option>
          </Select>
        </Field>
        <Field
          label="Require token (skip if empty)"
          help="e.g. externalEmployeeId — items missing it are skipped."
        >
          <Input
            name="map-requireField"
            defaultValue={String(mapping.requireField ?? '')}
            placeholder="externalEmployeeId"
            onFocus={register}
          />
        </Field>
      </div>

      <Field
        label="Department map"
        help='One per line: "Department name = external id". Resolves {{department}}.'
      >
        <Textarea
          name="map-departmentMap"
          rows={2}
          className="font-mono text-xs"
          defaultValue={String(mapping.departmentMap ?? '')}
          placeholder={'Field Ops = 1\nOffice = 2'}
        />
      </Field>

      <div className="space-y-2">
        <Label>Column mapping</Label>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          External column ← value. Use a literal (2551, null) or insert a {'{{token}}'}.
        </p>
        <RowList
          rows={rows}
          setRows={setRows}
          render={(r) => (
            <>
              <Input
                name="col-name"
                defaultValue={r.name}
                placeholder="column"
                className="sm:w-40"
              />
              <Input
                name="col-val"
                defaultValue={r.val}
                placeholder="value or {{token}}"
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
  const h0 = Object.entries((mapping.headers as Record<string, string>) ?? {}).map(([k, v]) => ({
    id: nextId(),
    name: k,
    val: String(v),
  }))
  const [rows, setRows] = useState(h0)

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Extra headers</Label>
        <RowList
          rows={rows}
          setRows={setRows}
          render={(r) => (
            <>
              <Input
                name="hdr-key"
                defaultValue={r.name}
                placeholder="X-Header"
                className="sm:w-44"
              />
              <Input
                name="hdr-val"
                defaultValue={r.val}
                placeholder="value or {{token}}"
                onFocus={register}
                className="flex-1"
              />
            </>
          )}
          addLabel="Add header"
        />
      </div>
      <Field label="Request body" help="The body sent per item. Insert {{tokens}}.">
        <Textarea
          name="map-body"
          rows={7}
          className="font-mono text-xs"
          defaultValue={String(mapping.body ?? '')}
          onFocus={register}
          placeholder={'{\n  "title": "{{title}}",\n  "reference": "{{reference}}"\n}'}
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
  const v0 = (Array.isArray(mapping.values) ? (mapping.values as unknown[]) : []).map((v) => ({
    id: nextId(),
    name: '',
    val: v == null ? '' : String(v),
  }))
  const [rows, setRows] = useState(v0.length ? v0 : [{ id: nextId(), name: '', val: '' }])
  return (
    <div className="space-y-2">
      <Label>Row cells (left → right)</Label>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Each entry is one cell, in order. Literal or {'{{token}}'}.
      </p>
      <RowList
        rows={rows}
        setRows={setRows}
        render={(r) => (
          <Input
            name="val-expr"
            defaultValue={r.val}
            placeholder="value or {{token}}"
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
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2">
          {render(r)}
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            title="Remove"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { id: nextId(), name: '', val: '' }])}
        className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400"
      >
        <Plus size={14} /> {addLabel}
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
  if (!trigger) {
    return (
      <aside className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Pick a trigger to see the fields you can insert.
      </aside>
    )
  }
  return (
    <aside className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Insert a field</p>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Click into a value, then a field to insert its {'{{token}}'}.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {trigger.fields.map((fd: FieldDef) => (
          <button
            key={fd.key}
            type="button"
            onClick={() => onInsert(fd.key)}
            title={`{{${fd.key}}}`}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-teal-600"
          >
            {fd.label}
          </button>
        ))}
      </div>
      {trigger.dynamicFieldsNote ? (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {trigger.dynamicFieldsNote}
        </p>
      ) : null}
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
          {step}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="pl-8">{children}</div>
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
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
      {help ? <p className="text-xs text-slate-400 dark:text-slate-500">{help}</p> : null}
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
  const v = value == null ? '' : String(value)
  return (
    <div className={cn('space-y-1.5', field.type === 'textarea' && 'sm:col-span-2')}>
      <Label htmlFor={field.key}>
        {field.label}
        {field.required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {field.type === 'textarea' ? (
        <Textarea
          id={field.key}
          name={field.key}
          rows={4}
          defaultValue={v}
          placeholder={field.placeholder}
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
          placeholder={field.placeholder}
          onFocus={onFocus}
        />
      )}
      {field.help ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{field.help}</p>
      ) : null}
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
      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
    </label>
  )
}
