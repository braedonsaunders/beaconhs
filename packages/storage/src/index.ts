// S3-compatible storage (Cloudflare R2 in prod, MinIO in dev).
// Same code path either way — only the endpoint changes.

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
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

// R2 exposes objects through a public bucket / custom domain configured in the
// dashboard — never via a bucket policy. Every other S3 backend this app runs
// against (MinIO in dev) must be anonymous-read, because the app links to
// objects directly with publicUrl() everywhere (inline <img>, file links, …).
const isR2 = endpoint.includes('r2.cloudflarestorage.com')

/** Idempotently ensure the bucket exists (used in dev/MinIO + by the migration). */
export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => {})
  }
  await ensurePublicReadPolicy()
}

/**
 * Make the bucket anonymously readable (GetObject) so publicUrl() links resolve.
 * No-op on R2 (public access is domain-configured there). Best-effort: if the
 * credentials can't set a policy we swallow the error rather than break uploads.
 */
export async function ensurePublicReadPolicy(): Promise<void> {
  if (isR2) return
  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicRead',
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  })
  try {
    await client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }))
  } catch {
    // Shared MinIO may forbid policy changes for this key — leave as-is.
  }
}

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

/**
 * Server-side direct upload. Used by the worker to push rendered PDFs
 * into MinIO/R2 without having to round-trip through a presigned URL.
 */
export async function putObject(args: {
  key: string
  body: Buffer | Uint8Array
  contentType: string
}): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  )
}

export async function presignGet(args: {
  key: string
  expiresInSeconds?: number
}): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: args.key })
  return getSignedUrl(client, cmd, { expiresIn: args.expiresInSeconds ?? 600 })
}

function isMissingObjectError(error: unknown): boolean {
  const maybeError = error as {
    name?: string
    code?: string
    Code?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    maybeError.$metadata?.httpStatusCode === 404 ||
    maybeError.name === 'NotFound' ||
    maybeError.name === 'NoSuchKey' ||
    maybeError.code === 'NoSuchKey' ||
    maybeError.Code === 'NoSuchKey'
  )
}

export async function objectExists(args: { key: string }): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: args.key }))
    return true
  } catch (error) {
    if (isMissingObjectError(error)) return false
    throw error
  }
}

export async function presignExistingGet(args: {
  key: string
  expiresInSeconds?: number
}): Promise<string | null> {
  const exists = await objectExists({ key: args.key })
  if (!exists) return null
  return presignGet(args)
}

/** Server-side direct download. Returns the object's bytes as a Buffer. */
export async function getObject(args: { key: string }): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: args.key }))
  const body = res.Body
  if (!body) throw new Error(`Object not found: ${args.key}`)
  const bytes = await body.transformToByteArray()
  return Buffer.from(bytes)
}

/**
 * Server-side streaming download for large objects (e.g. PowerPoint masters
 * served through the WOPI host) — avoids buffering the whole file in memory.
 */
export async function getObjectStream(args: {
  key: string
}): Promise<{ stream: ReadableStream; contentLength?: number; contentType?: string }> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: args.key }))
  const body = res.Body
  if (!body) throw new Error(`Object not found: ${args.key}`)
  return {
    stream: body.transformToWebStream() as ReadableStream,
    contentLength: res.ContentLength,
    contentType: res.ContentType,
  }
}

export async function deleteObject(args: { key: string }): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: args.key }))
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
