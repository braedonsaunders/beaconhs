import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_KEY_UNIQUE_CONSTRAINT,
  MAX_DOCUMENT_KEY_LENGTH,
  documentKeyFromTitle,
  isDocumentKeyConflict,
  parseDocumentKey,
} from './document-key-policy'

describe('document key policy', () => {
  it('canonicalizes a bounded explicit key without silently truncating it', () => {
    expect(parseDocumentKey('  SAFE Work / Practice 01  ')).toEqual({
      ok: true,
      key: 'safe-work-practice-01',
    })
    expect(parseDocumentKey('x'.repeat(MAX_DOCUMENT_KEY_LENGTH + 1))).toEqual({
      ok: false,
      error: 'Document key cannot exceed 120 characters.',
    })
    expect(parseDocumentKey('///')).toEqual({ ok: false, error: 'Document key is required.' })
  })

  it('bounds automatically derived keys and identifies only the live-key constraint', () => {
    expect(documentKeyFromTitle('x'.repeat(200))).toHaveLength(MAX_DOCUMENT_KEY_LENGTH)
    expect(
      isDocumentKeyConflict({ code: '23505', constraint: DOCUMENT_KEY_UNIQUE_CONSTRAINT }),
    ).toBe(true)
    expect(isDocumentKeyConflict({ code: '23505', constraint: 'another_constraint' })).toBe(false)
  })
})
