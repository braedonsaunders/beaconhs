import { describe, expect, it } from 'vitest'
import { RecordEditRejection } from '@/lib/record-sync/edits'
import { journalAuditFields, journalFieldRules } from './_record-edits'
import { canonicalJournalTags } from './_tag-policy'

const SITE = '7b0f8f6e-3f1c-4c55-9d3a-0c1f8a7f2b11'

describe('journal record saver field rules', () => {
  it('sanitizes the body and refuses non-text or oversized content', () => {
    expect(journalFieldRules.bodyHtml('<p onclick="x()">Hi</p><script>bad()</script>')).toBe(
      '<p>Hi</p>',
    )
    expect(() => journalFieldRules.bodyHtml(42)).toThrow(RecordEditRejection)
    expect(() => journalFieldRules.bodyHtml('x'.repeat(1_000_001))).toThrow(
      'Journal content is invalid or too large.',
    )
  })

  it('accepts only real calendar dates', () => {
    expect(journalFieldRules.entryDate('2026-02-28')).toBe('2026-02-28')
    for (const invalid of ['2026-02-30', '2026-2-3', '', null]) {
      expect(() => journalFieldRules.entryDate(invalid)).toThrow('Invalid journal date.')
    }
  })

  it('keeps the log type to worker or supervisor', () => {
    expect(journalFieldRules.definition('supervisor')).toBe('supervisor')
    expect(() => journalFieldRules.definition('manager')).toThrow('Invalid journal definition.')
  })

  it('clears location and supervisor on blank and refuses malformed ids', () => {
    expect(journalFieldRules.siteOrgUnitId('')).toBeNull()
    expect(journalFieldRules.siteOrgUnitId(SITE)).toBe(SITE)
    expect(() => journalFieldRules.siteOrgUnitId('site-1')).toThrow('Invalid site.')
    expect(journalFieldRules.supervisorPersonId(null)).toBeNull()
    expect(() => journalFieldRules.supervisorPersonId(7)).toThrow('Invalid supervisor.')
  })

  it('normalizes tags into the canonical order the page sends', () => {
    expect(journalFieldRules.tags(['Traffic', ' concrete ', 'traffic'])).toEqual([
      'concrete',
      'traffic',
    ])
    expect(canonicalJournalTags(['zeta', 'alpha-b', 'alpha'])).toEqual(['alpha', 'alpha-b', 'zeta'])
    expect(() => journalFieldRules.tags('concrete')).toThrow('Invalid journal tags.')
  })

  it('audits the columns each autosaved field writes', () => {
    expect(journalAuditFields([{ op: 'bodyHtml' }, { op: 'entryDate' }, { op: 'tags' }])).toEqual([
      'bodyHtml',
      'bodyText',
      'entryDate',
      'tagsCache',
    ])
  })
})
