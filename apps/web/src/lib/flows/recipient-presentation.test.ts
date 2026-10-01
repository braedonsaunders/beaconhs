import { describe, expect, it } from 'vitest'
import { recipientPresentation, type RecipientOptions } from './recipient-presentation'
const options: RecipientOptions = {
  people: [{ id: 'worker', name: 'Worker' }],
  roles: [],
  departments: [],
  personGroups: [{ id: 'team', name: 'Safety team' }],
  contacts: [{ id: 'client', name: 'Client rep', orgUnitName: 'Site A', email: 'rep@example.com' }],
  obligations: [{ id: 'training', name: 'Training assignment' }],
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
          type: 'compliance_recipient',
          obligationId: 'training',
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
