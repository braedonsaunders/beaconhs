import { describe, expect, it } from 'vitest'
import { DOCX_MIME_TYPE, MAX_DOCX_CONVERSION_BYTES } from '@beaconhs/office/limits'
import { documentMasterMetadataError } from './document-authoring-policy'

const VALID = {
  kind: 'document',
  contentType: DOCX_MIME_TYPE,
  sizeBytes: MAX_DOCX_CONVERSION_BYTES,
  filename: 'Safety plan.DOCX',
}

describe('document authoring policy', () => {
  it('accepts a DOCX at the shared conversion ceiling', () => {
    expect(documentMasterMetadataError(VALID)).toBeNull()
  })

  it.each([
    { ...VALID, kind: 'other' },
    { ...VALID, contentType: 'application/msword' },
    { ...VALID, filename: 'Safety plan.doc' },
  ])('rejects a file that is not a canonical DOCX master', (metadata) => {
    expect(documentMasterMetadataError(metadata)).toMatch(/\.docx/)
  })

  it.each([
    { ...VALID, sizeBytes: 0 },
    { ...VALID, sizeBytes: MAX_DOCX_CONVERSION_BYTES + 1 },
    { ...VALID, sizeBytes: Number.NaN },
  ])('rejects an invalid or oversized master', (metadata) => {
    expect(documentMasterMetadataError(metadata)).toMatch(/100 MB/)
  })
})
