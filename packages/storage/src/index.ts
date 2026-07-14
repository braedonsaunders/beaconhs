// S3-compatible storage (Cloudflare R2 in prod, MinIO in dev).
// Same code path either way — only the endpoint changes.

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListPartsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import type { LifecycleRule } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import {
  MULTIPART_UPLOAD_PART_SIZE_BYTES,
  multipartPartCount,
  shouldUseMultipartUpload,
} from './multipart'

export * from './multipart'

const accountId = process.env.R2_ACCOUNT_ID ?? 'local'
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? 'beaconhs'
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? 'beaconhs-dev-secret'
const bucket = process.env.R2_BUCKET ?? 'beaconhs-dev'

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

const isR2 = endpoint.includes('r2.cloudflarestorage.com')

function storageErrorCode(error: unknown): string | undefined {
  const value = error as { name?: string; code?: string; Code?: string }
  return value.name ?? value.code ?? value.Code
}

function storageErrorStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
}

function isMissingBucketError(error: unknown): boolean {
  const code = storageErrorCode(error)
  return storageErrorStatus(error) === 404 || code === 'NotFound' || code === 'NoSuchBucket'
}

function isMissingPolicyError(error: unknown): boolean {
  const code = storageErrorCode(error)
  return (
    storageErrorStatus(error) === 404 ||
    code === 'NoSuchBucketPolicy' ||
    code === 'NoSuchLifecycleConfiguration' ||
    code === 'NoSuchPolicy' ||
    code === 'NotFound'
  )
}

function anonymousObjectUrl(key: string): string {
  const base = endpoint.replace(/\/$/, '')
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${encodeURIComponent(bucket)}/${encodedKey}`
}

/**
 * Idempotently establish the storage security baseline.
 *
 * MinIO/S3 buckets are made private by removing their bucket policy, then an
 * unsigned canary read proves the endpoint does not expose objects. Cloudflare
 * R2 public domains are configured outside the S3 API, so production must set
 * R2_PRIVATE_BUCKET_CONFIRMED=true only after r2.dev/custom-domain access has
 * been disabled and independently verified.
 */
export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (error) {
    if (!isMissingBucketError(error)) throw error
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  }
  await ensurePrivateBucketReady()
}

/** Remove anonymous access, configure pending-upload expiry, and prove privacy. */
export async function ensurePrivateBucketReady(): Promise<void> {
  if (process.env.R2_PUBLIC_URL) {
    throw new Error(
      'R2_PUBLIC_URL must be removed: BeaconHS storage is private and objects are served through authorized or expiring URLs',
    )
  }

  if (isR2) {
    if (process.env.R2_PRIVATE_BUCKET_CONFIRMED !== 'true') {
      throw new Error(
        'R2_PRIVATE_BUCKET_CONFIRMED=true is required after disabling every R2 public development URL and custom domain',
      )
    }
  } else {
    try {
      await client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }))
    } catch (error) {
      if (!isMissingPolicyError(error)) throw error
    }
  }

  let existingRules: LifecycleRule[] = []
  try {
    const lifecycle = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    )
    existingRules = lifecycle.Rules ?? []
  } catch (error) {
    if (!isMissingPolicyError(error)) throw error
  }

  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          ...existingRules.filter((rule) => rule.ID !== 'expire-unfinalized-uploads'),
          {
            ID: 'expire-unfinalized-uploads',
            Status: 'Enabled',
            Filter: { Tag: { Key: 'beaconhs-state', Value: 'pending' } },
            Expiration: { Days: 1 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    }),
  )

  const probeKey = `_privacy-probe/${randomUUID()}`
  await putObject({
    key: probeKey,
    body: new Uint8Array([1]),
    contentType: 'application/octet-stream',
  })
  try {
    const response = await fetch(anonymousObjectUrl(probeKey), {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
    })
    if (response.status >= 200 && response.status < 400) {
      throw new Error(
        `Storage privacy verification failed: anonymous read returned HTTP ${response.status}`,
      )
    }
  } finally {
    await deleteObject({ key: probeKey })
  }
}

export async function presignPut(args: {
  key: string
  contentType: string
  uploadToken: string
  expiresInSeconds?: number
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: args.key,
    ContentType: args.contentType,
    Metadata: { 'upload-token': args.uploadToken },
    Tagging: 'beaconhs-state=pending',
  })
  return getSignedUrl(client, cmd, { expiresIn: args.expiresInSeconds ?? 300 })
}

export async function createMultipartUpload(args: {
  key: string
  contentType: string
  contentDisposition?: 'inline' | 'attachment'
  uploadToken?: string
}): Promise<string> {
  const result = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: args.key,
      ContentType: args.contentType,
      ContentDisposition: args.contentDisposition ?? 'attachment',
      Metadata: args.uploadToken ? { 'upload-token': args.uploadToken } : undefined,
      Tagging: args.uploadToken ? 'beaconhs-state=pending' : undefined,
    }),
  )
  if (!result.UploadId) throw new Error('Storage did not create a multipart upload')
  return result.UploadId
}

export async function presignMultipartPart(args: {
  key: string
  uploadId: string
  partNumber: number
  expiresInSeconds?: number
}): Promise<string> {
  if (!Number.isInteger(args.partNumber) || args.partNumber < 1 || args.partNumber > 10_000) {
    throw new Error('Multipart part number must be between 1 and 10000')
  }
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: args.key,
      UploadId: args.uploadId,
      PartNumber: args.partNumber,
    }),
    { expiresIn: args.expiresInSeconds ?? 3600 },
  )
}

export async function completeMultipartUpload(args: {
  key: string
  uploadId: string
}): Promise<void> {
  const parts: Array<{ ETag: string; PartNumber: number }> = []
  let partNumberMarker: string | undefined
  do {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: args.key,
        UploadId: args.uploadId,
        PartNumberMarker: partNumberMarker,
      }),
    )
    for (const part of page.Parts ?? []) {
      if (!part.ETag || !part.PartNumber) {
        throw new Error('Storage returned an incomplete multipart part record')
      }
      parts.push({ ETag: part.ETag, PartNumber: part.PartNumber })
    }
    partNumberMarker = page.IsTruncated ? page.NextPartNumberMarker : undefined
  } while (partNumberMarker)

  if (parts.length === 0) throw new Error('Multipart upload contains no parts')
  parts.sort((left, right) => left.PartNumber - right.PartNumber)
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: args.key,
      UploadId: args.uploadId,
      MultipartUpload: { Parts: parts },
    }),
  )
}

export async function abortMultipartUpload(args: { key: string; uploadId: string }): Promise<void> {
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: args.key,
      UploadId: args.uploadId,
    }),
  )
}

/**
 * Server-side direct upload. Used by the worker to push rendered PDFs
 * into MinIO/R2 without having to round-trip through a presigned URL.
 */
export async function putObject(args: {
  key: string
  body: Buffer | Uint8Array
  contentType: string
  contentDisposition?: 'inline' | 'attachment'
}): Promise<void> {
  if (shouldUseMultipartUpload(args.body.byteLength)) {
    const uploadId = await createMultipartUpload({
      key: args.key,
      contentType: args.contentType,
      contentDisposition: args.contentDisposition,
    })
    try {
      const parts: Array<{ ETag: string; PartNumber: number }> = []
      const partCount = multipartPartCount(args.body.byteLength)
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const offset = (partNumber - 1) * MULTIPART_UPLOAD_PART_SIZE_BYTES
        const result = await client.send(
          new UploadPartCommand({
            Bucket: bucket,
            Key: args.key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: args.body.subarray(
              offset,
              Math.min(offset + MULTIPART_UPLOAD_PART_SIZE_BYTES, args.body.byteLength),
            ),
          }),
        )
        if (!result.ETag) throw new Error(`Storage did not confirm multipart part ${partNumber}`)
        parts.push({ ETag: result.ETag, PartNumber: partNumber })
      }
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: args.key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      )
    } catch (error) {
      await abortMultipartUpload({ key: args.key, uploadId }).catch(() => undefined)
      throw error
    }
    return
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      ContentDisposition: args.contentDisposition ?? 'attachment',
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

export type StoredObjectMetadata = {
  contentLength: number
  contentType: string | null
  contentDisposition: string | null
  metadata: Readonly<Record<string, string>>
  etag: string | null
}

export async function headObject(args: { key: string }): Promise<StoredObjectMetadata | null> {
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: args.key }))
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? null,
      contentDisposition: result.ContentDisposition ?? null,
      metadata: result.Metadata ?? {},
      etag: result.ETag ?? null,
    }
  } catch (error) {
    if (isMissingObjectError(error)) return null
    throw error
  }
}

/**
 * Promote a verified staging object to its immutable attachment key. The copy
 * deliberately strips the upload-token metadata from the final object.
 */
export async function promoteObject(args: {
  sourceKey: string
  destinationKey: string
  contentType: string
  contentDisposition: 'inline' | 'attachment'
}): Promise<void> {
  const source = `${bucket}/${args.sourceKey}`
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: args.destinationKey,
      CopySource: source,
      ContentType: args.contentType,
      ContentDisposition: args.contentDisposition,
      MetadataDirective: 'REPLACE',
      Metadata: {},
      TaggingDirective: 'REPLACE',
      Tagging: '',
    }),
  )
}

export async function getObjectRange(args: {
  key: string
  start: number
  end: number
}): Promise<Buffer> {
  if (args.start < 0 || args.end < args.start) throw new Error('Invalid object byte range')
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Range: `bytes=${args.start}-${args.end}`,
    }),
  )
  if (!result.Body) throw new Error(`Object not found: ${args.key}`)
  return Buffer.from(await result.Body.transformToByteArray())
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
  return (await headObject(args)) !== null
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

export function newAttachmentKey(args: {
  tenantId: string
  kind: 'image' | 'document' | 'video' | 'audio' | 'signature' | 'other'
  filename: string
}): string {
  return newTenantObjectKey({
    tenantId: args.tenantId,
    scope: args.kind,
    filename: args.filename,
  })
}

export function newPendingUploadKey(args: { tenantId: string; uploadId: string }): string {
  if (!UUID_RE.test(args.uploadId)) throw new Error('Upload id must be a UUID')
  return newTenantObjectKey({
    tenantId: args.tenantId,
    scope: '_pending',
    filename: args.uploadId,
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCOPE_RE = /^[a-z0-9_](?:[a-z0-9_/-]*[a-z0-9_])?$/

export function newTenantObjectKey(args: {
  tenantId: string
  scope: string
  filename: string
}): string {
  if (!UUID_RE.test(args.tenantId)) throw new Error('Tenant id must be a UUID')
  if (!SCOPE_RE.test(args.scope) || args.scope.split('/').some((part) => !part || part === '..')) {
    throw new Error('Object scope is invalid')
  }
  const safe = args.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file'
  return `t/${args.tenantId}/${args.scope}/${randomUUID()}-${safe}`
}

export { client as s3Client }
