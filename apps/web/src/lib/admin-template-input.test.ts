import { describe, expect, it } from 'vitest'
import {
  ADMIN_TEMPLATE_INPUT_LIMITS,
  isBoundedTemplateSubjectKey,
  normalizeTemplateDescription,
  normalizeTemplateName,
  normalizeTemplateSubject,
  normalizeTemplateTestRecipient,
} from './admin-template-input'

describe('admin template input', () => {
  it('normalizes bounded names and rejects empty or oversized input', () => {
    expect(normalizeTemplateName('  Incident notice  ')).toBe('Incident notice')
    expect(normalizeTemplateName('   ')).toBeNull()
    expect(normalizeTemplateName('x'.repeat(ADMIN_TEMPLATE_INPUT_LIMITS.nameChars + 1))).toBeNull()
    expect(normalizeTemplateName(new File([], 'name'))).toBeNull()
  })

  it('distinguishes an empty description from an invalid oversized description', () => {
    expect(normalizeTemplateDescription('  ')).toBeNull()
    expect(normalizeTemplateDescription('  Internal notice  ')).toBe('Internal notice')
    expect(
      normalizeTemplateDescription('x'.repeat(ADMIN_TEMPLATE_INPUT_LIMITS.descriptionChars + 1)),
    ).toBeUndefined()
  })

  it('normalizes transport-safe subjects and rejects line-ceiling violations', () => {
    expect(normalizeTemplateSubject('  Alert\r\nfor {{site}}  ')).toBe('Alert for {{site}}')
    expect(normalizeTemplateSubject('x'.repeat(999))).toBeNull()
  })

  it('uses the provider-compatible mailbox validator for test sends', () => {
    expect(normalizeTemplateTestRecipient(' safety+test@example.com ')).toBe(
      'safety+test@example.com',
    )
    expect(normalizeTemplateTestRecipient('not-an-address@')).toBeNull()
    expect(normalizeTemplateTestRecipient('victim@example.com\r\nBcc:other@example.com')).toBeNull()
  })

  it('bounds persisted subject identifiers before database lookup', () => {
    expect(isBoundedTemplateSubjectKey('incidents')).toBe(true)
    expect(isBoundedTemplateSubjectKey('')).toBe(false)
    expect(
      isBoundedTemplateSubjectKey('x'.repeat(ADMIN_TEMPLATE_INPUT_LIMITS.subjectKeyChars + 1)),
    ).toBe(false)
  })
})
