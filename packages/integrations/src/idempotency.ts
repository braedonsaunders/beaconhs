import { createHash } from 'node:crypto'

export function deliveryRef(
  namespace: string,
  triggerKey: string,
  subjectId: string,
  index: number,
): string {
  const digest = createHash('sha256')
    .update(namespace)
    .update('\0')
    .update(triggerKey)
    .update('\0')
    .update(subjectId)
    .update('\0')
    .update(String(index))
    .digest('hex')
    .slice(0, 40)
  return `${namespace}:${digest}`
}
