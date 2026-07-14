import { describe, expect, it } from 'vitest'
import { MAX_PPTX_FILE_BYTES, PPTX_MIME_TYPE } from '@beaconhs/office/limits'
import { assertTrainingPptxAttachment } from './training-pptx-policy'

describe('training PowerPoint attachment policy', () => {
  const valid = {
    kind: 'document',
    contentType: PPTX_MIME_TYPE,
    sizeBytes: MAX_PPTX_FILE_BYTES,
  }

  it('accepts a bounded PPTX document attachment', () => {
    expect(() => assertTrainingPptxAttachment(valid)).not.toThrow()
  })

  it.each([
    { ...valid, kind: 'other' },
    { ...valid, contentType: 'application/vnd.ms-powerpoint' },
    { ...valid, sizeBytes: 0 },
    { ...valid, sizeBytes: MAX_PPTX_FILE_BYTES + 1 },
  ])('rejects an unsafe attachment: %o', (attachment) => {
    expect(() => assertTrainingPptxAttachment(attachment)).toThrow()
  })
})
