import { describe, expect, it } from 'vitest'
import {
  hashUploadToken,
  normalizedContentType,
  uploadTokenMatches,
  validateReservedUpload,
} from './upload-verification'

describe('upload reservation verification', () => {
  const token = 'one-time-upload-token'
  const tokenHash = hashUploadToken(token)
  const object = {
    contentLength: 42,
    contentType: 'image/png',
    metadata: { 'upload-token': token },
  }

  it('accepts only the exact token, size, and normalized content type', () => {
    expect(
      validateReservedUpload(object, {
        tokenHash,
        sizeBytes: 42,
        contentType: 'IMAGE/PNG; charset=binary',
      }),
    ).toBeNull()
    expect(normalizedContentType('IMAGE/PNG; charset=binary')).toBe('image/png')
  })

  it('rejects token substitution, size changes, and type changes', () => {
    expect(uploadTokenMatches('wrong', tokenHash)).toBe(false)
    expect(
      validateReservedUpload(
        { ...object, metadata: { 'upload-token': 'wrong' } },
        { tokenHash, sizeBytes: 42, contentType: 'image/png' },
      ),
    ).toMatch(/verified/)
    expect(
      validateReservedUpload(object, { tokenHash, sizeBytes: 41, contentType: 'image/png' }),
    ).toMatch(/size/)
    expect(
      validateReservedUpload(object, { tokenHash, sizeBytes: 42, contentType: 'image/jpeg' }),
    ).toMatch(/type/)
  })
})
