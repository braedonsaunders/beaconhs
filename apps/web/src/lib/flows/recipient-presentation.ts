import type { EmailTarget } from '@beaconhs/forms-core'

export type RecipientOptions = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
  personGroups: { id: string; name: string }[]
  contacts: { id: string; name: string; orgUnitName: string; email: string | null }[]
  obligations: { id: string; name: string }[]
  spreadsheetTemplates: { id: string; name: string }[]
}

/** Recipient predicates are part of the shared delivery engine, independent of subject/channel. */
export function recipientPresentation(
  target: EmailTarget,
  options: RecipientOptions,
  fields: { id: string; label: string }[],
  format: (source: string, values: Record<string, string>) => string = (source, values) =>
    source.replace(/\{value\d+\}/g, (token) => values[token.slice(1, -1)] ?? token),
): { label: string; condition: string | null; configured: boolean } {
  const message = (source: string, values: Record<string, string> = {}) => format(source, values)
  const field = (key: string) => fields.find((item) => item.id === key)?.label ?? key
  const person = (id: string) => options.people.find((item) => item.id === id)?.name ?? id
  const group = (id: string) => options.personGroups.find((item) => item.id === id)?.name ?? id
  switch (target.type) {
    case 'org_unit_contact': {
      const contact = options.contacts.find((item) => item.id === target.contactId)
      return {
        label: contact
          ? [contact.name, contact.email].filter(Boolean).join(' · ')
          : target.contactId || message('Choose a contact'),
        condition: message('{value0} = {value1}', {
          value0: field(target.orgUnitField) || message('Choose a field'),
          value1: contact?.orgUnitName ?? message('Contact location unavailable'),
        }),
        configured: Boolean(target.contactId && target.orgUnitField),
      }
    }
    case 'compliance_recipient':
      return {
        label:
          target.recipient.type === 'person'
            ? person(target.recipient.personId) || message('Choose a person')
            : target.recipient.email || message('Enter an email address'),
        condition: message('{value0} is in the audience for {value1}', {
          value0: field(target.personField) || message('Choose a field'),
          value1:
            (options.obligations.find((item) => item.id === target.obligationId)?.name ??
              target.obligationId) ||
            message('Choose an assignment'),
        }),
        configured: Boolean(
          target.obligationId &&
          target.personField &&
          (target.recipient.type === 'person' ? target.recipient.personId : target.recipient.email),
        ),
      }
    case 'person_group_for_record_person':
      return {
        label: group(target.groupId) || message('Choose a group'),
        condition: message('Group member department matches {value0}', {
          value0: field(target.personField) || message('Choose a field'),
        }),
        configured: Boolean(target.groupId && target.personField),
      }
    case 'person':
      return {
        label: person(target.personId) || message('Choose a person'),
        condition: null,
        configured: Boolean(target.personId),
      }
    case 'literal':
      return {
        label: target.email || message('Enter an email address'),
        condition: null,
        configured: Boolean(target.email),
      }
    case 'role':
      return {
        label:
          (options.roles.find((item) => item.key === target.role)?.name ?? target.role) ||
          message('Choose a role'),
        condition: null,
        configured: Boolean(target.role),
      }
    case 'department_manager':
      return {
        label: message('{value0} — managers', {
          value0:
            (options.departments.find((item) => item.id === target.departmentId)?.name ??
              target.departmentId) ||
            message('Choose a department'),
        }),
        condition: null,
        configured: Boolean(target.departmentId),
      }
    case 'person_group':
      return {
        label: group(target.groupId) || message('Choose a group'),
        condition: null,
        configured: Boolean(target.groupId),
      }
    case 'field':
      return {
        label: message('Recipients from {value0}', {
          value0: field(target.field) || message('Choose a field'),
        }),
        condition: null,
        configured: Boolean(target.field),
      }
    case 'record_person_manager':
      return {
        label: message('Manager of {value0}', {
          value0: field(target.personField) || message('Choose a field'),
        }),
        condition: null,
        configured: Boolean(target.personField),
      }
    case 'submitter_manager':
      return { label: message("The submitter's manager"), condition: null, configured: true }
    case 'submitter':
      return { label: message('The submitter'), condition: null, configured: true }
  }
}
