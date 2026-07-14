import { MAX_PPTX_FILE_BYTES, PPTX_MIME_TYPE } from '@beaconhs/office/limits'

type TrainingPptxAttachment = {
  kind: string
  contentType: string
  sizeBytes: number
}

export function assertTrainingPptxAttachment(attachment: TrainingPptxAttachment): void {
  if (attachment.kind !== 'document' || attachment.contentType !== PPTX_MIME_TYPE) {
    throw new Error('Select a valid .pptx PowerPoint file.')
  }
  if (
    !Number.isSafeInteger(attachment.sizeBytes) ||
    attachment.sizeBytes <= 0 ||
    attachment.sizeBytes > MAX_PPTX_FILE_BYTES
  ) {
    throw new Error('PowerPoint files must be no larger than 1 GB.')
  }
}
