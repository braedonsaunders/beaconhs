import { describe, expect, it } from 'vitest'
import {
  uploadContentDisposition,
  uploadContentTypeError,
  uploadedFileHeaderError,
} from './upload-policy'

describe('upload policy', () => {
  it('blocks browser-executable content and cross-kind claims', () => {
    expect(uploadContentTypeError('image', 'image/svg+xml')).toMatch(/not allowed/)
    expect(uploadContentTypeError('image', 'text/html')).toMatch(/not allowed/)
    expect(uploadContentTypeError('signature', 'image/webp')).toMatch(/PNG or JPEG/)
    expect(uploadContentTypeError('document', 'application/pdf')).toBeNull()
  })

  it('checks magic bytes for inline-safe formats', () => {
    expect(
      uploadedFileHeaderError(
        'image',
        'image/png',
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBeNull()
    expect(
      uploadedFileHeaderError('image', 'image/png', new TextEncoder().encode('<html>')),
    ).toMatch(/do not match/)
    expect(
      uploadedFileHeaderError('document', 'application/pdf', new TextEncoder().encode('%PDF-1.7')),
    ).toBeNull()
  })

  it('forces active or unknown downloads to attachment disposition', () => {
    expect(uploadContentDisposition('image', 'image/png')).toBe('inline')
    expect(uploadContentDisposition('signature', 'image/png')).toBe('inline')
    expect(uploadContentDisposition('document', 'application/pdf')).toBe('inline')
    expect(uploadContentDisposition('other', 'application/octet-stream')).toBe('attachment')
  })
})
