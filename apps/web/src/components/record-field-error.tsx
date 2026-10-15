'use client'

import { GeneratedValue } from '@/i18n/generated'

/**
 * Why the server refused a record field's value, shown under the field (the
 * page's sync pill only says "Not saved"). Renders nothing while valid.
 */
export function RecordFieldError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
      <GeneratedValue value={error} />
    </p>
  )
}
