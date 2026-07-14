import { describe, expect, it } from 'vitest'
import {
  DOCX_MIME_TYPE,
  MAX_DOCX_CONVERSION_BYTES,
  MAX_PPTX_FILE_BYTES,
  PPTX_MIME_TYPE,
} from './limits'

describe('office conversion contract', () => {
  it('keeps media-specific producer and converter ceilings explicit', () => {
    expect(MAX_DOCX_CONVERSION_BYTES).toBe(100 * 1024 * 1024)
    expect(MAX_PPTX_FILE_BYTES).toBe(1024 * 1024 * 1024)
  })

  it('uses the canonical OOXML media types', () => {
    expect(DOCX_MIME_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(PPTX_MIME_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
  })
})
