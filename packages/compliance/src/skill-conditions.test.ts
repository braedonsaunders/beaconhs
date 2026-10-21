import { describe, expect, it } from 'vitest'
import { effectiveSkillFieldValue, skillFieldMatches, type SkillField } from './skill-conditions'
const definition: SkillField = {
  id: 'position',
  fieldKey: 'Position',
  fieldValue: null,
  valueMode: 'record',
  authorityId: 'authority',
  skillTypeId: null,
  skillAssignmentId: null,
}
const both = { fieldId: 'position', operator: 'contains_all' as const, values: ['F', 'H'] }
describe('qualification field conditions', () => {
  it('requires both F and H as full tokens across existing slash and comma encodings', () => {
    expect(skillFieldMatches('F/H/V/O', both)).toBe(true)
    expect(skillFieldMatches('F,H,V,O', both)).toBe(true)
    expect(skillFieldMatches('F', both)).toBe(false)
    expect(skillFieldMatches('FH', both)).toBe(false)
    expect(skillFieldMatches(null, both)).toBe(false)
  })
  it('supports exact values and any-token conditions without substring matches', () => {
    expect(
      skillFieldMatches(' SMAW-CS ', {
        fieldId: 'process',
        operator: 'equals',
        values: ['smaw-cs'],
      }),
    ).toBe(true)
    expect(
      skillFieldMatches('F/H', { ...both, operator: 'contains_any', values: ['O', 'H'] }),
    ).toBe(true)
  })
  it('uses the effective type value before authority and ignores stale record answers for type constants', () => {
    const answer = {
      ...definition,
      id: 'answer',
      authorityId: null,
      skillAssignmentId: 'ticket',
      fieldValue: 'F',
    }
    const constant = {
      ...definition,
      id: 'constant',
      authorityId: null,
      skillTypeId: 'type',
      valueMode: 'type' as const,
      fieldValue: 'F/H',
    }
    expect(effectiveSkillFieldValue(definition, [definition, answer], 'type', 'ticket')).toBe('F')
    expect(
      effectiveSkillFieldValue(definition, [definition, answer, constant], 'type', 'ticket'),
    ).toBe('F/H')
    expect(effectiveSkillFieldValue(definition, [definition], 'type', 'ticket')).toBeNull()
  })
})
