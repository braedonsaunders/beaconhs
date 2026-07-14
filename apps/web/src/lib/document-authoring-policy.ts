import { DOCX_MIME_TYPE, MAX_DOCX_CONVERSION_BYTES } from '@beaconhs/office/limits'

export const MAX_DOCUMENT_VERSION_NOTE_CHARS = 4_000

export type DocumentMasterMetadata = {
  kind: string
  contentType: string
  sizeBytes: number
  filename: string
}

export function documentMasterMetadataError(metadata: DocumentMasterMetadata): string | null {
  if (
    metadata.kind !== 'document' ||
    metadata.contentType !== DOCX_MIME_TYPE ||
    !metadata.filename.toLowerCase().endsWith('.docx')
  ) {
    return 'The working document must be a .docx Word file'
  }
  if (
    !Number.isSafeInteger(metadata.sizeBytes) ||
    metadata.sizeBytes <= 0 ||
    metadata.sizeBytes > MAX_DOCX_CONVERSION_BYTES
  ) {
    return 'The working document exceeds the 100 MB conversion limit'
  }
  return null
}
