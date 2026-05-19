// S3-compatible storage (Cloudflare R2 in prod, MinIO in dev).
// Same code path either way — only the endpoint changes.

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const accountId = process.env.R2_ACCOUNT_ID ?? 'local'
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? 'beaconhs'
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? 'beaconhs-dev-secret'
const bucket = process.env.R2_BUCKET ?? 'beaconhs-dev'
const publicBaseUrl = process.env.R2_PUBLIC_URL ?? 'http://localhost:9000/beaconhs-dev'

// In dev we point at MinIO. R2 uses https://{account}.r2.cloudflarestorage.com.
const endpoint =
  process.env.R2_ENDPOINT ??
  (accountId === 'local'
    ? 'http://localhost:9000'
    : `https://${accountId}.r2.cloudflarestorage.com`)

const client = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
})

export const BUCKET = bucket

export async function presignPut(args: {
  key: string
  contentType: string
  expiresInSeconds?: number
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: args.key,
    ContentType: args.contentType,
  })
  return getSignedUrl(client, cmd, { expiresIn: args.expiresInSeconds ?? 300 })
}

export async function presignGet(args: {
  key: string
  expiresInSeconds?: number
}): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: args.key })
  return getSignedUrl(client, cmd, { expiresIn: args.expiresInSeconds ?? 600 })
}

export function publicUrl(key: string): string {
  return `${publicBaseUrl}/${key}`
}

export function newAttachmentKey(args: {
  tenantId: string
  kind: 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'
  filename: string
}): string {
  const safe = args.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const stamp = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `t/${args.tenantId}/${args.kind}/${stamp}-${rand}-${safe}`
}

export { client as s3Client }
