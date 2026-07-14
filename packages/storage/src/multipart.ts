export const MULTIPART_UPLOAD_THRESHOLD_BYTES = 256 * 1024 * 1024
export const MULTIPART_UPLOAD_PART_SIZE_BYTES = 64 * 1024 * 1024

export function shouldUseMultipartUpload(sizeBytes: number): boolean {
  return sizeBytes >= MULTIPART_UPLOAD_THRESHOLD_BYTES
}

export function multipartPartCount(
  sizeBytes: number,
  partSizeBytes = MULTIPART_UPLOAD_PART_SIZE_BYTES,
): number {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Multipart object size must be a positive integer')
  }
  if (!Number.isInteger(partSizeBytes) || partSizeBytes < 5 * 1024 * 1024) {
    throw new Error('Multipart part size must be an integer of at least 5 MiB')
  }
  return Math.ceil(sizeBytes / partSizeBytes)
}
