'use client'

// Markdown renderer for the built-in user guide (/help). Same sanitized
// react-markdown + GFM stack as the assistant's ChatMarkdown, tuned for long
// articles: roomier prose scale, and internal links ([Journals](/journals),
// [Article](/help/slug)) stay client-side Next links instead of opening a new
// tab.

import Link from 'next/link'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@beaconhs/ui'

export function ManualMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-slate dark:prose-invert max-w-none break-words text-slate-800 dark:text-slate-200',
        'prose-headings:font-semibold prose-headings:text-slate-900 dark:prose-headings:text-slate-100',
        'prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-lg prose-h3:text-base',
        'prose-p:leading-relaxed prose-li:leading-relaxed',
        'prose-a:font-medium prose-a:text-teal-700 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-teal-300',
        'prose-strong:text-slate-900 dark:prose-strong:text-slate-100',
        'prose-ol:marker:font-semibold prose-ol:marker:text-teal-700 dark:prose-ol:marker:text-teal-300',
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => {
            const url = href ?? '#'
            if (url.startsWith('/')) {
              return <Link href={url as never}>{linkChildren}</Link>
            }
            return (
              <a href={url} target="_blank" rel="noreferrer">
                {linkChildren}
              </a>
            )
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
