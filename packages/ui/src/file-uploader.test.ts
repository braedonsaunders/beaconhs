import { describe, expect, it } from 'vitest'
import { MAX_PPTX_FILE_BYTES } from '@beaconhs/office/limits'
import { defaultMaxUploadBytes, formatUploadSizeLimit } from './upload-limits'

describe('file upload limits', () => {
  it('accepts document uploads through the shared 1 GiB PowerPoint ceiling', () => {
    expect(MAX_PPTX_FILE_BYTES).toBe(1024 * 1024 * 1024)
    expect(defaultMaxUploadBytes('document')).toBe(MAX_PPTX_FILE_BYTES)
    expect(formatUploadSizeLimit(MAX_PPTX_FILE_BYTES)).toBe('1 GiB')
  })

  it('keeps the other attachment ceilings unchanged and labels binary units accurately', () => {
    expect(defaultMaxUploadBytes('image')).toBe(50 * 1024 * 1024)
    expect(defaultMaxUploadBytes('signature')).toBe(10 * 1024 * 1024)
    expect(defaultMaxUploadBytes('audio')).toBe(200 * 1024 * 1024)
    expect(defaultMaxUploadBytes('video')).toBe(500 * 1024 * 1024)
    expect(defaultMaxUploadBytes('other')).toBe(500 * 1024 * 1024)
    expect(formatUploadSizeLimit(500 * 1024 * 1024)).toBe('500 MiB')
  })
})
