type UploadKind = 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
])
const SIGNATURE_TYPES = new Set(['image/png', 'image/jpeg'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
])
const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain',
  'text/csv',
])
const ACTIVE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
])

function typeOf(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

export function uploadContentTypeError(kind: UploadKind, contentType: string): string | null {
  const type = typeOf(contentType)
  if (!type || ACTIVE_CONTENT_TYPES.has(type)) return 'This file type is not allowed'
  if (kind === 'image' && !IMAGE_TYPES.has(type)) return 'Image type is not supported'
  if (kind === 'signature' && !SIGNATURE_TYPES.has(type)) return 'Signature must be PNG or JPEG'
  if (kind === 'video' && !VIDEO_TYPES.has(type)) return 'Video type is not supported'
  if (kind === 'audio' && !AUDIO_TYPES.has(type)) return 'Audio type is not supported'
  if (kind === 'document' && !DOCUMENT_TYPES.has(type)) return 'Document type is not supported'
  return null
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function isIsoBaseMedia(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp'
}

export function uploadedFileHeaderError(
  kind: UploadKind,
  contentType: string,
  bytes: Uint8Array,
): string | null {
  const type = typeOf(contentType)
  let valid = true
  if (type === 'image/png')
    valid = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  else if (type === 'image/jpeg') valid = startsWith(bytes, [0xff, 0xd8, 0xff])
  else if (type === 'image/gif')
    valid = ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a'
  else if (type === 'image/webp')
    valid = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
  else if (type === 'image/heic' || type === 'image/heif' || type === 'image/avif')
    valid = isIsoBaseMedia(bytes)
  else if (type === 'application/pdf') valid = ascii(bytes, 0, 5) === '%PDF-'
  else if (type.includes('openxmlformats') || type.includes('opendocument')) {
    valid = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
  } else if (type === 'application/msword' || type.startsWith('application/vnd.ms-')) {
    valid = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  } else if (type === 'video/mp4' || type === 'video/quicktime' || type === 'audio/mp4') {
    valid = isIsoBaseMedia(bytes)
  } else if (type === 'video/webm' || type === 'audio/webm') {
    valid = startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])
  } else if (type === 'audio/wav' || type === 'audio/x-wav') {
    valid = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE'
  } else if (type === 'audio/ogg') valid = ascii(bytes, 0, 4) === 'OggS'
  else if (type === 'audio/mpeg') {
    valid = ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  } else if (type === 'text/plain' || type === 'text/csv') {
    valid = !bytes.includes(0)
  }
  return valid
    ? null
    : `${kind[0]!.toUpperCase()}${kind.slice(1)} bytes do not match the declared file type`
}

export function uploadContentDisposition(
  kind: UploadKind,
  contentType: string,
): 'inline' | 'attachment' {
  const type = typeOf(contentType)
  return kind === 'image' ||
    kind === 'signature' ||
    kind === 'video' ||
    kind === 'audio' ||
    type === 'application/pdf'
    ? 'inline'
    : 'attachment'
}
