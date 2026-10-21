import { describe, expect, it } from 'vitest'
import {
  matchingAudienceSource,
  recipientPresentation,
  type RecipientOptions,
} from './recipient-presentation'
const options: RecipientOptions = {
  people: [{ id: 'worker', name: 'Worker' }],
  roles: [],
  departments: [],
  personGroups: [{ id: 'team', name: 'Safety team' }],
  contacts: [{ id: 'client', name: 'Client rep', orgUnitName: 'Site A', email: 'rep@example.com' }],
  obligations: [
    {
      id: 'training',
      name: 'Training assignment',
      workerType: 'employee',
      audience: [{ kind: 'person', entityKey: 'worker' }],
    },
  ],
  spreadsheetTemplates: [],
}
const fields = [
  { id: 'where', label: 'Location' },
  { id: 'who', label: 'Employee' },
]
describe('shared flow recipient presentation', () => {
  it('shows a location condition separately from an unconditional person', () => {
    expect(
      recipientPresentation(
        { type: 'org_unit_contact', contactId: 'client', orgUnitField: 'where' },
        options,
        fields,
      ),
    ).toEqual({
      label: 'Client rep · rep@example.com',
      condition: 'Location = Site A',
      configured: true,
    })
    expect(
      recipientPresentation({ type: 'person', personId: 'worker' }, options, fields).condition,
    ).toBeNull()
  })
  it('recognizes assignment and department conditions for every subject', () => {
    expect(
      recipientPresentation(
        {
          type: 'audience_recipient',
          audienceName: 'Training assignment',
          workerType: 'employee',
          audience: [{ kind: 'person', entityKey: 'worker' }],
          personField: 'who',
          recipient: { type: 'person', personId: 'worker' },
        },
        options,
        fields,
      ).condition,
    ).toBe('Employee is in the audience for Training assignment')
    expect(
      recipientPresentation(
        { type: 'person_group_for_record_person', groupId: 'team', personField: 'who' },
        options,
        fields,
      ).condition,
    ).toContain('department matches Employee')
  })
  it('keeps unresolved contacts conditional and preserves the configured targets', () => {
    const target = {
      type: 'org_unit_contact',
      contactId: 'removed',
      orgUnitField: 'where',
    } as const
    const before = structuredClone(target)
    expect(recipientPresentation(target, options, fields).condition).toBe(
      'Location = Contact location unavailable',
    )
    expect(target).toEqual(before)
    expect(recipientPresentation({ type: 'literal', email: '' }, options, fields).configured).toBe(
      false,
    )
  })
})

it('recognizes a saved audience after JSONB reorders properties and rejects a broadened source', () => {
  const target = {
    type: 'audience_recipient',
    audienceName: 'Training assignment',
    workerType: 'employee',
    audience: [{ excluded: false, entityKey: 'worker', kind: 'person' }],
    personField: 'who',
    recipient: { type: 'person', personId: 'worker' },
  } as const
  const mutable = { ...target, audience: target.audience.map((row) => ({ ...row })) }
  expect(matchingAudienceSource(mutable, options.obligations)).toBe('training')
  expect(
    matchingAudienceSource(mutable, [
      { ...options.obligations[0]!, audience: [{ kind: 'everyone', entityKey: '' }] },
    ]),
  ).toBe('')
})
