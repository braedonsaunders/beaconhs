'use client'

// Upload a SignaturePad PNG data-url as a 'signature' attachment and return its
// id. Wraps the same presign → PUT → finalize flow the rest of the app uses for
// people / PPE / training signatures (see lib/uploads.ts) so the acknowledgment
// panel and the group sign-off sheet share one path. Throws on failure.

import { requestUpload, finalizeUpload } from './uploads'

function dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string } {
  const [meta, b64] = dataUrl.split(',')
  const contentType = meta?.match(/data:([^;]+)/)?.[1] ?? 'image/png'
  const bin = atob(b64 ?? '')
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return { blob: new Blob([arr], { type: contentType }), contentType }
}

/** Persist a signature data-url; resolves to the new attachment id. */
export async function uploadSignatureDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) throw new Error('Signature must be a PNG data URL')
  const { blob, contentType } = dataUrlToBlob(dataUrl)
  const filename = `signature-${Date.now()}.png`
  const req = await requestUpload({
    kind: 'signature',
    filename,
    contentType,
    sizeBytes: blob.size,
  })
  if (!req.ok) throw new Error(req.error)
  const put = await fetch(req.putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  })
  if (!put.ok) throw new Error(`Signature upload failed (${put.status})`)
  const fin = await finalizeUpload({
    kind: 'signature',
    key: req.key,
    filename,
    contentType,
    sizeBytes: blob.size,
  })
  if (!fin.ok) throw new Error(fin.error)
  return fin.attachmentId
}
