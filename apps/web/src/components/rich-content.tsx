// Renders stored rich-text document HTML safely. Sanitizes (defense-in-depth —
// content is also sanitized on write) and applies Tailwind `prose` styling so
// in-app authored documents read the way they were written. Server component:
// the sanitizer runs in Node during RSC render.

import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { cn } from '@beaconhs/ui'

export function RichContent({
  html,
  className,
}: {
  html: string | null | undefined
  className?: string
}) {
  const clean = sanitizeDocumentHtml(html)
  if (!clean) return null
  return (
    <div
      className={cn(
        'rich-content prose prose-slate max-w-none',
        'prose-headings:font-semibold prose-a:text-teal-700',
        'prose-table:border prose-table:border-slate-200',
        'prose-th:border prose-th:border-slate-200 prose-th:bg-slate-50 prose-th:px-2 prose-th:py-1',
        'prose-td:border prose-td:border-slate-200 prose-td:px-2 prose-td:py-1',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
