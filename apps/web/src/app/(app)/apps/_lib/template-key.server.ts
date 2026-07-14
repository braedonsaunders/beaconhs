import 'server-only'

import { randomUUID } from 'node:crypto'
import { slugify } from './slug'

/**
 * Generate a readable, concurrency-safe Builder template key without a
 * select-before-insert race. The UUID suffix supplies 122 random bits.
 */
export function generatedTemplateKey(name: string): string {
  return `${slugify(name) || 'app'}_${randomUUID().replaceAll('-', '')}`
}
