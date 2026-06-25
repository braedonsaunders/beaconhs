'use client'

// Markdown renderer for assistant messages. Sanitized (no raw HTML), GFM tables
// + lists + code, styled with the app's prose tokens incl. dark mode.

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@beaconhs/ui'

export function ChatMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none break-words text-slate-800 dark:text-slate-200',
        'prose-headings:font-semibold prose-headings:text-slate-900 dark:prose-headings:text-slate-100',
        'prose-a:font-medium prose-a:text-teal-700 dark:prose-a:text-teal-300',
        'prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:text-teal-800 dark:prose-code:bg-slate-800 dark:prose-code:text-teal-200',
        'prose-code:before:content-[""] prose-code:after:content-[""]',
        'prose-pre:bg-slate-900 prose-pre:text-slate-100 dark:prose-pre:bg-slate-950 dark:prose-pre:ring-1 dark:prose-pre:ring-slate-800',
        'prose-table:text-sm prose-th:text-slate-700 dark:prose-th:text-slate-300',
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
