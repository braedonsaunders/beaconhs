import { createHmac, timingSafeEqual } from 'node:crypto'

function capabilitySecret(): string {
  const secret = process.env.ATTACHMENT_CAPABILITY_SECRET
  if (secret && secret.length >= 32) return secret
  if (process.env.NODE_ENV !== 'production') return 'beaconhs-local-attachment-capability-secret'
  throw new Error('ATTACHMENT_CAPABILITY_SECRET must be configured with at least 32 characters')
}

function capability(attachmentId: string): string {
  return createHmac('sha256', capabilitySecret())
    .update(`attachment:v1:${attachmentId}`)
    .digest('base64url')
}

/** Stable server-minted bearer capability suitable for persisted rich text and
 * upload return values. Knowledge of an attachment UUID alone is insufficient. */
export function attachmentUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}?cap=${capability(attachmentId)}`
}

export function validateAttachmentCapability(attachmentId: string, presented: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(presented)) return false
  const expected = capability(attachmentId)
  return timingSafeEqual(Buffer.from(expected), Buffer.from(presented))
}
