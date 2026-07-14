import { describe, expect, it } from 'vitest'
import {
  MULTIPART_UPLOAD_PART_SIZE_BYTES,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
  multipartPartCount,
  shouldUseMultipartUpload,
} from './multipart'

describe('multipart upload planning', () => {
  it('switches to multipart at the configured threshold', () => {
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES - 1)).toBe(false)
    expect(shouldUseMultipartUpload(MULTIPART_UPLOAD_THRESHOLD_BYTES)).toBe(true)
  })

  it('plans complete parts including the final partial part', () => {
    expect(multipartPartCount(MULTIPART_UPLOAD_PART_SIZE_BYTES)).toBe(1)
    expect(multipartPartCount(MULTIPART_UPLOAD_PART_SIZE_BYTES + 1)).toBe(2)
    expect(multipartPartCount(727_506_840)).toBe(11)
  })

  it('rejects invalid object and part sizes', () => {
    expect(() => multipartPartCount(0)).toThrow('positive integer')
    expect(() => multipartPartCount(10, 1024)).toThrow('at least 5 MiB')
  })
})
