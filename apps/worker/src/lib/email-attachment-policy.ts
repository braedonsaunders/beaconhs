import { EMAIL_DELIVERY_LIMITS } from '@beaconhs/email-render/delivery-input'

export function assertEmailAttachmentSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('Rendered email attachment has an invalid size.')
  }
  if (sizeBytes > EMAIL_DELIVERY_LIMITS.attachmentBytes) {
    throw new Error(
      `Rendered PDF exceeds the ${EMAIL_DELIVERY_LIMITS.attachmentBytes}-byte email attachment limit.`,
    )
  }
}
