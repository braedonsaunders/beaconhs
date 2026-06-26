import { newAttachmentKey, publicUrl, putObject } from '@beaconhs/storage'

// Signatures were historically stored inline as base64 `data:` URLs in text
// columns (e.g. hazid_assessment_signatures.signature_data_url) — hundreds of MB
// of heap + backup bloat once a tenant accrues records. This moves the bytes to
// object storage (MinIO/R2) and keeps only a stable public URL in the column, so
// every read/render site (`<img src>`, PDF templates) keeps working unchanged: an
// https URL renders identically to a data URL.
//
// Wrap every signature WRITE in storeSignatureValue(). It is idempotent and
// defensive:
//   - empty / null            -> null
//   - already an http(s) URL  -> returned unchanged (already migrated)
//   - a data: URL             -> decoded, uploaded, returns the object's public URL
// so it is safe on create, update, and re-save without re-uploading.

const DATA_URL_RE = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s

export async function storeSignatureValue(
  tenantId: string,
  value: string | null | undefined,
): Promise<string | null> {
  const v = (value ?? '').trim()
  if (!v) return null
  if (!v.startsWith('data:')) return v // already a stored URL (or unexpected) — leave as-is

  const match = DATA_URL_RE.exec(v)
  if (!match) return v
  const contentType = match[1] || 'image/png'
  const body = Buffer.from(match[2] ?? '', 'base64')
  if (body.length === 0) return null

  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png'
  const key = newAttachmentKey({ tenantId, kind: 'signature', filename: `signature.${ext}` })
  await putObject({ key, body, contentType })
  return publicUrl(key)
}
