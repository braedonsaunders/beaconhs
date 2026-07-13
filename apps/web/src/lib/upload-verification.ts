import { createHash, timingSafeEqual } from 'node:crypto'

type UploadObjectMetadata = {
  contentLength: number
  contentType: string | null
  metadata: Readonly<Record<string, string>>
}

export function hashUploadToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function normalizedContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

export function uploadTokenMatches(token: string | undefined, expectedHash: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(expectedHash)) return false
  const actual = Buffer.from(hashUploadToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function validateReservedUpload(
  object: UploadObjectMetadata,
  expected: { tokenHash: string; sizeBytes: number; contentType: string },
): string | null {
  if (!uploadTokenMatches(object.metadata['upload-token'], expected.tokenHash)) {
    return 'Uploaded object could not be verified'
  }
  if (object.contentLength !== expected.sizeBytes) {
    return 'Uploaded object size does not match the reservation'
  }
  if (normalizedContentType(object.contentType) !== normalizedContentType(expected.contentType)) {
    return 'Uploaded object type does not match the reservation'
  }
  return null
}
