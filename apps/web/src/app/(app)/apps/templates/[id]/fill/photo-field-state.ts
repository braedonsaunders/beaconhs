type AttachmentIdentity = { attachmentId: string }

/** True only when the ordered attachment identities are unchanged. */
export function attachmentIdsEqual(
  current: readonly AttachmentIdentity[],
  next: readonly AttachmentIdentity[],
): boolean {
  return (
    current.length === next.length &&
    current.every((attachment, index) => attachment.attachmentId === next[index]?.attachmentId)
  )
}

/** Photo annotation intentionally owns exactly one primary photo. */
export function singlePrimaryPhoto<T extends AttachmentIdentity>(files: readonly T[]): T[] {
  const primary = files.at(-1)
  return primary ? [primary] : []
}
