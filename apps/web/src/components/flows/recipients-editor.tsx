'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Input, Label, Select, SearchSelect } from '@beaconhs/ui'
import type { EmailTarget } from '@beaconhs/forms-core'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import { generatedMessageKey } from '@/i18n/generated-key'
import type { GeneratedMessageKey } from '@/i18n/generated'
import { recipientPresentation, type RecipientOptions } from '@/lib/flows/recipient-presentation'

const RECIPIENT_LABEL: Record<EmailTarget['type'], string> = {
  submitter: 'The submitter',
  submitter_manager: "The submitter's manager",
  record_person_manager: "The record person's manager",
  person: 'A specific person',
  role: 'Everyone in a role',
  department_manager: "A department's managers",
  person_group: 'A People group',
  literal: 'Specific email address(es)',
  field: 'A record field',
  person_group_for_record_person: "A People group in the record person's department",
  org_unit_contact: 'A contact for the record location',
  compliance_recipient: 'A recipient for a matching compliance assignment',
}

function defaultTarget(type: EmailTarget['type'], firstField: string): EmailTarget {
  switch (type) {
    case 'role':
      return { type: 'role', role: '' }
    case 'literal':
      return { type: 'literal', email: '' }
    case 'person':
      return { type: 'person', personId: '' }
    case 'department_manager':
      return { type: 'department_manager', departmentId: '' }
    case 'person_group':
      return { type: 'person_group', groupId: '' }
    case 'field':
      return { type: 'field', field: firstField }
    case 'person_group_for_record_person':
      return { type: 'person_group_for_record_person', groupId: '', personField: firstField }
    case 'record_person_manager':
      return { type: 'record_person_manager', personField: firstField }
    case 'org_unit_contact':
      return { type: 'org_unit_contact', contactId: '', orgUnitField: firstField }
    case 'compliance_recipient':
      return {
        type: 'compliance_recipient',
        obligationId: '',
        personField: firstField,
        recipient: { type: 'person', personId: '' },
      }
    case 'submitter_manager':
      return { type: 'submitter_manager' }
    default:
      return { type: 'submitter' }
  }
}

// Multi-recipient editor: any mix of submitter / person / manager / role /
// department managers / CSV emails / record field. Add + remove rows freely.
export function RecipientsEditor({
  to,
  onChange,
  readOnly,
  fieldIds,
  availableFields,
  options,
}: {
  to: EmailTarget[]
  onChange: (to: EmailTarget[]) => void
  readOnly: boolean
  fieldIds: string[]
  options: RecipientOptions
  availableFields: { id: string; label: string }[]
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const describe = (target: EmailTarget) =>
    recipientPresentation(
      target,
      options,
      availableFields.map((field) => ({ ...field, label: tGeneratedValue(field.label) })),
      (source, values) => tGenerated(generatedMessageKey(source) as GeneratedMessageKey, values),
    )
  const rows = to
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState({ always: 1, conditional: 1 })
  const fieldLabel = (key: string) =>
    availableFields.find((field) => field.id === key)?.label ?? key
  const update = (i: number, t: EmailTarget) => onChange(rows.map((x, j) => (j === i ? t : x)))
  const peopleOpts = options.people.map((p) => ({ value: p.id, label: p.name }))
  const deptOpts = options.departments.map((d) => ({ value: d.id, label: d.name }))
  const personGroupOpts = options.personGroups.map((g) => ({ value: g.id, label: g.name }))
  const contactOpts = options.contacts.map((contact) => ({
    value: contact.id,
    label: contact.name,
    hint: [contact.orgUnitName, contact.email].filter(Boolean).join(' · '),
  }))
  const obligationOpts = options.obligations.map((obligation) => ({
    value: obligation.id,
    label: obligation.name,
  }))
  const renderRow = (t: EmailTarget, i: number) => {
    const presentation = describe(t)
    return (
      <details
        key={i}
        open={!presentation.configured}
        className="space-y-1.5 rounded-md border border-slate-200 p-2 dark:border-slate-700"
      >
        <summary className="cursor-pointer text-sm font-medium text-slate-800 dark:text-slate-100">
          <GeneratedValue value={presentation.label} />
          {presentation.condition && (
            <span className="mt-1 block text-xs font-normal text-amber-700 dark:text-amber-400">
              <GeneratedValue value={presentation.condition} />
            </span>
          )}
        </summary>
        <div className="flex items-center gap-1.5">
          <Select
            value={t.type}
            disabled={readOnly}
            onChange={(e) =>
              update(i, defaultTarget(e.target.value as EmailTarget['type'], fieldIds[0] ?? ''))
            }
          >
            {(Object.keys(RECIPIENT_LABEL) as EmailTarget['type'][]).map((k) => (
              <option key={k} value={k}>
                {RECIPIENT_LABEL[k]}
              </option>
            ))}
          </Select>
          <GeneratedValue
            value={
              !readOnly ? (
                <button
                  type="button"
                  title={tGenerated('m_0d9b2e08c28452')}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                >
                  <X size={14} />
                </button>
              ) : null
            }
          />
        </div>
        <GeneratedValue
          value={
            t.type === 'person' ? (
              <SearchSelect
                value={t.personId}
                disabled={readOnly}
                options={peopleOpts}
                placeholder={tGenerated('m_0a302f85a5260b')}
                onChange={(v) => update(i, { type: 'person', personId: v })}
              />
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'record_person_manager' ? (
              <Select
                value={t.personField}
                disabled={readOnly}
                onChange={(event) =>
                  update(i, {
                    type: 'record_person_manager',
                    personField: event.target.value,
                  })
                }
              >
                {fieldIds.map((field) => (
                  <option key={field} value={field}>
                    {fieldLabel(field)}
                  </option>
                ))}
              </Select>
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'person_group_for_record_person' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <SearchSelect
                  value={t.groupId}
                  disabled={readOnly}
                  options={personGroupOpts}
                  placeholder={tGenerated('m_0ecfd22a8fb573')}
                  onChange={(groupId) => update(i, { ...t, groupId })}
                />
                <Select
                  value={t.personField}
                  disabled={readOnly}
                  onChange={(event) => update(i, { ...t, personField: event.target.value })}
                >
                  {fieldIds.map((field) => (
                    <option key={field} value={field}>
                      {fieldLabel(field)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'org_unit_contact' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <SearchSelect
                  value={t.contactId}
                  disabled={readOnly}
                  options={contactOpts}
                  placeholder={tGenerated('m_15593bf256f963')}
                  onChange={(contactId) => update(i, { ...t, contactId })}
                />
                <Select
                  value={t.orgUnitField}
                  disabled={readOnly}
                  onChange={(event) => update(i, { ...t, orgUnitField: event.target.value })}
                >
                  {fieldIds.map((field) => (
                    <option key={field} value={field}>
                      {fieldLabel(field)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'compliance_recipient' ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <SearchSelect
                    value={t.obligationId}
                    disabled={readOnly}
                    options={obligationOpts}
                    placeholder={tGenerated('m_1f1c58a54a4d66')}
                    onChange={(obligationId) => update(i, { ...t, obligationId })}
                  />
                  <Select
                    value={t.personField}
                    disabled={readOnly}
                    onChange={(event) => update(i, { ...t, personField: event.target.value })}
                  >
                    {fieldIds.map((field) => (
                      <option key={field} value={field}>
                        {fieldLabel(field)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={t.recipient.type}
                    disabled={readOnly}
                    onChange={(event) =>
                      update(i, {
                        ...t,
                        recipient:
                          event.target.value === 'literal'
                            ? { type: 'literal', email: '' }
                            : { type: 'person', personId: '' },
                      })
                    }
                  >
                    <option value="person">
                      <GeneratedValue value="A specific person" />
                    </option>
                    <option value="literal">
                      <GeneratedValue value="Specific email address(es)" />
                    </option>
                  </Select>
                  {t.recipient.type === 'person' ? (
                    <SearchSelect
                      value={t.recipient.personId}
                      disabled={readOnly}
                      options={peopleOpts}
                      placeholder={tGenerated('m_0e6e22a9a495b0')}
                      onChange={(personId) =>
                        update(i, { ...t, recipient: { type: 'person', personId } })
                      }
                    />
                  ) : (
                    <Input
                      value={t.recipient.email}
                      disabled={readOnly}
                      placeholder={tGeneratedValue('name@example.com')}
                      onChange={(event) =>
                        update(i, {
                          ...t,
                          recipient: { type: 'literal', email: event.target.value },
                        })
                      }
                    />
                  )}
                </div>
              </div>
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'department_manager' ? (
              <SearchSelect
                value={t.departmentId}
                disabled={readOnly}
                options={deptOpts}
                placeholder={tGenerated('m_1a73ab43e2b5d2')}
                onChange={(v) => update(i, { type: 'department_manager', departmentId: v })}
              />
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'person_group' ? (
              <SearchSelect
                value={t.groupId}
                disabled={readOnly}
                options={personGroupOpts}
                placeholder={tGenerated('m_0b6591278bf814')}
                onChange={(v) => update(i, { type: 'person_group', groupId: v })}
              />
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'role' ? (
              options.roles.length > 0 ? (
                <Select
                  value={t.role}
                  disabled={readOnly}
                  onChange={(e) => update(i, { type: 'role', role: e.target.value })}
                >
                  <option value="">{'— choose a role —'}</option>
                  {options.roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={t.role}
                  disabled={readOnly}
                  placeholder={tGenerated('m_1f114a74597cfb')}
                  onChange={(e) => update(i, { type: 'role', role: e.target.value })}
                />
              )
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'literal' ? (
              <Input
                value={t.email}
                disabled={readOnly}
                placeholder={tGenerated('m_05b63ccf241fff')}
                onChange={(e) => update(i, { type: 'literal', email: e.target.value })}
              />
            ) : null
          }
        />
        <GeneratedValue
          value={
            t.type === 'field' ? (
              <Select
                value={t.field}
                disabled={readOnly}
                onChange={(e) => update(i, { type: 'field', field: e.target.value })}
              >
                {fieldIds.map((f) => (
                  <option key={f} value={f}>
                    {fieldLabel(f)}
                  </option>
                ))}
              </Select>
            ) : null
          }
        />
      </details>
    )
  }
  return (
    <div className="space-y-2">
      <Label>{tGenerated('m_0d99b2b56f8b5d')}</Label>
      <div className="space-y-4">
        <Input
          aria-label={tGeneratedValue('Search recipients or conditions')}
          placeholder={tGeneratedValue('Search recipients or conditions')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPages({ always: 1, conditional: 1 })
          }}
        />
        {(['always', 'conditional'] as const).map((kind) => {
          const all = rows
            .map((target, index) => ({ target, index, presentation: describe(target) }))
            .filter((row) => Boolean(row.presentation.condition) === (kind === 'conditional'))
          const matched = all.filter((row) =>
            `${row.presentation.label} ${row.presentation.condition ?? ''}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
          )
          const pageCount = Math.max(1, Math.ceil(matched.length / 10))
          const page = Math.min(pages[kind], pageCount)
          return (
            <section
              key={kind}
              className="space-y-2"
              aria-label={tGeneratedValue(
                kind === 'always' ? 'Always included' : 'Conditional recipients',
              )}
            >
              <h3 className="text-sm font-semibold">
                <GeneratedValue
                  value={kind === 'always' ? 'Always included' : 'Conditional recipients'}
                />{' '}
                <span className="text-slate-500">({all.length})</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedValue
                  value={
                    kind === 'always'
                      ? 'Included whenever this message action runs. Flow conditions still apply.'
                      : 'Included only when the condition shown on their row matches the record.'
                  }
                />
              </p>
              {matched
                .slice((page - 1) * 10, page * 10)
                .map(({ target, index }) => renderRow(target, index))}
              {matched.length === 0 && (
                <p className="text-xs text-slate-500">
                  <GeneratedValue
                    value={search ? 'No matching recipients.' : 'No recipients in this group.'}
                  />
                </p>
              )}
              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPages((value) => ({ ...value, [kind]: page - 1 }))}
                  >
                    <GeneratedValue value="Previous" />
                  </Button>
                  <span className="text-xs">
                    {page} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page >= pageCount}
                    onClick={() => setPages((value) => ({ ...value, [kind]: page + 1 }))}
                  >
                    <GeneratedValue value="Next" />
                  </Button>
                </div>
              )}
            </section>
          )
        })}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch('')
              setPages((value) => ({
                ...value,
                always: Math.ceil(
                  (rows.filter((target) => !describe(target).condition).length + 1) / 10,
                ),
              }))
              onChange([...rows, { type: 'person', personId: '' }])
            }}
          >
            <Plus size={13} /> <GeneratedText id="m_09417c94b44711" />
          </Button>
        )}
      </div>
    </div>
  )
}
